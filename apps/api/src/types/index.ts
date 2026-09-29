export type StrategyType =
  | "cost_plus"
  | "value_based"
  | "dynamic"
  | "keystone"
  | "penetration"
  | "price_skimming";

export interface AuthedUser {
  id: string;
  organizationId: string;
  role: "owner" | "pricing_manager" | "inventory_manager" | "viewer";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}
