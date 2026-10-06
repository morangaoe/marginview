-- Run after 005_price_change_log.sql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/src/db/migrations/006_plan_tiers.sql
begin;

update plans set pricing_model = pricing_model || '{"tier":"margin_intelligence"}'::jsonb where name = 'Starter';
update plans set pricing_model = pricing_model || '{"tier":"operations_pro"}'::jsonb where name = 'Growth';
update plans set pricing_model = pricing_model || '{"tier":"enterprise"}'::jsonb where name = 'Scale';

commit;
