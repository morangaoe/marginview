import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getPlanUsage } from "../services/billing";

export const billingRouter = Router();
billingRouter.use(requireAuth);

billingRouter.get("/usage", async (req, res) => {
  const usage = await getPlanUsage(req.user!.organizationId);
  res.json(usage);
});
