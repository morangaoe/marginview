-- Marginview database schema
-- Matches /docs Backend Schema document. PostgreSQL 14+.

create extension if not exists "uuid-ossp";

-- ========== Identity & organization ==========

create table organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  default_currency char(3) not null default 'USD',
  tos_accepted_at timestamptz,
  privacy_policy_version_accepted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  email text not null unique,
  password_hash text not null,
  full_name text not null,
  status text not null default 'active' check (status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table roles (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique check (name in ('owner','pricing_manager','inventory_manager','viewer'))
);
insert into roles (name) values ('owner'),('pricing_manager'),('inventory_manager'),('viewer');

create table locations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_roles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  location_id uuid references locations(id)
);
-- Partial unique indexes replace the composite PK so NULL location_id
-- (org-wide role) is handled correctly — a NULL in a PK is undefined
-- behaviour in Postgres and silently breaks uniqueness enforcement.
create unique index idx_user_roles_scoped  on user_roles (user_id, role_id, location_id) where location_id is not null;
create unique index idx_user_roles_orgwide on user_roles (user_id, role_id)              where location_id is null;

-- ========== Catalog & inventory ==========

create table products (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name text not null,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table product_variants (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id),
  sku text not null,
  unit_cost_cents integer not null,
  currency char(3) not null default 'USD',
  current_price_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index idx_variant_sku_per_product on product_variants (product_id, sku);

create table inventory_levels (
  id uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants(id),
  location_id uuid not null references locations(id),
  on_hand integer not null default 0,
  committed integer not null default 0,
  incoming integer not null default 0,
  reorder_point integer not null default 0,
  reorder_quantity integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (product_variant_id, location_id)
);

create table inventory_movements (
  id uuid primary key default uuid_generate_v4(),
  inventory_level_id uuid not null references inventory_levels(id),
  change_quantity integer not null,
  reason_code text not null check (reason_code in ('received','sold','damaged','returned','recount')),
  actor_user_id uuid not null references users(id),
  note text,
  created_at timestamptz not null default now()
);

-- ========== Pricing intelligence ==========

create table scraping_sources (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  url text not null,
  compliance_status text not null default 'unreviewed' check (compliance_status in ('automated_allowed','manual_only','unreviewed')),
  scrape_interval_minutes integer not null default 720,
  last_checked_at timestamptz,
  last_status text not null default 'pending' check (last_status in ('ok','failed','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table competitor_products (
  id uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants(id),
  scraping_source_id uuid references scraping_sources(id),
  competitor_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table price_snapshots (
  id uuid primary key default uuid_generate_v4(),
  competitor_product_id uuid not null references competitor_products(id),
  price_cents integer not null,
  currency char(3) not null,
  in_stock boolean,
  observed_at timestamptz not null default now(),
  source text not null check (source in ('scraped','manual')),
  validation_flag text check (validation_flag in ('ok','out_of_band','low_confidence'))
);
create index idx_price_snapshots_latest on price_snapshots (competitor_product_id, observed_at desc);

create table pricing_strategies (
  id uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants(id),
  strategy_type text not null check (strategy_type in ('cost_plus','value_based','dynamic','keystone','penetration','price_skimming')),
  parameters jsonb not null default '{}',
  active boolean not null default true,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table price_change_log (
  id uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants(id),
  pricing_strategy_id uuid references pricing_strategies(id),
  old_price_cents integer,
  new_price_cents integer not null,
  actor_user_id uuid not null references users(id),
  applied_at timestamptz not null default now()
);

-- ========== Suppliers & procurement ==========

create table suppliers (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  name text not null,
  contact_email text,
  default_lead_time_days integer not null default 14,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  supplier_id uuid not null references suppliers(id),
  location_id uuid not null references locations(id),
  status text not null default 'draft' check (status in ('draft','sent','partially_received','received','closed')),
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_order_items (
  id uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid not null references purchase_orders(id),
  product_variant_id uuid not null references product_variants(id),
  quantity_ordered integer not null,
  quantity_received integer not null default 0,
  unit_cost_cents integer not null
);

create table procurement_suggestions (
  id uuid primary key default uuid_generate_v4(),
  product_variant_id uuid not null references product_variants(id),
  location_id uuid not null references locations(id),
  suggested_quantity integer not null,
  reason jsonb not null default '{}',
  status text not null default 'open' check (status in ('open','actioned','dismissed')),
  dismissed_reason text,
  generated_at timestamptz not null default now()
);

-- ========== Scraping infra ==========

create table scraping_job_runs (
  id uuid primary key default uuid_generate_v4(),
  scraping_source_id uuid not null references scraping_sources(id),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  failure_reason text,
  started_at timestamptz,
  finished_at timestamptz
);

-- ========== AI assistant ==========

create table ai_conversations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  user_id uuid not null references users(id),
  product_variant_id uuid references product_variants(id),
  created_at timestamptz not null default now()
);

create table ai_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references ai_conversations(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  referenced_records jsonb,
  created_at timestamptz not null default now()
);

-- ========== Billing ==========

create table plans (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  pricing_model jsonb not null default '{}'
);

create table subscriptions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  plan_id uuid not null references plans(id),
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  -- Set the first time a tracked source successfully returns a price for
  -- this org, not at signup, per the Pricing & Packaging Strategy section 7
  -- ("trial clock does not start ticking until the first competitor source
  -- successfully returns a price"). Null means the trial has not started yet.
  trial_activated_at timestamptz,
  current_period_end timestamptz
);

create table invoices (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references subscriptions(id),
  amount_cents integer not null,
  status text not null default 'open' check (status in ('open','paid','void')),
  issued_at timestamptz not null default now()
);

-- ========== Platform ==========

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  actor_user_id uuid not null references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- ========== Seed data: plans ==========
-- Matches the Pricing & Packaging Strategy document section 4. The value
-- metric is tracked competitor sources per month, not seats; seats are
-- unlimited on every tier since collaboration across roles is a stated
-- product goal, not something to meter.
insert into plans (name, pricing_model) values
  ('Starter', '{"tier": "margin_intelligence", "tracked_sources_included": 15, "sku_soft_limit": 200, "price_cents_monthly": 4900, "billing": "self_serve"}'),
  ('Growth', '{"tier": "operations_pro", "tracked_sources_included": 100, "sku_soft_limit": 2000, "price_cents_monthly": 19900, "billing": "self_serve"}'),
  ('Scale', '{"tier": "enterprise", "tracked_sources_included": null, "sku_soft_limit": null, "price_cents_monthly": null, "starting_floor_cents_monthly": 49900, "billing": "sales_assisted"}');

create table notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  type text not null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
