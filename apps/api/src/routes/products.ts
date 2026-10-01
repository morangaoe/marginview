import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool";

const router = Router();

// Adjust to however your auth middleware attaches the user.
const orgIdOf = (req: Request): string | undefined => {
  const u = (req as any).user;
  return u?.organization_id ?? u?.org_id ?? u?.organizationId;
};

const MAX_BULK_ROWS = 2000;
type Db = Pick<PoolClient, "query">;

interface ProductInput {
  sku: string;
  name: string;
  category: string;
  cost_cents: number;
  quantity: number;
  reorder_level: number;
}

const isWholeNonNeg = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0;

function validateProduct(p: any): string[] {
  const errs: string[] = [];
  if (typeof p?.sku !== "string" || !p.sku.trim()) errs.push("sku is required");
  if (typeof p?.name !== "string" || !p.name.trim()) errs.push("name is required");
  if (typeof p?.category !== "string" || !p.category.trim()) errs.push("category is required");
  if (!isWholeNonNeg(p?.cost_cents) || p.cost_cents <= 0) errs.push("cost_cents must be a positive integer (cents)");
  if (!isWholeNonNeg(p?.quantity)) errs.push("quantity must be a non-negative integer");
  if (!isWholeNonNeg(p?.reorder_level)) errs.push("reorder_level must be a non-negative integer");
  return errs;
}

const SKU_CHECK_SQL = `
  SELECT v.sku
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
   WHERE p.organization_id = $1
     AND v.sku = ANY($2::text[])
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
     AND ($3::uuid IS NULL OR v.id <> $3::uuid)
`;

/** Org-wide SKU check across live variants (the DB only enforces uniqueness per product). */
async function findExistingSkus(db: Db, orgId: string, skus: string[], excludeVariantId?: string): Promise<Set<string>> {
  if (skus.length === 0) return new Set<string>();
  const { rows } = await db.query(SKU_CHECK_SQL, [orgId, skus, excludeVariantId ?? null]);
  return new Set<string>(rows.map((r: any) => r.sku as string));
}

async function resolveLocationId(db: Db, orgId: string, requested?: string): Promise<string | null> {
  if (requested) {
    const { rows } = await db.query(
      "SELECT id FROM locations WHERE id = $1 AND organization_id = $2",
      [requested, orgId]
    );
    return rows[0]?.id ?? null;
  }
  const { rows } = await db.query(
    "SELECT id FROM locations WHERE organization_id = $1 ORDER BY name LIMIT 1",
    [orgId]
  );
  if (rows[0]) return rows[0].id;

  // New organizations start with no locations; create a default instead of leaving the user stuck.
  const created = await db.query(
    "INSERT INTO locations (organization_id, name) VALUES ($1, 'Main Warehouse') RETURNING id",
    [orgId]
  );
  return created.rows[0].id;
}

async function insertProduct(db: Db, orgId: string, locationId: string, p: ProductInput) {
  const prod = await db.query(
    "INSERT INTO products (organization_id, name, category) VALUES ($1, $2, $3) RETURNING id",
    [orgId, p.name.trim(), p.category.trim()]
  );
  const variant = await db.query(
    "INSERT INTO product_variants (product_id, sku, unit_cost_cents) VALUES ($1, $2, $3) RETURNING id",
    [prod.rows[0].id, p.sku.trim(), p.cost_cents]
  );
  const level = await db.query(
    "INSERT INTO inventory_levels (product_variant_id, location_id, on_hand, reorder_point) VALUES ($1, $2, $3, $4) RETURNING id",
    [variant.rows[0].id, locationId, p.quantity, p.reorder_level]
  );
  return { product_id: prod.rows[0].id, variant_id: variant.rows[0].id, level_id: level.rows[0].id };
}

const LIST_SQL = `
  SELECT v.id AS variant_id, p.id AS product_id, v.sku, p.name, p.category,
         v.unit_cost_cents AS cost_cents
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
   WHERE p.organization_id = $1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL
   ORDER BY p.name, v.sku
`;

const FIND_VARIANT_SQL = `
  SELECT v.id, v.product_id
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
   WHERE v.id = $1 AND p.organization_id = $2
     AND v.deleted_at IS NULL AND p.deleted_at IS NULL
   FOR UPDATE OF v
`;

