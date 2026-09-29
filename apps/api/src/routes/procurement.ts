import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth } from "../middleware/auth";

export const procurementRouter = Router();
procurementRouter.use(requireAuth);

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const [po] = (await client.query(
      `insert into purchase_orders (organization_id, supplier_id, location_id, created_by_user_id)
       values ($1, $2, $3, $4) returning id`,
      [req.user!.organizationId, supplierId, locationId, req.user!.id]
    )).rows;

    for (const item of items) {
      await client.query(
        `insert into purchase_order_items (purchase_order_id, product_variant_id, quantity_ordered, unit_cost_cents)
         values ($1, $2, $3, $4)`,
        [po.id, item.productVariantId, item.quantityOrdered, item.unitCostCents]
      );
    }

    if (suggestionId) {
      await client.query(`update procurement_suggestions set status = 'actioned' where id = $1`, [suggestionId]);
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
  await query(`update purchase_orders set status = $1, updated_at = now() where id = $2`, [
    parsed.data.status,
    req.params.id,
  ]);
  res.status(204).send();
});
