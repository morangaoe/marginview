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

function marginFor(priceCents: number, costCents: number): number {
  if (priceCents <= 0) return 0;
  return Math.round(((priceCents - costCents) / priceCents) * 100);
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
      const targetMarginPct = parameters.targetMarginPct ?? 40;
      const price = Math.round(unitCostCents * (1 + targetMarginPct / 100));
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
      const floor = parameters.floorCents ?? unitCostCents * 1.1;
      const ceiling = parameters.ceilingCents ?? unitCostCents * 2.5;
      let price = competitorAvg ?? floor;
      price = Math.max(floor, Math.min(ceiling, price));
      return {
        recommendedPriceCents: Math.round(price),
        marginPct: marginFor(price, unitCostCents),
        warning: competitorAvg === null ? "No competitor prices tracked yet; using the floor price." : warnIfUnprofitable(price, unitCostCents),
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
