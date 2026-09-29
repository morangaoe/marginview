import { describe, expect, it } from "vitest";
import { validateSnapshot } from "./validateSnapshot";

describe("validateSnapshot", () => {
  it("returns ok when there is no prior price", () => {
    expect(validateSnapshot({ priceCents: 1000, currency: "USD", inStock: null, rawText: "10", confidence: "high" }, null)).toBe("ok");
  });

  it("returns ok for a small change", () => {
    expect(validateSnapshot({ priceCents: 1050, currency: "USD", inStock: null, rawText: "10.50", confidence: "high" }, 1000)).toBe("ok");
  });

  it("returns out_of_band for a >40% spike", () => {
    expect(validateSnapshot({ priceCents: 1500, currency: "USD", inStock: null, rawText: "15", confidence: "high" }, 1000)).toBe("out_of_band");
  });

  it("returns out_of_band for a >40% drop", () => {
    expect(validateSnapshot({ priceCents: 500, currency: "USD", inStock: null, rawText: "5", confidence: "high" }, 1000)).toBe("out_of_band");
  });

  it("returns low_confidence for medium confidence with >20% change", () => {
    expect(validateSnapshot({ priceCents: 1250, currency: "USD", inStock: null, rawText: "12.50", confidence: "medium" }, 1000)).toBe("low_confidence");
  });

  it("returns ok for medium confidence with small change", () => {
    expect(validateSnapshot({ priceCents: 1050, currency: "USD", inStock: null, rawText: "10.50", confidence: "medium" }, 1000)).toBe("ok");
  });

  it("returns low_confidence when price is null", () => {
    expect(validateSnapshot({ priceCents: null, currency: "USD", inStock: null, rawText: null, confidence: "low" }, 1000)).toBe("low_confidence");
  });

  it("ok when prior price is 0 (avoids divide by zero)", () => {
    expect(validateSnapshot({ priceCents: 999, currency: "USD", inStock: null, rawText: "9.99", confidence: "high" }, 0)).toBe("ok");
  });
});
