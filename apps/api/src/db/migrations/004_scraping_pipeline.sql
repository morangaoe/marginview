-- Run after 003_gap_fixes.sql
-- Idempotent. Adds scheduling state, allows the 'blocked' compliance state the
-- cycle already uses, and the org default currency used for price parsing.
begin;

alter table organizations
  add column if not exists default_currency char(3) not null default 'USD';

alter table scraping_job_runs
  add column if not exists created_at timestamptz not null default now();

-- When each source is next due. NULL = due on the next scheduler tick.
alter table scraping_sources
  add column if not exists next_check_at timestamptz;

alter table scraping_sources drop constraint if exists scraping_sources_compliance_status_check;
alter table scraping_sources add constraint scraping_sources_compliance_status_check
  check (compliance_status in ('automated_allowed', 'manual_only', 'unreviewed', 'blocked'));

create index if not exists idx_sources_due on scraping_sources (paused, next_check_at);
create index if not exists idx_job_runs_source_status on scraping_job_runs (scraping_source_id, status);

commit;