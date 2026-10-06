import { StrategyType } from "../types";

export interface StrategyInput {
  unitCostCents: number;
  competitorPricesCents: number[]; // latest known price per tracked competitor
  currentPriceCents: number | null;
  parameters: Record<string, number>;
}

export interface StrategyResult {
  recommendedPriceCents: number;
  marginPct: number; // resulting margin, as a percentage of price
  warning: string | null;
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function marginFor(priceCents: number, costCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.round(((priceCents - costCents) / priceCents) * 100);
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type WeightKey = "cost_plus" | "value_based" | "keystone" | "dynamic";
export type Weights = Record<WeightKey, number>;

/** Normalize weights after adjusting dynamic/keystone shares for available data and stock. */
export function adaptWeights(
  base: Weights,
  ctx: { trusted: number; stockPct: number | null },
  adaptive = true,
): { weights: Weights; notes: string[] } {
  const weights: Weights = { ...base };
  const notes: string[] = [];

  if (adaptive && weights.dynamic > 0) {
    if (ctx.trusted === 0) {
      weights.dynamic = 0;
      notes.push("Dynamic weight set to 0: no trusted competitor prices yet.");
    } else if (ctx.trusted < 3) {
      weights.dynamic *= ctx.trusted / 3;
      notes.push(`Dynamic weight reduced: only ${ctx.trusted} trusted competitor price${ctx.trusted === 1 ? "" : "s"} (full weight at 3).`);
    }
  }
  if (adaptive && ctx.stockPct !== null && ctx.stockPct > 85 && weights.dynamic > 0) {
    weights.dynamic *= 1.5;
    weights.keystone *= 0.7;
    notes.push(`Stock is ${ctx.stockPct.toFixed(0)}% of capacity: shifted weight from keystone toward market pricing.`);
  }

  const total = weights.cost_plus + weights.value_based + weights.keystone + weights.dynamic;
  if (total <= 0) {
    notes.push("All weights were zero or unusable: falling back to 100% cost-plus.");
    return { weights: { cost_plus: 100, value_based: 0, keystone: 0, dynamic: 0 }, notes };
  }
  return {
    weights: {
      cost_plus: (weights.cost_plus / total) * 100,
      value_based: (weights.value_based / total) * 100,
      keystone: (weights.keystone / total) * 100,
      dynamic: (weights.dynamic / total) * 100,
    },
    notes,
  };
}

function warnIfUnprofitable(priceCents: number, costCents: number): string | null {
  if (priceCents <= costCents) {
    return "This price results in zero or negative margin. Review before applying.";
  }
  return null;
}

/**
 * Computes a recommended price for one of the six strategies described in
 * PRD section 7.1. Every branch returns a margin and a warning so the
 * caller can show both before the user confirms (error prevention:
 * nothing here applies a price on its own).
 */
export function computeStrategy(type: StrategyType, input: StrategyInput): StrategyResult {
  const { unitCostCents, competitorPricesCents, parameters } = input;
  const competitorAvg = average(competitorPricesCents);

  switch (type) {
    case "cost_plus": {
      const marginPct = Math.min(Math.max(parameters.targetMarginPct ?? 40, 0), 95);
      const price = Math.round(unitCostCents / (1 - marginPct / 100));
      return { recommendedPriceCents: price, marginPct: marginFor(price, unitCostCents), warning: warnIfUnprofitable(price, unitCostCents) };
    }

    case "keystone": {
      const price = unitCostCents * 2;
      return { recommendedPriceCents: price, marginPct: marginFor(price, unitCostCents), warning: null };
    }

    case "value_based": {
      // parameters.perceivedValueCents is a user-entered willingness-to-pay input,
      // deliberately decoupled from cost.
      const price = Math.round(parameters.perceivedValueCents ?? unitCostCents * 2.2);
      return { recommendedPriceCents: price, marginPct: marginFor(price, unitCostCents), warning: warnIfUnprofitable(price, unitCostCents) };
    }

    case "dynamic": {
      const minMarginPct = Math.min(Math.max(parameters.minMarginPct ?? 10, 0), 95);
      const floor = parameters.floorCents ?? Math.round(unitCostCents / (1 - minMarginPct / 100));
      const maxCompetitor = competitorPricesCents.length ? Math.max(...competitorPricesCents) : null;
      const ceiling = Math.max(
        parameters.ceilingCents ?? (maxCompetitor !== null ? Math.round(maxCompetitor * 1.05) : Math.round(unitCostCents * 2.5)),
        floor,
      );
      const competitorMedian = median(competitorPricesCents);
      const target = competitorMedian === null
        ? floor
        : competitorMedian * (1 + (parameters.positionPct ?? 0) / 100);
      const price = Math.round(Math.max(floor, Math.min(ceiling, target)));
      let warning: string | null;
      if (competitorMedian === null) warning = "No competitor prices tracked yet; using the floor price.";
      else if (target < floor) warning = "Market is below your minimum margin; price held at the floor.";
      else warning = warnIfUnprofitable(price, unitCostCents);
      return {
        recommendedPriceCents: price,
        marginPct: marginFor(price, unitCostCents),
        warning,
      };
    }

    case "penetration": {
      const belowPct = parameters.belowCompetitorPct ?? 15;
      if (competitorAvg === null) {
        return { recommendedPriceCents: unitCostCents, marginPct: 0, warning: "No tracked competitors; cannot compute a penetration price yet." };
      }
      const price = Math.round(competitorAvg * (1 - belowPct / 100));
      return { recommendedPriceCents: price, marginPct: marginFor(price, unitCostCents), warning: warnIfUnprofitable(price, unitCostCents) };
    }

    case "price_skimming": {
      const abovePct = parameters.abovePct ?? 25;
      const base = competitorAvg ?? unitCostCents * 2;
      const price = Math.round(base * (1 + abovePct / 100));
      return { recommendedPriceCents: price, marginPct: marginFor(price, unitCostCents), warning: null };
    }
  }
}

export const DEFAULT_PARAMETERS: Record<StrategyType, Record<string, number>> = {
  cost_plus: { targetMarginPct: 40 },
  value_based: {},
  dynamic: {},
  keystone: {},
  penetration: { belowCompetitorPct: 15 },
  price_skimming: { abovePct: 25 },
};
