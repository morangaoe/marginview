import express, { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth";
import { getPlanUsage } from "../services/billing";
import { getBillingOverview } from "../services/billingOverview";
import { createCheckoutSession, createPortalSession, processWebhook, stripeEnabled } from "../services/stripeBilling";

export const billingRouter = Router();
export const billingWebhookRouter = Router();

// Stripe signs the exact bytes it sends, so this must receive the raw body.
// Mounted in index.ts BEFORE express.json().
billingWebhookRouter.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  await processWebhook(req.body as Buffer, req.header("stripe-signature"));
  res.json({ received: true });
});

billingRouter.use(requireAuth);

billingRouter.get("/usage", async (req, res) => {
  const usage = await getPlanUsage(req.user!.organizationId);
  res.json(usage);
});

// NEW: org-level credits, invite code (owners only) and plan options
billingRouter.get("/overview", async (req, res) => {
  res.json(await getBillingOverview(req.user!.organizationId, req.user!.id));
});

billingRouter.get("/config", (_req, res) => {
  res.json({ checkoutEnabled: stripeEnabled() });
});

const checkoutSchema = z.object({
  tier: z.enum(["margin_intelligence", "operations_pro"]),
  interval: z.enum(["month", "year"]),
});

// Only the workspace owner can spend the company's money.
billingRouter.post("/checkout", requireRole("owner"), async (req, res) => {
  const body = checkoutSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Choose a plan and billing period." });
  const url = await createCheckoutSession({
    organizationId: req.user!.organizationId,
    email: req.user!.email,
    ...body.data,
  });
  res.json({ url });
});

billingRouter.post("/portal", requireRole("owner"), async (req, res) => {
  res.json({ url: await createPortalSession(req.user!.organizationId) });
});
