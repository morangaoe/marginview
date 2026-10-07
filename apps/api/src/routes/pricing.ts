import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";
import { captureError } from "../services/errorLog";
import { adaptWeights, computeStrategy, marginFor, median, type Weights } from "../services/pricingStrategies";
import { orgIdOf } from "../utils/http";

const router = Router();

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const STRATEGIES = ["cost_plus", "value_based", "keystone", "dynamic"] as const;
type Strategy = (typeof STRATEGIES)[number];

interface Baseline {
  price_cents: number;
  margin_percent: number;
  warning: string | null;
}

const VARIANT_SQL = `
  SELECT v.id, v.unit_cost_cents AS cost_cents, v.current_price_cents
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
   WHERE v.id = $1 AND p.organization_id = $2
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
`;

// Latest tracked price per competitor product for this variant.
const COMPETITOR_SQL = `
  SELECT DISTINCT ON (cp.id) ps.price_cents
    FROM competitor_products cp
    JOIN price_snapshots ps ON ps.competitor_product_id = cp.id
   WHERE cp.product_variant_id = $1
     AND (ps.validation_flag IS NULL OR ps.validation_flag = 'ok')
   ORDER BY cp.id, ps.observed_at DESC
`;

/** GET /api/pricing/:variantId/context */
router.get("/:variantId/context", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = orgIdOf(req); } catch { return res.status(401).json({ error: "Unauthorized" }); }

  try {
    const variant = await pool.query(VARIANT_SQL, [req.params.variantId, orgId]);
    if (!variant.rows.length) return res.status(404).json({ error: "Variant not found" });

    const { rows } = await pool.query(
      `SELECT cp.id, cp.competitor_name AS "competitorName", ss.url,
              snap.price_cents AS "priceCents", snap.currency,
              snap.observed_at AS "observedAt", snap.validation_flag AS flag
         FROM competitor_products cp
         JOIN scraping_sources ss ON ss.id = cp.scraping_source_id
         LEFT JOIN LATERAL (
           SELECT price_cents, currency, observed_at, validation_flag
             FROM price_snapshots
            WHERE competitor_product_id = cp.id
            ORDER BY observed_at DESC LIMIT 1
         ) snap ON true
        WHERE cp.product_variant_id = $1 AND ss.organization_id = $2
        ORDER BY cp.competitor_name`,
      [req.params.variantId, orgId],
    );
    const competitors = rows.map((row: any) => ({
      ...row,
      priceCents: row.priceCents === null ? null : Number(row.priceCents),
    }));
    const trusted = competitors
      .filter((competitor: any) => competitor.priceCents !== null && (competitor.flag === null || competitor.flag === "ok"))
      .map((competitor: any) => competitor.priceCents as number);

    return res.json({
      variantId: variant.rows[0].id,
      costCents: Number(variant.rows[0].cost_cents),
      currentPriceCents: variant.rows[0].current_price_cents === null ? null : Number(variant.rows[0].current_price_cents),
      competitors,
      stats: trusted.length ? {
        medianCents: Math.round(median(trusted)!),
        minCents: Math.min(...trusted),
        maxCents: Math.max(...trusted),
        count: trusted.length,
      } : null,
    });
  } catch (err) {
    captureError(req, err, "GET /pricing/:variantId/context failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/pricing/:variantId/optimized
 *
 * FIX: The original used its own orgIdOf that read organization_id | org_id
 * rather than organizationId (the field written by the auth middleware fix).
 * Now imports and uses the canonical orgIdOf from utils/http.ts which reads
 * req.user.organizationId, matching the normalized claim in the JWT.
 */
router.post("/:variantId/optimized", async (req: Request, res: Response) => {
  let orgId: string;
  try {
    orgId = orgIdOf(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const {
    weights, target_margin_pct, markup_percent, value_based_cents,
    dynamic_cents, dynamic_position_pct, min_margin_pct, adaptive,
  } = req.body ?? {};

  if (!weights || typeof weights !== "object") return res.status(400).json({ error: "weights is required" });

  const w: Weights = { cost_plus: 0, value_based: 0, keystone: 0, dynamic: 0 };
  for (const name of STRATEGIES) {
    const val = weights[name];
    if (!isNum(val) || val < 0) return res.status(400).json({ error: `weights.${name} must be a non-negative number` });
    w[name] = val;
  }

  for (const [label, val] of [
    ["target_margin_pct", target_margin_pct], ["markup_percent", markup_percent],
    ["value_based_cents", value_based_cents], ["dynamic_cents", dynamic_cents],
  ] as [string, unknown][]) {
    if (val !== undefined && (!isNum(val) || val < 0)) return res.status(400).json({ error: `${label} must be a non-negative number` });
  }
  if (dynamic_position_pct !== undefined && (!isNum(dynamic_position_pct) || dynamic_position_pct < -50 || dynamic_position_pct > 50)) {
    return res.status(400).json({ error: "dynamic_position_pct must be between -50 and 50" });
  }
  if (min_margin_pct !== undefined && (!isNum(min_margin_pct) || min_margin_pct < 0 || min_margin_pct > 95)) {
    return res.status(400).json({ error: "min_margin_pct must be between 0 and 95" });
  }

  // Convert markup on cost to its equivalent gross margin on selling price.
  const targetMarginPct: number =
    target_margin_pct ?? (markup_percent !== undefined ? (markup_percent / (100 + markup_percent)) * 100 : 40);
  if (targetMarginPct > 95) return res.status(400).json({ error: "target_margin_pct must not exceed 95" });

  try {
    const variant = await pool.query(VARIANT_SQL, [req.params.variantId, orgId]);
    if (variant.rows.length === 0) return res.status(404).json({ error: "Variant not found" });

    const costCents = Number(variant.rows[0].cost_cents);
    const currentPriceCents: number | null =
      variant.rows[0].current_price_cents === null
        ? null
        : Number(variant.rows[0].current_price_cents);

    const comp = await pool.query(COMPETITOR_SQL, [req.params.variantId]);
    const competitorPricesCents: number[] = comp.rows.map((r: any) => Number(r.price_cents));

    const inv = await pool.query(
      `SELECT COALESCE(SUM(on_hand), 0)::int AS stock,
              COALESCE(SUM(max_capacity), 0)::int AS cap,
              COALESCE(BOOL_OR(max_capacity <> 100), false) AS has_custom_capacity
         FROM inventory_levels WHERE product_variant_id = $1`,
      [req.params.variantId],
    );
    const cap = Number(inv.rows[0]?.cap ?? 0);
    const hasCustomCapacity = inv.rows[0]?.has_custom_capacity === true;
    const stockPct = cap > 0 && hasCustomCapacity ? (Number(inv.rows[0].stock) / cap) * 100 : null;
    const { weights: effective, notes } = adaptWeights(
      w,
      { trusted: competitorPricesCents.length, stockPct },
      adaptive !== false,
    );

    const base = { unitCostCents: costCents, competitorPricesCents, currentPriceCents };

    const parametersFor: Record<Strategy, Record<string, number>> = {
      cost_plus: { targetMarginPct },
      value_based: { perceivedValueCents: value_based_cents ?? Math.round(costCents * 2.6) },
      keystone: {},
      dynamic: {
        positionPct: dynamic_position_pct ?? 0,
        minMarginPct: min_margin_pct ?? 10,
        ...(dynamic_cents !== undefined
          ? { floorCents: Math.round(dynamic_cents), ceilingCents: Math.round(dynamic_cents) }
          : {}),
      },
    };

    const baselines = {} as Record<Strategy, Baseline>;
    const breakdown = STRATEGIES.map((n) => {
      const r = computeStrategy(n, { ...base, parameters: parametersFor[n] });
      const price = r.recommendedPriceCents;
      baselines[n] = {
        price_cents: price,
        margin_percent: marginFor(price, costCents),
        warning: r.warning ?? null,
      };
      return {
        strategy: n,
        weight_pct: effective[n],
        price_cents: price,
        contribution_cents: (price * effective[n]) / 100,
      };
    });
    const optimized = Math.round(breakdown.reduce((sum, item) => sum + item.contribution_cents, 0));
    const rawTotal = STRATEGIES.reduce((sum, n) => sum + w[n], 0);
    const normalized: Record<Strategy, number> = rawTotal > 0
      ? Object.fromEntries(STRATEGIES.map((n) => [n, (w[n] / rawTotal) * 100])) as Record<Strategy, number>
      : { cost_plus: 25, value_based: 25, keystone: 25, dynamic: 25 };

    return res.json({
      variant_id: variant.rows[0].id,
      cost_cents: costCents,
      weights_input: w,
      weights_normalized: normalized,
      weights_effective: effective,
      weights_balanced: Math.abs(rawTotal - 100) < 0.01,
      adjustments: notes,
      trusted_competitors: competitorPricesCents.length,
      stock_pct: stockPct,
      baselines,
      breakdown,
      optimized_price_cents: optimized,
      margin_percent: marginFor(optimized, costCents),
    });
  } catch (err) {
    captureError(req, err, "POST /pricing/:variantId/optimized failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/pricing/:variantId/history: last 90 days from price_change_log. */
router.get("/:variantId/history", async (req: Request, res: Response) => {
  let orgId: string;
  try {
    orgId = orgIdOf(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT pcl.id,
              pcl.applied_at AS at,
              COALESCE(u.full_name, 'Unknown') AS actor,
              pcl.old_price_cents AS "from",
              pcl.new_price_cents AS "to",
              COALESCE(pcl.strategy, 'manual') AS strategy,
              pcl.margin_after_pct AS "marginAfter",
              p.name AS "productName",
              v.currency
         FROM price_change_log pcl
         JOIN product_variants v ON v.id = pcl.product_variant_id
         JOIN products p ON p.id = v.product_id
         LEFT JOIN users u ON u.id = pcl.actor_user_id
        WHERE pcl.product_variant_id = $1
          AND p.organization_id = $2
          AND pcl.applied_at >= now() - interval '90 days'
        ORDER BY pcl.applied_at DESC
        LIMIT 200`,
      [req.params.variantId, orgId],
    );

    const productName = rows[0]?.productName ?? "Product";
    const currency = rows[0]?.currency ?? "USD";
    return res.json({
      productName,
      currency,
      changes: rows.map((r: any) => ({
        id: r.id,
        at: r.at,
        actor: r.actor,
        from: r.from === null ? null : Number(r.from),
        to: Number(r.to),
        strategy: r.strategy,
        marginAfter: r.marginAfter !== null ? Number(r.marginAfter) : null,
      })),
    });
  } catch (err) {
    captureError(req, err, "GET /pricing/:variantId/history failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
