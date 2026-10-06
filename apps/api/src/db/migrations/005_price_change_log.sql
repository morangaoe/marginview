-- Run after 003_gap_fixes.sql:
--   psql "$DATABASE_URL" -f apps/api/src/db/migrations/005_price_change_log.sql
begin;

alter table price_change_log
  add column if not exists strategy text,
  add column if not exists margin_after_pct numeric(5,1);

create index if not exists idx_price_change_log_variant
  on price_change_log (product_variant_id, applied_at desc);

commit;
