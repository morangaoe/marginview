-- Run once, after 002_modules.sql:
--   psql "$DATABASE_URL" -f apps/api/src/db/migrations/003_fixes.sql
-- Safe to re-run (every statement is idempotent).
--
-- Fixes columns/tables that routes already query but the schema never created,
-- plus a few columns the upcoming scraper / pricing modules need.
begin;

-- ── Organizations: settings blob + onboarding flag ───────────────────────────
alter table organizations
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Existing workspaces skip the wizard; only orgs created AFTER this migration
-- start with onboarding_completed_at = null. The guard keeps a re-run from
-- marking new, unfinished orgs as completed.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'organizations' and column_name = 'onboarding_completed_at'
  ) then
    alter table organizations add column onboarding_completed_at timestamptz;
    update organizations set onboarding_completed_at = now();
  end if;
end $$;

-- ── Locations: one name per org (onboarding upserts on this) ─────────────────
-- Earlier onboarding builds could create duplicates, so rename those first.
with d as (
  select id,
         row_number() over (partition by organization_id, name order by created_at, id) as rn
    from locations
)
update locations l
   set name = l.name || ' (' || d.rn || ')'
  from d
 where l.id = d.id and d.rn > 1;

create unique index if not exists idx_locations_org_name on locations (organization_id, name);

-- ── Competitor tracking: selector the scraper routes already read/write ──────
alter table competitor_products
  add column if not exists price_selector text;

-- ── Scraping health (used by the scheduler/queue rewrite) ────────────────────
alter table scraping_sources
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_failure_reason text,
  add column if not exists paused boolean not null default false;

-- ── Price change log: fields the history page and Apply flow need ────────────
alter table price_change_log
  add column if not exists strategy text,
  add column if not exists margin_after_pct numeric(6,2);

create index if not exists idx_price_change_log_variant
  on price_change_log (product_variant_id, applied_at desc);

commit;