import { describe, expect, it } from "vitest";
import { parsePriceText } from "./extractPrice";

describe("parsePriceText", () => {
  it("parses a simple US dollar amount", () => {
    expect(parsePriceText("$12.99")).toEqual({ cents: 1299, currency: "USD" });
  });

  it("parses GBP", () => {
    expect(parsePriceText("£9.99")).toEqual({ cents: 999, currency: "GBP" });
  });

  it("parses EUR with European comma decimal", () => {
    expect(parsePriceText("12,99 €")).toEqual({ cents: 1299, currency: "EUR" });
  });

  it("parses a whole-number price", () => {
    expect(parsePriceText("$299")).toEqual({ cents: 29900, currency: "USD" });
  });

  it("parses price with thousands separator", () => {
    expect(parsePriceText("$1,299.00")).toEqual({ cents: 129900, currency: "USD" });
  });

  it("returns null for empty string", () => {
    expect(parsePriceText("")).toBeNull();
  });

  it("returns null for text with no number", () => {
    expect(parsePriceText("Out of stock")).toBeNull();
  });

  it("returns null for prices over $1,000,000", () => {
    expect(parsePriceText("$9999999.99")).toBeNull();
  });

  it("returns null for zero", () => {
    expect(parsePriceText("$0.00")).toBeNull();
  });

  it("handles whitespace around price", () => {
    expect(parsePriceText("  $24.50  ")).toEqual({ cents: 2450, currency: "USD" });
  });

  it("parses plain number string (no currency symbol)", () => {
    const result = parsePriceText("49.95");
    expect(result?.cents).toBe(4995);
  });
});
