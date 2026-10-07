import { describe, expect, it } from "vitest";
import { auditCatalog } from "./priceAudit";

const row = (sku: string, costCents: number, priceCents: number | null, quantity = 0) => ({ sku, name: sku, costCents, priceCents, quantity });

describe("auditCatalog", () => {
  it("classifies margins and sizes the gap to the target", () => {
    const r = auditCatalog([
      row("A", 1000, 2000),   // 50% healthy
      row("B", 1000, 1400),   // 29% below target (40%)
      row("C", 1000, 1100),   // 9% thin
      row("D", 1000, 900),    // loss
      row("E", 1000, null),   // no price
    ]);
    expect(r.totals).toMatchObject({ skus: 5, priced: 4, healthy: 1, belowTarget: 1, thin: 1, loss: 1, noPrice: 1 });
    // target price for cost 1000 at 40% margin is 1667
    expect(r.rows.find((x) => x.sku === "B")!.gapPerUnitCents).toBe(267);
    expect(r.rows.find((x) => x.sku === "D")!.gapPerUnitCents).toBe(767);
    expect(r.gapOnHandCents).toBeNull();
    expect(r.rows[0].sku).toBe("D"); // losses first
  });

  it("weights the gap by stock on hand when quantities are given", () => {
    const r = auditCatalog([row("B", 1000, 1400, 10)]);
    expect(r.gapOnHandCents).toBe(2670);
  });
});
