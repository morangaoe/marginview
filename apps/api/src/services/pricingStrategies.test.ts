import { describe, expect, it } from "vitest";
import { adaptWeights, computeStrategy, median } from "./pricingStrategies";

describe("computeStrategy", () => {
  it("cost_plus treats the target as a margin on selling price", () => {
    const r = computeStrategy("cost_plus", {
      unitCostCents: 1000,
      competitorPricesCents: [],
      currentPriceCents: null,
      parameters: { targetMarginPct: 50 },
    });
    expect(r.recommendedPriceCents).toBe(2000);
    expect(r.warning).toBeNull();
  });

  it("calculates an even-count median", () => {
    expect(median([3000, 1000, 2000, 4000])).toBe(2500);
    expect(median([])).toBeNull();
  });

  it("removes dynamic weight when no trusted competitors exist", () => {
    const result = adaptWeights({ cost_plus: 10, value_based: 20, keystone: 30, dynamic: 40 }, { trusted: 0, stockPct: null });
    expect(result.weights.dynamic).toBe(0);
    expect(result.weights.cost_plus + result.weights.value_based + result.weights.keystone + result.weights.dynamic).toBeCloseTo(100);
    expect(result.notes[0]).toMatch(/no trusted competitor/i);
  });

  it("reduces dynamic weight with sparse competitors and shifts it up for overstock", () => {
    const sparse = adaptWeights({ cost_plus: 10, value_based: 20, keystone: 30, dynamic: 40 }, { trusted: 1, stockPct: null });
    expect(sparse.notes[0]).toMatch(/only 1 trusted/i);
    const overstock = adaptWeights({ cost_plus: 10, value_based: 20, keystone: 30, dynamic: 40 }, { trusted: 3, stockPct: 90 });
    expect(overstock.notes[0]).toMatch(/90% of capacity/i);
    expect(overstock.weights.dynamic).toBeGreaterThan(40);
  });

  it("keystone doubles unit cost regardless of competitors", () => {
    const r = computeStrategy("keystone", {
      unitCostCents: 900,
      competitorPricesCents: [5000],
      currentPriceCents: null,
      parameters: {},
    });
    expect(r.recommendedPriceCents).toBe(1800);
  });

  it("dynamic stays within the floor and ceiling even if competitors are far outside them", () => {
    const r = computeStrategy("dynamic", {
      unitCostCents: 1000,
      competitorPricesCents: [10000],
      currentPriceCents: null,
      parameters: { floorCents: 1200, ceilingCents: 1800 },
    });
    expect(r.recommendedPriceCents).toBe(1800);
  });

  it("dynamic targets the competitor median with a position adjustment and margin floor", () => {
    const r = computeStrategy("dynamic", {
      unitCostCents: 1000,
      competitorPricesCents: [1200, 1500, 9000],
      currentPriceCents: null,
      parameters: { minMarginPct: 20, positionPct: -10 },
    });
    expect(r.recommendedPriceCents).toBe(1350);
  });

  it("holds dynamic price at its minimum-margin floor when market median is too low", () => {
    const r = computeStrategy("dynamic", {
      unitCostCents: 1000,
      competitorPricesCents: [500, 600, 700],
      currentPriceCents: null,
      parameters: { minMarginPct: 20 },
    });
    expect(r.recommendedPriceCents).toBe(1250);
    expect(r.warning).toMatch(/below your minimum margin/i);
  });

  it("penetration warns instead of guessing when there are no tracked competitors", () => {
    const r = computeStrategy("penetration", {
      unitCostCents: 1000,
      competitorPricesCents: [],
      currentPriceCents: null,
      parameters: {},
    });
    expect(r.warning).toMatch(/no tracked competitors/i);
  });

  it("flags a price at or below cost as a negative-margin warning", () => {
    const r = computeStrategy("value_based", {
      unitCostCents: 1000,
      competitorPricesCents: [],
      currentPriceCents: null,
      parameters: { perceivedValueCents: 900 },
    });
    expect(r.warning).toMatch(/negative margin/i);
  });
});
