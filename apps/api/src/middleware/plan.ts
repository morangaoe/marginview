import { NextFunction, Request, Response } from "express";
import { getOrgTier } from "../services/billing";
import { TIER_MODULES, TIER_RANK, type ModuleKey, type Tier } from "../services/plans";

export function requireModule(module: ModuleKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { effectiveTier } = await getOrgTier(req.user.organizationId);
      if (TIER_MODULES[effectiveTier].includes(module)) return next();

      const requiredTier = (Object.keys(TIER_RANK) as Tier[])
        .sort((a, b) => TIER_RANK[a] - TIER_RANK[b])
        .find((tier) => TIER_MODULES[tier].includes(module));
      return res.status(402).json({
        error: "Your plan doesn't include this module.",
        code: "upgrade_required",
        requiredTier,
      });
    } catch (error) {
      next(error);
    }
  };
}
