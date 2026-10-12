import { describe, expect, it } from "vitest";
import { mapStatus, unitAmountCents } from "./stripeBilling";

describe("unitAmountCents", () => {
  it("charges the monthly price for monthly billing", () => {
    expect(unitAmountCents(4900, "month")).toBe(4900);
  });
  it("charges 12 months less 20% for annual billing", () => {
    expect(unitAmountCents(4900, "year")).toBe(47040);
    expect(unitAmountCents(19900, "year")).toBe(191040);
  });
});

describe("mapStatus", () => {
  it("treats trialing and active as active", () => {
    expect(mapStatus("active")).toBe("active");
    expect(mapStatus("trialing")).toBe("active");
  });
  it("maps failed payments to past_due and ended subscriptions to canceled", () => {
    expect(mapStatus("past_due")).toBe("past_due");
    expect(mapStatus("unpaid")).toBe("past_due");
    expect(mapStatus("canceled")).toBe("canceled");
  });
  it("ignores incomplete checkouts", () => {
    expect(mapStatus("incomplete")).toBeNull();
  });
});
