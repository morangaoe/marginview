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
export const TIER_NAME: Record<Tier, string> = {
  margin_intelligence: "Margin Intelligence",
  operations_pro: "Operations Pro",
  enterprise: "Enterprise Custom",
};

export function minTierFor(module: ModuleKey): Tier {
  return (Object.keys(TIER_RANK) as Tier[])
    .sort((a, b) => TIER_RANK[a] - TIER_RANK[b])
    .find((tier) => TIER_MODULES[tier].includes(module))!;
}

/** Annual discount. Keep in sync with ANNUAL_DISCOUNT in apps/api/src/services/stripeBilling.ts. */
export const ANNUAL_DISCOUNT = 0.2;

export interface PlanCard {
  tier: Tier;
  badge: string;
  monthlyCents: number | null;
  features: string[];
  highlight?: boolean;
}

export const PLAN_CARDS: PlanCard[] = [
  {
    tier: "margin_intelligence",
    badge: "Connect your existing inventory system",
    monthlyCents: 4900,
    features: [
      "15 tracked competitor sources",
      "Blended pricing: cost-plus, value-based, keystone, dynamic",
      "Competitor spike alerts and margin analysis",
      "Dashboard and price-change history",
      "External data connector setup by request",
      "Unlimited team seats and roles",
    ],
  },
  {
    tier: "operations_pro",
    badge: "Full stock & pricing suite",
    monthlyCents: 19900,
    highlight: true,
    features: [
      "Everything in Margin Intelligence",
      "100 tracked competitor sources",
      "Inventory, SKU catalog and CSV import",
      "Stock capacity and reorder points",
      "Procurement advisor and purchase orders",
      "Supplier management",
    ],
  },
  {
    tier: "enterprise",
    badge: "Tailored scale",
    monthlyCents: null,
    features: [
      "Everything in Operations Pro",
      "Unlimited sources and SKUs",
      "Custom ERP connector setup",
      "Custom pricing algorithms",
      "Enterprise integrations",
      "Dedicated SLA and custom roles",
    ],
  },
];
