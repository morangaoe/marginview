export type Tier = "margin_intelligence" | "operations_pro" | "enterprise";
export type ModuleKey =
  | "dashboard" | "inventory" | "pricing" | "procurement"
  | "billing" | "settings" | "team" | "integrations";

const CORE: ModuleKey[] = ["dashboard", "pricing", "settings", "team", "billing"];

export const TIER_MODULES: Record<Tier, ModuleKey[]> = {
  margin_intelligence: CORE,
  operations_pro: [...CORE, "inventory", "procurement"],
  enterprise: [...CORE, "inventory", "procurement", "integrations"],
};

export const TIER_RANK: Record<Tier, number> = {
  margin_intelligence: 1,
  operations_pro: 2,
  enterprise: 3,
};

export const isTier = (value: unknown): value is Tier =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(TIER_RANK, value);

export function effectiveTierFor(tier: Tier, status: string): Tier {
  return status === "trialing" && TIER_RANK[tier] < TIER_RANK.operations_pro
    ? "operations_pro"
    : tier;
}
