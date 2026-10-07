-- Run after 008_public_leads.sql. Idempotent.
-- 1. Session invalidation + sign-in tracking on users.
-- 2. error_events: every failure the platform admin dashboard shows.
begin;

alter table users
  add column if not exists last_login_at timestamptz,
  -- Tokens issued before this moment are rejected, so a password reset signs the user out everywhere.
  add column if not exists password_changed_at timestamptz;

-- Login matches emails case-insensitively; make the database agree. Skipped (with a notice)
-- if two existing accounts differ only by case, so the migration never blocks a deploy.
do $$
begin
  create unique index if not exists uq_users_email_lower on users (lower(email));
exception when unique_violation then
  raise notice 'uq_users_email_lower not created: some emails differ only by case. Merge them, then re-run.';
end $$;

create table if not exists error_events (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  source text not null check (source in ('api', 'web', 'scraper', 'auth', 'ai', 'worker')),
  level text not null default 'error' check (level in ('error', 'warn')),
  -- Same fingerprint = same issue; the dashboard groups by it.
  fingerprint text not null,
  message text not null,
  stack text,
  method text,
  path text,
  status integer,
  user_id uuid,
  organization_id uuid,
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz
);
create index if not exists idx_error_events_created on error_events (created_at desc);
create index if not exists idx_error_events_fingerprint on error_events (fingerprint, created_at desc);

commit;
