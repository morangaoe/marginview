import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth } from "../middleware/auth";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

// Per-SKU, per-location view, per PRD 7.2. Status is computed here rather
// than stored, so it always reflects the current thresholds.
inventoryRouter.get("/levels", async (req, res) => {
  const rows = await query(
    `select il.id, v.sku, p.name, l.name as location_name,
            il.on_hand, il.committed, il.incoming, il.reorder_point, il.reorder_quantity
     from inventory_levels il
     join product_variants v on v.id = il.product_variant_id
     join products p on p.id = v.product_id
     join locations l on l.id = il.location_id
     where p.organization_id = $1
     order by p.name`,
    [req.user!.organizationId]
  );

  const withStatus = rows.map((r: any) => ({
    ...r,
    status:
      r.on_hand === 0
        ? "out_of_stock"
        : r.on_hand <= r.reorder_point
        ? "low"
        : r.on_hand > r.reorder_point * 3
        ? "overstocked"
        : "healthy",
  }));
  res.json(withStatus);
});

const adjustSchema = z.object({
  inventoryLevelId: z.string().uuid(),
  changeQuantity: z.number().int(),
  reasonCode: z.enum(["received", "sold", "damaged", "returned", "recount"]),
  note: z.string().optional(),
});

// Every adjustment requires a reason code (PRD 7.2) and is written to an
// append-only movement log, never a silent overwrite of on_hand.
inventoryRouter.post("/adjust", async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { inventoryLevelId, changeQuantity, reasonCode, note } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `update inventory_levels set on_hand = on_hand + $1, updated_at = now() where id = $2`,
      [changeQuantity, inventoryLevelId]
    );
    await client.query(
      `insert into inventory_movements (inventory_level_id, change_quantity, reason_code, actor_user_id, note)
       values ($1, $2, $3, $4, $5)`,
      [inventoryLevelId, changeQuantity, reasonCode, req.user!.id, note ?? null]
    );
    await client.query("COMMIT");
    res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
