import { describe, expect, it } from "vitest";

// Mirrors the threshold logic inside services/billing.ts getPlanUsage.
// Kept here as a pure function so the 80%/100% breakpoints from the
// Pricing & Packaging Strategy doc are locked down without needing a
// database connection to test them.
function nudgeFor(used: number, included: number | null) {
  if (included === null) return null;
  if (used >= included) return "over";
  if (used >= included * 0.8) return "approaching";
  return null;
}

describe("billing nudge thresholds", () => {
  it("shows no nudge well under the included volume", () => {
    expect(nudgeFor(5, 15)).toBeNull();
  });
  it("shows 'approaching' at 80% or more of included volume", () => {
    expect(nudgeFor(12, 15)).toBe("approaching");
  });
  it("shows 'over' once usage reaches the included volume", () => {
    expect(nudgeFor(15, 15)).toBe("over");
  });
  it("never nudges an unmetered (Scale) plan", () => {
    expect(nudgeFor(500, null)).toBeNull();
  });
});
