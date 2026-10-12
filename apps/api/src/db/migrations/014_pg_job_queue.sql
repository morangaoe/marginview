-- Run after 013_supabase_rls.sql. Idempotent.
-- scraping_job_runs doubles as the job queue (replaces Redis/BullMQ): workers claim rows with
-- FOR UPDATE SKIP LOCKED. A queued row is eligible once run_after has passed.
begin;

alter table scraping_job_runs
  add column if not exists attempts integer not null default 0,
  add column if not exists run_after timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists manual boolean not null default false;

create index if not exists idx_job_runs_claim on scraping_job_runs (run_after) where status = 'queued';

commit;
