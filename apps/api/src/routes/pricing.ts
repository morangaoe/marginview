import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";
import { computeStrategy, marginFor } from "../services/pricingStrategies";
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

  const { weights, target_margin_pct, markup_percent, value_based_cents, dynamic_cents } =
    req.body ?? {};

  if (!weights || typeof weights !== "object") {
    return res.status(400).json({ error: "weights is required" });
  }

  const w: Record<Strategy, number> = { cost_plus: 0, value_based: 0, keystone: 0, dynamic: 0 };
  for (const name of STRATEGIES) {
    const val = weights[name];
    if (!isNum(val) || val < 0) {
      return res.status(400).json({ error: `weights.${name} must be a non-negative number` });
    }
    w[name] = val;
  }

  const optionalNumbers: [string, unknown][] = [
    ["target_margin_pct", target_margin_pct],
    ["markup_percent", markup_percent],
    ["value_based_cents", value_based_cents],
    ["dynamic_cents", dynamic_cents],
  ];
  for (const [label, val] of optionalNumbers) {
    if (val !== undefined && (!isNum(val) || val < 0)) {
      return res.status(400).json({ error: `${label} must be a non-negative number` });
    }
  }

  // A markup of m% on cost equals a margin of m / (100 + m) on price.
  const targetMarginPct: number =
    target_margin_pct ??
    (markup_percent !== undefined ? (markup_percent / (100 + markup_percent)) * 100 : 40);

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

    const base = { unitCostCents: costCents, competitorPricesCents, currentPriceCents };

    const parametersFor: Record<Strategy, Record<string, number>> = {
      cost_plus: { targetMarginPct },
      value_based: { perceivedValueCents: value_based_cents ?? Math.round(costCents * 2.6) },
      keystone: {},
      dynamic:
        dynamic_cents !== undefined
          ? { floorCents: Math.round(dynamic_cents), ceilingCents: Math.round(dynamic_cents) }
          : {},
    };

    const total = STRATEGIES.reduce((sum, n) => sum + w[n], 0);
    const normalized: Record<Strategy, number> = {
      cost_plus: 0,
      value_based: 0,
      keystone: 0,
      dynamic: 0,
    };
    for (const n of STRATEGIES) normalized[n] = total > 0 ? (w[n] / total) * 100 : 25;

    const baselines = {} as Record<Strategy, Baseline>;
    let blended = 0;
    for (const n of STRATEGIES) {
      const r = computeStrategy(n, { ...base, parameters: parametersFor[n] });
      const price = r.recommendedPriceCents;
      baselines[n] = {
        price_cents: price,
        margin_percent: marginFor(price, costCents),
        warning: r.warning ?? null,
      };
      blended += price * (normalized[n] / 100);
    }
    const optimized = Math.round(blended);

    return res.json({
      variant_id: variant.rows[0].id,
      cost_cents: costCents,
      weights_input: w,
      weights_normalized: normalized,
      weights_balanced: Math.abs(total - 100) < 0.01,
      baselines,
      optimized_price_cents: optimized,
      margin_percent: marginFor(optimized, costCents),
    });
  } catch (err) {
    console.error("POST /pricing/:variantId/optimized failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/pricing/:variantId/history
 * Returns the last 90 days of price changes for a variant.
 */
router.get("/:variantId/history", async (req: Request, res: Response) => {
  let orgId: string;
  try {
    orgId = orgIdOf(req);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT pch.id,
              pch.changed_at       AS at,
              pch.actor,
              pch.old_price_cents  AS "from",
              pch.new_price_cents  AS "to",
              pch.strategy,
              pch.margin_after     AS "marginAfter",
              p.name               AS "productName",
              p.default_currency   AS currency
         FROM price_change_history pch
         JOIN product_variants v  ON v.id = pch.product_variant_id
         JOIN products p          ON p.id = v.product_id
        WHERE pch.product_variant_id = $1
          AND p.organization_id = $2
          AND pch.changed_at >= now() - interval '90 days'
        ORDER BY pch.changed_at DESC
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
        from: Number(r.from),
        to: Number(r.to),
        strategy: r.strategy,
        marginAfter: r.marginAfter !== null ? Number(r.marginAfter) : null,
      })),
    });
  } catch (err) {
    console.error("GET /pricing/:variantId/history failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
