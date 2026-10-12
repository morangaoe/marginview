-- Stripe billing: customer + subscription links and webhook idempotency.
begin;

alter table organizations
  add column if not exists stripe_customer_id text;
create unique index if not exists organizations_stripe_customer_idx
  on organizations (stripe_customer_id) where stripe_customer_id is not null;

alter table subscriptions
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_interval text check (billing_interval in ('month','year')),
  add column if not exists cancel_at_period_end boolean not null default false;
create unique index if not exists subscriptions_stripe_sub_idx
  on subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

alter table invoices
  add column if not exists stripe_invoice_id text,
  add column if not exists hosted_invoice_url text,
  add column if not exists currency char(3) not null default 'USD';
create unique index if not exists invoices_stripe_invoice_idx
  on invoices (stripe_invoice_id) where stripe_invoice_id is not null;

-- Stripe retries and can deliver out of order; record each event id once.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

commit;
