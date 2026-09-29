/**
 * Suppliers: list, create, update. Suppliers are org-scoped so the
 * procurement PO creation screen can show a real picker.
 */

import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

suppliersRouter.get("/", async (req, res) => {
  const rows = await query(
    `select id, name, contact_email, default_lead_time_days, created_at
     from suppliers
     where organization_id = $1
     order by name`,
    [req.user!.organizationId]
  );
  res.json(rows);
});

const createSchema = z.object({
  name: z.string().min(1),
  contactEmail: z.string().email().optional(),
  defaultLeadTimeDays: z.number().int().min(1).max(365).default(14),
});

suppliersRouter.post("/", requireRole("owner", "inventory_manager"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, contactEmail, defaultLeadTimeDays } = parsed.data;

  const [supplier] = await query(
    `insert into suppliers (organization_id, name, contact_email, default_lead_time_days)
     values ($1, $2, $3, $4) returning id, name`,
    [req.user!.organizationId, name, contactEmail ?? null, defaultLeadTimeDays]
  );
  res.status(201).json(supplier);
});

const updateSchema = createSchema.partial();

suppliersRouter.patch("/:id", requireRole("owner", "inventory_manager"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, contactEmail, defaultLeadTimeDays } = parsed.data;

  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name); }
  if (contactEmail !== undefined) { sets.push(`contact_email = $${i++}`); vals.push(contactEmail); }
  if (defaultLeadTimeDays !== undefined) { sets.push(`default_lead_time_days = $${i++}`); vals.push(defaultLeadTimeDays); }

  if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });

  sets.push(`updated_at = now()`);
  vals.push(req.params.id);

  await query(
    `update suppliers set ${sets.join(", ")} where id = $${i} and organization_id = $${i + 1}`,
    [...vals, req.user!.organizationId]
  );

  res.status(204).send();
});
