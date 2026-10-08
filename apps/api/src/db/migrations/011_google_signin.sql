-- Run after 010_stripe_billing.sql. Idempotent.
-- Google sign-in: remember which Google account (the stable "sub" id) belongs to a user.
-- After the first sign-in the sub is the identity, so a later email change at Google can't hijack an account.
begin;

alter table users add column if not exists google_sub text;
create unique index if not exists uq_users_google_sub on users (google_sub) where google_sub is not null;

commit;
