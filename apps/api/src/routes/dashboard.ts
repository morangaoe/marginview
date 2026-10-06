import { Router } from "express";
import { pool } from "../db/pool";
import { orgIdOf } from "../utils/http";
import { requireAuth } from "../middleware/auth";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/**
 * GET /api/dashboard/insights
 *
 * Returns three cards worth of data:
 * 1. Margin opportunities — SKUs priced below the competitor median
 * 2. Proof — margin improvement since the user started applying prices
 * 3. AI usage summary
 */
dashboardRouter.get("/insights", async (req, res) => {
  const orgId = orgIdOf(req);

  // ─── 1. Margin opportunities ────────────────────────────────────────
  // For each variant that has a current_price AND competitor data,
  // compare vs the competitor median. If below, compute the monthly
  // revenue uplift at the median price using sales_velocity.
  const opRows = await pool.query(
    `WITH variant_comps AS (
       SELECT cp.product_variant_id,
              ps.price_cents,
              ROW_NUMBER() OVER (PARTITION BY cp.id ORDER BY ps.observed_at DESC) AS rn
         FROM competitor_products cp
         JOIN price_snapshots ps ON ps.competitor_product_id = cp.id
         JOIN scraping_sources ss ON ss.id = cp.scraping_source_id
        WHERE ss.organization_id = $1
          AND (ps.validation_flag IS NULL OR ps.validation_flag = 'ok')
     ),
     medians AS (
       SELECT product_variant_id,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price_cents) AS median_cents,
              COUNT(*) AS comp_count
         FROM variant_comps WHERE rn = 1
        GROUP BY product_variant_id
     )
     SELECT v.id AS variant_id, v.sku, p.name,
            v.current_price_cents, v.unit_cost_cents,
            v.sales_velocity::float AS velocity,
            m.median_cents::int AS competitor_median_cents,
            m.comp_count::int AS competitor_count
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN medians m ON m.product_variant_id = v.id
      WHERE p.organization_id = $1
        AND v.deleted_at IS NULL AND p.deleted_at IS NULL
        AND v.current_price_cents IS NOT NULL
        AND v.current_price_cents < m.median_cents
      ORDER BY (m.median_cents - v.current_price_cents) * v.sales_velocity DESC
      LIMIT 20`,
    [orgId],
  );

  const opportunities = opRows.rows.map((r: any) => ({
    variantId: r.variant_id,
    sku: r.sku,
    name: r.name,
    currentPriceCents: Number(r.current_price_cents),
    competitorMedianCents: Number(r.competitor_median_cents),
    costCents: Number(r.unit_cost_cents),
    competitorCount: r.competitor_count,
    gapCents: Number(r.competitor_median_cents) - Number(r.current_price_cents),
    monthlyUpliftCents: Math.round(
      (Number(r.competitor_median_cents) - Number(r.current_price_cents)) * (r.velocity || 0) * 30
    ),
  }));

  const totalMonthlyUplift = opportunities.reduce((s: number, o: any) => s + o.monthlyUpliftCents, 0);

  // ─── 2. Proof — margin improvement ─────────────────────────────────
  // Look at price changes in the last 90 days: compare avg margin
  // before the first change vs avg margin after the latest change.
  const proofRows = await pool.query(
    `SELECT
       COUNT(DISTINCT pcl.product_variant_id)::int AS skus_repriced,
       COUNT(*)::int AS total_changes,
       AVG(pcl.margin_after_pct)::float AS avg_margin_after,
       MIN(pcl.applied_at) AS first_change_at
     FROM price_change_log pcl
     JOIN product_variants v ON v.id = pcl.product_variant_id
     JOIN products p ON p.id = v.product_id
     WHERE p.organization_id = $1
       AND pcl.applied_at >= now() - interval '90 days'`,
    [orgId],
  );

  // Get the avg margin BEFORE changes (from the first old_price in each variant's history)
  const beforeRows = await pool.query(
    `SELECT AVG(sub.margin_before)::float AS avg_margin_before
     FROM (
       SELECT DISTINCT ON (pcl.product_variant_id)
              CASE WHEN pcl.old_price_cents > 0
                   THEN ((pcl.old_price_cents - v.unit_cost_cents)::float / pcl.old_price_cents) * 100
                   ELSE NULL END AS margin_before
         FROM price_change_log pcl
         JOIN product_variants v ON v.id = pcl.product_variant_id
         JOIN products p ON p.id = v.product_id
        WHERE p.organization_id = $1
          AND pcl.applied_at >= now() - interval '90 days'
          AND pcl.old_price_cents IS NOT NULL
        ORDER BY pcl.product_variant_id, pcl.applied_at ASC
     ) sub`,
    [orgId],
  );

  const proof = {
    skusRepriced: proofRows.rows[0]?.skus_repriced ?? 0,
    totalChanges: proofRows.rows[0]?.total_changes ?? 0,
    avgMarginBefore: beforeRows.rows[0]?.avg_margin_before !== null
      ? Math.round((beforeRows.rows[0].avg_margin_before ?? 0) * 10) / 10
      : null,
    avgMarginAfter: proofRows.rows[0]?.avg_margin_after !== null
      ? Math.round((proofRows.rows[0].avg_margin_after ?? 0) * 10) / 10
      : null,
    firstChangeAt: proofRows.rows[0]?.first_change_at ?? null,
  };

  // ─── 3. AI usage ───────────────────────────────────────────────────
  const aiRows = await pool.query(
    `SELECT count(*)::int AS used
       FROM ai_usage
      WHERE organization_id = $1
        AND created_at >= date_trunc('month', now())`,
    [orgId],
  );
  const aiUsage = {
    usedThisMonth: aiRows.rows[0]?.used ?? 0,
    limit: Number(process.env.AI_MONTHLY_LIMIT ?? 200),
  };

  res.json({
    opportunities: {
      items: opportunities,
      count: opportunities.length,
      totalMonthlyUpliftCents: totalMonthlyUplift,
    },
    proof,
    aiUsage,
  });
});
