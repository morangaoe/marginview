import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { computeStrategy, DEFAULT_PARAMETERS } from "../services/pricingStrategies";
import { StrategyType } from "../types";

export const pricingRouter = Router();
pricingRouter.use(requireAuth);

// Current price against the latest known price per tracked competitor,
// per App Flow 3.5 (always shows when each was last checked).
pricingRouter.get("/:variantId/comparison", async (req, res) => {
  const { variantId } = req.params;
  const [variant] = await query(
    `select id, sku, unit_cost_cents, current_price_cents, currency from product_variants where id = $1`,
    [variantId]
  );
  if (!variant) return res.status(404).json({ error: "Product variant not found" });

  const competitors = await query(
    `select cp.id, cp.competitor_name, ps.price_cents, ps.observed_at, ps.source
     from competitor_products cp
     left join lateral (
       select price_cents, observed_at, source
       from price_snapshots
       where competitor_product_id = cp.id
       order by observed_at desc
       limit 1
     ) ps on true
     where cp.product_variant_id = $1`,
    [variantId]
  );

  res.json({ variant, competitors });
});

const previewSchema = z.object({
  strategyType: z.enum(["cost_plus", "value_based", "dynamic", "keystone", "penetration", "price_skimming"]),
  parameters: z.record(z.number()).optional(),
});

// Preview only, never applies anything, per the error-prevention heuristic
// and App Flow 3.2 (confirm-before-apply).
pricingRouter.post("/:variantId/preview", async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { strategyType, parameters } = parsed.data;
  const { variantId } = req.params;

  const [variant] = await query(
    `select unit_cost_cents, current_price_cents from product_variants where id = $1`,
    [variantId]
  );
  if (!variant) return res.status(404).json({ error: "Product variant not found" });

  const competitorPrices = await query<{ price_cents: number }>(
    `select ps.price_cents
     from competitor_products cp
     join lateral (
       select price_cents from price_snapshots
       where competitor_product_id = cp.id order by observed_at desc limit 1
     ) ps on true
     where cp.product_variant_id = $1`,
    [variantId]
  );

  const result = computeStrategy(strategyType as StrategyType, {
    unitCostCents: variant.unit_cost_cents,
    currentPriceCents: variant.current_price_cents,
    competitorPricesCents: competitorPrices.map((c) => c.price_cents),
    parameters: parameters ?? DEFAULT_PARAMETERS[strategyType as StrategyType],
  });

  res.json(result);
});

const applySchema = previewSchema.extend({ newPriceCents: z.number().int().positive() });

// Requires pricing_manager or owner, per PRD 7.5 roles, and writes to the
// price change log with the actor and both old and new values.
pricingRouter.post("/:variantId/apply", requireRole("owner", "pricing_manager"), async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { strategyType, parameters, newPriceCents } = parsed.data;
  const { variantId } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [variant] = (await client.query(
      `select current_price_cents from product_variants where id = $1`,
      [variantId]
    )).rows;

    const [strategy] = (await client.query(
      `insert into pricing_strategies (product_variant_id, strategy_type, parameters, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [variantId, strategyType, parameters ?? {}, req.user!.id]
    )).rows;

    await client.query(
      `update product_variants set current_price_cents = $1, updated_at = now() where id = $2`,
      [newPriceCents, variantId]
    );

    await client.query(
      `insert into price_change_log (product_variant_id, pricing_strategy_id, old_price_cents, new_price_cents, actor_user_id)
       values ($1, $2, $3, $4, $5)`,
      [variantId, strategy.id, variant.current_price_cents, newPriceCents, req.user!.id]
    );

    await client.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
