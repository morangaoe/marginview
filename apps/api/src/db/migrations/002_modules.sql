-- Run once: psql "$DATABASE_URL" -f apps/api/src/db/migrations/002_modules.sql
begin;

alter table organizations
  add column if not exists domain text unique,
  add column if not exists invite_code text unique,
  add column if not exists scraping_credits_total integer not null default 1000,
  add column if not exists scraping_credits_used integer not null default 0;

update organizations
   set invite_code = upper(substr(md5(random()::text || id::text), 1, 10))
 where invite_code is null;

alter table inventory_levels add column if not exists max_capacity integer not null default 100;
alter table product_variants add column if not exists sales_velocity numeric(10,2) not null default 0;

alter table scraping_job_runs
  add column if not exists organization_id uuid references organizations(id),
  add column if not exists result_price_cents integer,
  add column if not exists result_currency char(3),
  add column if not exists method text;

create unique index if not exists idx_sources_org_url on scraping_sources (organization_id, url);
create unique index if not exists idx_comp_variant_source on competitor_products (product_variant_id, scraping_source_id);

commit;
