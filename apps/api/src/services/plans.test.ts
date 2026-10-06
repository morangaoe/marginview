import { describe, expect, it } from "vitest";
import { effectiveTierFor } from "./plans";

describe("effectiveTierFor", () => {
  it("gives a Starter trial Operations Pro access", () => {
    expect(effectiveTierFor("margin_intelligence", "trialing")).toBe("operations_pro");
  });

  it("does not reduce a higher-tier trial", () => {
    expect(effectiveTierFor("enterprise", "trialing")).toBe("enterprise");
  });

  it("keeps paid Starter on Margin Intelligence", () => {
    expect(effectiveTierFor("margin_intelligence", "active")).toBe("margin_intelligence");
  });
});