begin;
-- Lead capture for the public (no-account) market search and price audit.
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  source text not null default 'market_search',
  ip_hash text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists uq_leads_email on leads (lower(email));

-- One row per public search/audit, used for per-visitor quotas and a global daily cap.
create table if not exists public_usage (
  id uuid primary key default uuid_generate_v4(),
  kind text not null check (kind in ('search','audit')),
  ip_hash text not null,
  lead_id uuid references leads(id),
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_public_usage_ip on public_usage (ip_hash, kind, created_at desc);
create index if not exists idx_public_usage_lead on public_usage (lead_id, kind, created_at desc);
commit;
