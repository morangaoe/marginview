import { describe, expect, it } from "vitest";
import { computeStrategy } from "./pricingStrategies";

describe("computeStrategy", () => {
  it("cost_plus applies the target margin on top of cost", () => {
    const r = computeStrategy("cost_plus", {
      unitCostCents: 1000,
      competitorPricesCents: [],
      currentPriceCents: null,
      parameters: { targetMarginPct: 50 },
    });
    expect(r.recommendedPriceCents).toBe(1500);
    expect(r.warning).toBeNull();
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