/** GET /api/products */
router.get("/", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { rows } = await pool.query(LIST_SQL, [orgId]);
    return res.json(rows.map((r: any) => ({ ...r, cost_cents: Number(r.cost_cents) })));
  } catch (err) {
    console.error("GET /products failed", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/products  body: ProductInput & { location_id? } */
router.post("/", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const errs = validateProduct(req.body);
  if (errs.length) return res.status(400).json({ error: errs.join("; ") });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const dupes = await findExistingSkus(client, orgId, [req.body.sku.trim()]);
    if (dupes.size) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `SKU "${req.body.sku.trim()}" already exists` });
    }
    const locationId = await resolveLocationId(client, orgId, req.body.location_id);
    if (!locationId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No valid location found; create a location first" });
    }
    const ids = await insertProduct(client, orgId, locationId, req.body);
    await client.query("COMMIT");
    return res.status(201).json(ids);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("POST /products failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/** POST /api/products/bulk  body: { items: ProductInput[], location_id? }. All-or-nothing. */
router.post("/bulk", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const items: unknown = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  if (items.length > MAX_BULK_ROWS) {
    return res.status(413).json({ error: `Too many rows (max ${MAX_BULK_ROWS})` });
  }

  const rowErrors: { row: number; sku?: string; errors: string[] }[] = [];
  const seen = new Map<string, number>();
  items.forEach((item: any, i: number) => {
    const errors = validateProduct(item);
    const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
    if (sku) {
      if (seen.has(sku)) errors.push(`duplicate SKU in payload (also row ${seen.get(sku)! + 1})`);
      else seen.set(sku, i);
    }
    if (errors.length) rowErrors.push({ row: i + 1, sku: sku || undefined, errors });
  });
  if (rowErrors.length) return res.status(422).json({ error: "Validation failed", rows: rowErrors });

  const list = items as ProductInput[];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await findExistingSkus(client, orgId, list.map((p) => p.sku.trim()));
    if (existing.size) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "Some SKUs already exist",
        rows: list
          .map((p, i) => ({ row: i + 1, sku: p.sku.trim(), errors: ["SKU already exists"] }))
          .filter((r) => existing.has(r.sku)),
      });
    }

    const locationId = await resolveLocationId(client, orgId, req.body?.location_id);
    if (!locationId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No valid location found; create a location first" });
    }

    for (const p of list) await insertProduct(client, orgId, locationId, p);
    await client.query("COMMIT");
    return res.status(201).json({ created: list.length, location_id: locationId });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("POST /products/bulk failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/** PATCH /api/products/:variantId  body: { sku?, name?, category?, cost_cents? } */
router.patch("/:variantId", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const { sku, name, category, cost_cents } = req.body ?? {};
  if (sku === undefined && name === undefined && category === undefined && cost_cents === undefined) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  if (sku !== undefined && (typeof sku !== "string" || !sku.trim())) {
    return res.status(400).json({ error: "sku must be a non-empty string" });
  }
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }
  if (category !== undefined && (typeof category !== "string" || !category.trim())) {
    return res.status(400).json({ error: "category must be a non-empty string" });
  }
  if (cost_cents !== undefined && (!isWholeNonNeg(cost_cents) || cost_cents <= 0)) {
    return res.status(400).json({ error: "cost_cents must be a positive integer" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(FIND_VARIANT_SQL, [req.params.variantId, orgId]);
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }
    if (sku !== undefined) {
      const dupes = await findExistingSkus(client, orgId, [sku.trim()], req.params.variantId);
      if (dupes.size) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `SKU "${sku.trim()}" already exists` });
      }
    }
    await client.query(
      "UPDATE product_variants SET sku = COALESCE($2, sku), unit_cost_cents = COALESCE($3, unit_cost_cents), updated_at = now() WHERE id = $1",
      [req.params.variantId, sku?.trim() ?? null, cost_cents ?? null]
    );
    if (name !== undefined || category !== undefined) {
      await client.query(
        "UPDATE products SET name = COALESCE($2, name), category = COALESCE($3, category), updated_at = now() WHERE id = $1",
        [found.rows[0].product_id, name?.trim() ?? null, category?.trim() ?? null]
      );
    }
    await client.query("COMMIT");
    return res.json({ variant_id: req.params.variantId, product_id: found.rows[0].product_id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("PATCH /products/:variantId failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/** DELETE /api/products/:variantId: soft delete the variant (and its product if no live variants remain). */
router.delete("/:variantId", async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(FIND_VARIANT_SQL, [req.params.variantId, orgId]);
    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Product not found" });
    }
    const productId = found.rows[0].product_id;
    await client.query(
      "UPDATE product_variants SET deleted_at = now(), updated_at = now() WHERE id = $1",
      [req.params.variantId]
    );
    await client.query(
      "UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL)",
      [productId]
    );
    await client.query("COMMIT");
    return res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("DELETE /products/:variantId failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
