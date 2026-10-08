-- Run after 011_google_signin.sql. Idempotent.
-- One-time email sign-in links. Only the SHA-256 of the token is stored, so a database leak
-- can't be used to sign in.
begin;

create table if not exists login_links (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists idx_login_links_user on login_links (user_id, created_at desc);

commit;
