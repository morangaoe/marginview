begin;
create table if not exists org_integrations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  provider text not null check (provider in ('claude')),
  key_ciphertext text not null,
  key_last4 text not null,
  model text,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists ai_usage (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  kind text not null,
  source text not null check (source in ('platform','org')),
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_usage_org_month on ai_usage (organization_id, created_at desc);

create table if not exists ai_weight_recommendations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  product_variant_id uuid not null references product_variants(id),
  weights jsonb not null,
  confidence text,
  reasoning text,
  inputs jsonb,
  created_by_user_id uuid references users(id),
  created_at timestamptz not null default now()
);
commit;
