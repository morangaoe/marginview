import { pool } from "../db/pool";

export type Recommendation = "RESTOCK_NOW" | "OPPORTUNITY_BUY" | "HOLD" | "LIQUIDATE";

export interface AdvisorInput {
  stock: number;
  capacity: number;
  reorderPoint: number;
  salesVelocity: number; // units/day
  costCents: number;
  marketCents: number | null;
  prevMarketCents: number | null;
}

export interface AdvisorResult {
  tag: Recommendation;
  reason: string;
  stockPct: number;
  marginPct: number | null;
  marketTrendPct: number | null;
  daysOfCover: number | null;
  suggestedQty: number;
}

const OPPORTUNITY_MARGIN_PCT = 40;
const FALLING_MARKET = -3; // % change over ~7 days
const LOW_VELOCITY_COVER_DAYS = 90;

/** Pure function: easy to unit test. */
export function evaluate(i: AdvisorInput): AdvisorResult {
  const stockPct = i.capacity > 0 ? (i.stock / i.capacity) * 100 : 0;
  const daysOfCover = i.salesVelocity > 0 ? i.stock / i.salesVelocity : null;
  const marginPct = i.marketCents && i.marketCents > 0 ? ((i.marketCents - i.costCents) / i.marketCents) * 100 : null;
  const trend = i.marketCents && i.prevMarketCents ? ((i.marketCents - i.prevMarketCents) / i.prevMarketCents) * 100 : null;
  const room = Math.max(i.capacity - i.stock, 0);
  const base = { stockPct, marginPct, marketTrendPct: trend, daysOfCover };

  const lowVelocity = i.salesVelocity <= 0 || (daysOfCover !== null && daysOfCover > LOW_VELOCITY_COVER_DAYS);
  const marketFalling = trend !== null && trend <= FALLING_MARKET;

  if (stockPct > 85 && (lowVelocity || marketFalling)) {
    return { ...base, tag: "LIQUIDATE", suggestedQty: 0,
      reason: marketFalling && !lowVelocity
        ? `Stock is ${stockPct.toFixed(0)}% of capacity and competitor prices fell ${Math.abs(trend!).toFixed(1)}%. Mark down before margin erodes.`
        : `Stock is ${stockPct.toFixed(0)}% of capacity with slow sales. Mark down to free up cash.` };
  }
  if (i.stock < i.reorderPoint && i.salesVelocity > 0) {
    return { ...base, tag: "RESTOCK_NOW", suggestedQty: Math.max(Math.min(Math.ceil(i.salesVelocity * 30), room), 1),
      reason: `${i.stock} on hand, below the reorder point of ${i.reorderPoint}. ~${daysOfCover!.toFixed(0)} days of cover at current sales.` };
  }
  if (marginPct !== null && marginPct >= OPPORTUNITY_MARGIN_PCT && stockPct <= 60 && !marketFalling && room > 0) {
    return { ...base, tag: "OPPORTUNITY_BUY", suggestedQty: Math.max(Math.min(Math.ceil(i.salesVelocity * 45), room), 1),
      reason: `Competitors sell at ${marginPct.toFixed(0)}% above your cost and the market is steady. Room to buy ahead.` };
  }
  return { ...base, tag: "HOLD", suggestedQty: 0,
    reason: stockPct > 60 ? `Healthy stock at ${stockPct.toFixed(0)}% of capacity. No purchase needed.` : "Stock and market are within normal range." };
}

export interface RecommendationRow extends AdvisorResult {
  variantId: string;
  sku: string;
  name: string;
  stock: number;
  capacity: number;
  costCents: number;
  marketCents: number | null;
}

export async function getRecommendations(orgId: string) {
  const { rows } = await pool.query(
    `select pv.id as variant_id, pv.sku, p.name, pv.unit_cost_cents, pv.sales_velocity::float as velocity,
            inv.stock, inv.cap, inv.rp, mkt.market_cents, mkt.prev_cents
       from product_variants pv
       join products p on p.id = pv.product_id
       cross join lateral (select coalesce(sum(on_hand),0)::int as stock, coalesce(sum(max_capacity),0)::int as cap,
                                  coalesce(sum(reorder_point),0)::int as rp
                             from inventory_levels where product_variant_id = pv.id) inv
       left join lateral (
         select avg(cur.price_cents)::float as market_cents, avg(prev.price_cents)::float as prev_cents
           from competitor_products cp
           join lateral (select price_cents from price_snapshots s where s.competitor_product_id = cp.id
                          and coalesce(s.validation_flag,'ok') = 'ok' order by observed_at desc limit 1) cur on true
           left join lateral (select price_cents from price_snapshots s where s.competitor_product_id = cp.id
                          and s.observed_at < now() - interval '7 days' and coalesce(s.validation_flag,'ok') = 'ok'
                          order by observed_at desc limit 1) prev on true
          where cp.product_variant_id = pv.id) mkt on true
      where p.organization_id = $1 and p.deleted_at is null and pv.deleted_at is null
      order by p.name`,
    [orgId],
  );

  const items: RecommendationRow[] = rows.map((r) => ({
    variantId: r.variant_id, sku: r.sku, name: r.name, stock: r.stock, capacity: r.cap,
    costCents: r.unit_cost_cents, marketCents: r.market_cents === null ? null : Math.round(r.market_cents),
    ...evaluate({ stock: r.stock, capacity: r.cap, reorderPoint: r.rp, salesVelocity: r.velocity ?? 0,
      costCents: r.unit_cost_cents, marketCents: r.market_cents, prevMarketCents: r.prev_cents }),
  }));

  const sum = (f: (x: RecommendationRow) => number) => items.reduce((a, x) => a + f(x), 0);
  const summary = {
    criticalRestocks: items.filter((x) => x.tag === "RESTOCK_NOW").length,
    opportunityCount: items.filter((x) => x.tag === "OPPORTUNITY_BUY").length,
    opportunityCapitalCents: sum((x) => (x.tag === "OPPORTUNITY_BUY" ? x.suggestedQty * x.costCents : 0)),
    overstockCount: items.filter((x) => x.tag === "LIQUIDATE").length,
    overstockValueCents: sum((x) => (x.tag === "LIQUIDATE" ? x.stock * x.costCents : 0)),
  };
  return { items, summary };
}
