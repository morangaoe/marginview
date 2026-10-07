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
  email?: string;
  /** Listed in PLATFORM_ADMIN_EMAILS: can see every workspace, user and error. */
  isPlatformAdmin?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}
