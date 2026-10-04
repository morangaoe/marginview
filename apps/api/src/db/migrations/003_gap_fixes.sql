-- Migration 003: fill schema gaps identified in the gap analysis
-- Run once: psql "$DATABASE_URL" -f apps/api/src/db/migrations/003_gap_fixes.sql
BEGIN;

-- 1. organizations.metadata JSONB (used by onboarding to store target_margins)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';

-- 2. organizations.default_currency (used by pricing history query)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_currency char(3) NOT NULL DEFAULT 'USD';

-- 3. price_change_history — tracks every price update for the PriceHistory page.
--    If your schema already has this table, this is a no-op.
CREATE TABLE IF NOT EXISTS price_change_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  old_price_cents    integer,
  new_price_cents    integer NOT NULL,
  strategy           text,
  actor              text NOT NULL DEFAULT 'system',
  margin_after       numeric(5,2),
  changed_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pch_variant_at
  ON price_change_history (product_variant_id, changed_at DESC);

-- 4. inventory_movements — used by SkuDetail's movement history.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  location_id        uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  delta              integer NOT NULL,
  reason             text NOT NULL DEFAULT 'adjustment',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invmov_variant
  ON inventory_movements (product_variant_id, created_at DESC);

-- 5. competitor_products needs scraping_source_id if not already present
ALTER TABLE competitor_products
  ADD COLUMN IF NOT EXISTS scraping_source_id uuid REFERENCES scraping_sources(id) ON DELETE SET NULL;

-- 6. product_variants.current_price_cents — referenced by the pricing route
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS current_price_cents integer;

COMMIT;
