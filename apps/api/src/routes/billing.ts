import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getPlanUsage } from "../services/billing";
import { getBillingOverview } from "../services/billingOverview";

export const billingRouter = Router();
billingRouter.use(requireAuth);

billingRouter.get("/usage", async (req, res) => {
  const usage = await getPlanUsage(req.user!.organizationId);
  res.json(usage);
});

// NEW: org-level credits, invite code (owners only) and plan options
billingRouter.get("/overview", async (req, res) => {
  res.json(await getBillingOverview(req.user!.organizationId, req.user!.id));
});
