import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { getRecommendations } from "../services/procurementAdvisor";

export const procurementRouter = Router();
procurementRouter.use(requireAuth);

// NEW: stock + sales speed + competitor prices -> RESTOCK / OPPORTUNITY / HOLD / LIQUIDATE
procurementRouter.get("/recommendations", async (req, res) => {
  res.json(await getRecommendations(req.user!.organizationId));
});

procurementRouter.get("/suggestions", async (req, res) => {
  const rows = await query(
    `select s.id, s.suggested_quantity, s.reason, s.status,
            v.id as product_variant_id, v.sku,
            p.name,
            l.id as location_id, l.name as location_name
     from procurement_suggestions s
     join product_variants v on v.id = s.product_variant_id
     join products p on p.id = v.product_id
     join locations l on l.id = s.location_id
     where p.organization_id = $1 and s.status = 'open'
     order by s.generated_at desc`,
    [req.user!.organizationId]
  );
  res.json(rows);
});

const createPoSchema = z.object({
  suggestionId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  locationId: z.string().uuid(),
  items: z.array(
    z.object({
      productVariantId: z.string().uuid(),
      quantityOrdered: z.number().int().positive(),
      unitCostCents: z.number().int().nonnegative(),
    })
  ).min(1),
});

// Creates a draft PO, pre-filled from a suggestion when one is provided,
// per App Flow 3.3. Nothing here marks stock as incoming until the PO is
// actually sent; that transition is a separate status update.
procurementRouter.post("/purchase-orders", async (req, res) => {
  const parsed = createPoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { suggestionId, supplierId, locationId, items } = parsed.data;
  const orgId = req.user!.organizationId;

  // Tenant check: supplier, location and every variant must belong to the caller's organization.
  const variantIds = [...new Set(items.map((i) => i.productVariantId))];
  const [chk] = await query<{ s: number; l: number; v: number }>(
    `select
       (select count(*) from suppliers where id = $1 and organization_id = $3)::int as s,
       (select count(*) from locations where id = $2 and organization_id = $3)::int as l,
       (select count(*) from product_variants pv join products p on p.id = pv.product_id
         where pv.id = any($4::uuid[]) and p.organization_id = $3)::int as v`,
    [supplierId, locationId, orgId, variantIds]
  );
  if (!chk || chk.s !== 1 || chk.l !== 1 || chk.v !== variantIds.length) {
    return res.status(404).json({ error: "Supplier, location or product not found." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [po] = (await client.query(
      `insert into purchase_orders (organization_id, supplier_id, location_id, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [orgId, supplierId, locationId, req.user!.id]
    )).rows;

    for (const item of items) {
      await client.query(
        `insert into purchase_order_items (purchase_order_id, product_variant_id, quantity_ordered, unit_cost_cents)
         values ($1, $2, $3, $4)`,
        [po.id, item.productVariantId, item.quantityOrdered, item.unitCostCents]
      );
    }

    if (suggestionId) {
      await client.query(
        `update procurement_suggestions s set status = 'actioned'
           from product_variants v join products p on p.id = v.product_id
          where s.id = $1 and v.id = s.product_variant_id and p.organization_id = $2`,
        [suggestionId, orgId]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ purchaseOrderId: po.id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

const statusSchema = z.object({
  status: z.enum(["draft", "sent", "partially_received", "received", "closed"]),
});

procurementRouter.patch("/purchase-orders/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await pool.query(
    `update purchase_orders set status = $1, updated_at = now() where id = $2 and organization_id = $3`,
    [parsed.data.status, req.params.id, req.user!.organizationId]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Purchase order not found." });
  res.status(204).send();
});
