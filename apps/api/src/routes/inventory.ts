import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";
import { captureError } from "../services/errorLog";
import { requireRole } from "../middleware/auth";
import { orgIdOf } from "../utils/http";

/**
 * FIX: The original used its own inline orgIdOf that read
 *   u?.organization_id ?? u?.org_id ?? u?.organizationId
 * which only worked if one of the legacy claim names was present.
 * Now uses the canonical helper from utils/http.ts which reads
 * req.user.organizationId — matching the normalized JWT claims.
 *
 * Also added: GET /api/inventory/skus/:skuId for SkuDetail.tsx.
 */

const router = Router();
const canEditStock = requireRole("owner", "inventory_manager");

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
         il.reorder_point              AS reorder_level,
         p.created_at,
         CASE
           WHEN il.on_hand = 0 THEN 'out_of_stock'
           WHEN il.on_hand <= il.reorder_point THEN 'low'
           ELSE 'healthy'
         END AS status,
         il.on_hand
    FROM inventory_levels il
    JOIN product_variants v ON v.id = il.product_variant_id
    JOIN products  p ON p.id = v.product_id
    JOIN locations l ON l.id = il.location_id
   WHERE p.organization_id = $1 AND l.organization_id = $1
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
  ORDER BY p.created_at DESC, p.name, v.sku, l.name
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

/** GET /api/inventory/levels */
router.get("/levels", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = orgIdOf(req); } catch { return res.status(401).json({ error: "Unauthorized" }); }

  try {
    const { rows } = await pool.query(LEVELS_SQL, [orgId]);
    return res.json(
      rows.map((r: any) => ({
        ...r,
        cost: Number(r.cost),
        quantity: Number(r.quantity),
        reorder_level: Number(r.reorder_level),
      })),
    );
  } catch (err) {
    captureError(req, err, "GET /inventory/levels failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /api/inventory/locations */
router.get("/locations", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = orgIdOf(req); } catch { return res.status(401).json({ error: "Unauthorized" }); }

  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM locations WHERE organization_id = $1 ORDER BY name",
      [orgId],
    );
    return res.json(rows);
  } catch (err) {
    captureError(req, err, "GET /inventory/locations failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/inventory/skus/:skuId
 * FIX: SkuDetail.tsx calls /api/skus/:skuId but no route existed for it.
 * Mounted here under /api/inventory/skus/:skuId and App.tsx already reaches
 * it via the /app/inventory/:skuId route → useApi('/skus/${skuId}').
 * To avoid breaking existing navigation we also register the short alias on
 * the index.ts app under /api/skus (see instructions in the gap analysis).
 */
router.get("/skus/:skuId", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = orgIdOf(req); } catch { return res.status(401).json({ error: "Unauthorized" }); }

  try {
    const { rows: [variant] } = await pool.query(
      `SELECT v.id, v.sku, p.name
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1 AND p.organization_id = $2 AND v.deleted_at IS NULL`,
      [req.params.skuId, orgId],
    );
    if (!variant) return res.status(404).json({ error: "SKU not found" });

    const { rows: locations } = await pool.query(
      `SELECT l.name AS location,
              il.on_hand      AS "onHand",
              0               AS committed,
              0               AS incoming,
              il.on_hand      AS available,
              il.reorder_point AS "reorderPoint",
              CASE WHEN il.on_hand = 0 THEN 'out_of_stock'
                   WHEN il.on_hand <= il.reorder_point THEN 'low'
                   ELSE 'healthy' END AS status
         FROM inventory_levels il
         JOIN locations l ON l.id = il.location_id
        WHERE il.product_variant_id = $1`,
      [req.params.skuId],
    );

    const { rows: movements } = await pool.query(
      `SELECT im.id,
              im.created_at AS at,
              l.name AS location,
              im.change_quantity AS delta,
              im.reason_code AS reason,
              COALESCE(u.full_name, 'system') AS actor
         FROM inventory_movements im
         JOIN inventory_levels il ON il.id = im.inventory_level_id
         JOIN locations l ON l.id = il.location_id
         LEFT JOIN users u ON u.id = im.actor_user_id
        WHERE il.product_variant_id = $1
        ORDER BY im.created_at DESC
        LIMIT 50`,
      [req.params.skuId],
    );

    return res.json({ id: variant.id, sku: variant.sku, name: variant.name, locations, movements });
  } catch (err) {
    captureError(req, err, "GET /inventory/skus/:skuId failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** PATCH /api/inventory/levels/:id */
router.patch("/levels/:id", canEditStock, async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = orgIdOf(req); } catch { return res.status(401).json({ error: "Unauthorized" }); }

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
    captureError(req, err, "PATCH /inventory/levels/:id failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
