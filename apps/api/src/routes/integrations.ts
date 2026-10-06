import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { encrypt } from "../services/crypto";
import { callClaude } from "../services/gemini";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get("/claude", async (req, res) => {
  const [row] = await query<{ key_last4: string; model: string | null }>(
    "select key_last4, model from org_integrations where organization_id = $1 and provider = 'claude'",
    [req.user!.organizationId],
  );
  const [{ n }] = await query<{ n: string }>(
    "select count(*)::text as n from ai_usage where organization_id = $1 and created_at >= date_trunc('month', now())",
    [req.user!.organizationId],
  );
  res.json({
    ownKey: !!row,
    last4: row?.key_last4 ?? null,
    model: row?.model ?? null,
    platformKeyAvailable: !!process.env.ANTHROPIC_API_KEY,
    usageThisMonth: Number(n),
    monthlyLimit: Number(process.env.AI_MONTHLY_LIMIT ?? 200),
  });
});

const putSchema = z.object({ apiKey: z.string().min(20).max(200), model: z.string().max(60).optional() });

integrationsRouter.put("/claude", requireRole("owner"), async (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid Claude API key." });
  const { apiKey, model } = parsed.data;

  // Verify the key works before storing it.
  await callClaude({ apiKey, model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514", source: "org" }, {
    prompt: 'Reply with {"ok":true}',
  });

  await query(
    `insert into org_integrations (organization_id, provider, key_ciphertext, key_last4, model, created_by_user_id)
     values ($1,'claude',$2,$3,$4,$5)
     on conflict (organization_id, provider)
     do update set key_ciphertext = excluded.key_ciphertext, key_last4 = excluded.key_last4,
                   model = excluded.model, updated_at = now()`,
    [req.user!.organizationId, encrypt(apiKey), apiKey.slice(-4), model ?? null, req.user!.id],
  );
  res.status(204).send();
});

integrationsRouter.delete("/claude", requireRole("owner"), async (req, res) => {
  await query("delete from org_integrations where organization_id = $1 and provider = 'claude'", [req.user!.organizationId]);
  res.status(204).send();
});
