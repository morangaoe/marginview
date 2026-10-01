import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";

const router = Router();

// Adjust to however your auth middleware attaches the user.
const orgIdOf = (req: Request): string | undefined => {
  const u = (req as any).user;
  return u?.organization_id ?? u?.org_id ?? u?.organizationId;
};

const isWholeNonNeg = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

const LEVELS_SQL = `
  SELECT il.id,
         il.product_variant_id         AS variant_id,
         v.product_id,
         v.sku,
         p.name                        AS product_name,
         COALESCE(p.category, 'Other') AS category,
         v.unit_cost_cents             AS cost,
         il.location_id,
         l.name                        AS location_name,
         il.on_hand                    AS quantity,
         il.reorder_point              AS reorder_level
    FROM inventory_levels il
    JOIN product_variants v ON v.id = il.product_variant_id
    JOIN products  p ON p.id = v.product_id
    JOIN locations l ON l.id = il.location_id
   WHERE p.organization_id = $1 AND l.organization_id = $1
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
   ORDER BY p.name, v.sku, l.name
`;

const UPDATE_LEVEL_SQL = `
  UPDATE inventory_levels il
     SET on_hand       = COALESCE($3, il.on_hand),
         reorder_point = COALESCE($4, il.reorder_point),
         updated_at    = now()
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
   WHERE il.id = $1 AND il.product_variant_id = v.id
     AND p.organization_id = $2
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
  RETURNING il.id,
            il.product_variant_id AS variant_id,
            il.location_id,
            il.on_hand       AS quantity,
            il.reorder_point AS reorder_level
`;

/** GET /api/inventory/levels (cost is in cents) */
router.get("/levels", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await pool.query(LEVELS_SQL, [orgId]);
    return res.json(
      rows.map((r: any) => ({
        ...r,
        cost: Number(r.cost),
        quantity: Number(r.quantity),
        reorder_level: Number(r.reorder_level),
      }))
    );
  } catch (err) {
    console.error("GET /inventory/levels failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/inventory/locations */
router.get("/locations", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM locations WHERE organization_id = $1 ORDER BY name",
      [orgId]
    );
    return res.json(rows);
  } catch (err) {
    console.error("GET /inventory/locations failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/inventory/levels/:id  body: { quantity?, reorder_level? } */
router.patch("/levels/:id", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const { quantity, reorder_level } = req.body ?? {};
  if (quantity === undefined && reorder_level === undefined) {
    return res.status(400).json({ error: "Provide quantity and/or reorder_level" });
  }
  if (quantity !== undefined && !isWholeNonNeg(quantity)) {
    return res.status(400).json({ error: "quantity must be a non-negative integer" });
  }
  if (reorder_level !== undefined && !isWholeNonNeg(reorder_level)) {
    return res.status(400).json({ error: "reorder_level must be a non-negative integer" });
  }

  try {
    const { rows } = await pool.query(UPDATE_LEVEL_SQL, [
      req.params.id,
      orgId,
      quantity ?? null,
      reorder_level ?? null,
    ]);
    if (rows.length === 0) return res.status(404).json({ error: "Inventory level not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("PATCH /inventory/levels/:id failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
