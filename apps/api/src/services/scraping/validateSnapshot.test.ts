import { describe, expect, it } from "vitest";
import { validateSnapshot } from "./validateSnapshot";

describe("validateSnapshot", () => {
  it("returns ok when there is no prior price", () => {
    expect(validateSnapshot({ priceCents: 1000, confidence: "high" }, null)).toBe("ok");
  });

  it("returns ok for a small change", () => {
    expect(validateSnapshot({ priceCents: 1050, confidence: "high" }, 1000)).toBe("ok");
  });

  it("returns out_of_band for a >40% spike", () => {
    expect(validateSnapshot({ priceCents: 1500, confidence: "high" }, 1000)).toBe("out_of_band");
  });

  it("returns out_of_band for a >40% drop", () => {
    expect(validateSnapshot({ priceCents: 500, confidence: "high" }, 1000)).toBe("out_of_band");
  });

  it("returns low_confidence for medium confidence with >20% change", () => {
    expect(validateSnapshot({ priceCents: 1250, confidence: "medium" }, 1000)).toBe("low_confidence");
  });

  it("returns ok for medium confidence with small change", () => {
    expect(validateSnapshot({ priceCents: 1050, confidence: "medium" }, 1000)).toBe("ok");
  });

  it("ok when prior price is 0 (avoids divide by zero)", () => {
    expect(validateSnapshot({ priceCents: 999, confidence: "high" }, 0)).toBe("ok");
  });
});
