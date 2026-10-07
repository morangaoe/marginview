import { Router, type Request, type Response } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "crypto";
import { pool } from "../db/pool";
import { captureError } from "../services/errorLog";
import { requireRole } from "../middleware/auth";

const router = Router();

// requireAuth is applied in index.ts. Reads are open to every role; writes are not.
const canWrite = requireRole("owner", "inventory_manager", "pricing_manager");

const orgIdOf = (req: Request): string | undefined => {
  const u = (req as any).user;
  return u?.organizationId ?? u?.organization_id ?? u?.org_id;
};

const MAX_BULK_ROWS = 2000;
const MAX_REPORTED_ROWS = 100;
const INT_MAX = 2_147_483_647;
type Db = Pick<PoolClient, "query">;

interface ProductInput {
  sku: string;
  name: string;
  category: string;
  cost_cents: number;
  price_cents: number | null;
  currency: string;
  quantity: number;
  reorder_level: number;
}

async function audit(
  db: Db,
  orgId: string,
  actorId: string,
  action: string,
  variantId: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
     VALUES ($1, $2, $3, 'product_variant', $4, $5, $6)`,
    [orgId, actorId, action, variantId, JSON.stringify(before), JSON.stringify(after)],
  );
}

const actorIdOf = (req: Request): string | undefined => (req as any).user?.id ?? (req as any).user?.userId;

const isWholeNonNeg = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= INT_MAX;
const isMissing = (v: unknown) => v === undefined || v === null;

/** Returns a list of problems; empty means the item is valid. Category, price, quantity and reorder level are optional. */
function validateProduct(p: any): string[] {
  const errs: string[] = [];
  if (typeof p?.sku !== "string" || !p.sku.trim()) errs.push("sku is required");
  else if (p.sku.trim().length > 100) errs.push("sku is longer than 100 characters");
  if (typeof p?.name !== "string" || !p.name.trim()) errs.push("name is required");
  else if (p.name.trim().length > 255) errs.push("name is longer than 255 characters");
  if (!isMissing(p?.category) && (typeof p.category !== "string" || p.category.trim().length > 80)) {
    errs.push("category must be text up to 80 characters");
  }
  if (!isWholeNonNeg(p?.cost_cents) || p.cost_cents <= 0) errs.push("cost_cents must be a positive integer (cents)");
  if (!isMissing(p?.price_cents) && (!isWholeNonNeg(p.price_cents) || p.price_cents <= 0)) {
    errs.push("price_cents must be a positive integer (cents)");
  }
  if (!isMissing(p?.currency) && (typeof p.currency !== "string" || !/^[A-Za-z]{3}$/.test(p.currency))) {
    errs.push("currency must be a 3-letter ISO code");
  }
  if (!isMissing(p?.quantity) && !isWholeNonNeg(p.quantity)) errs.push("quantity must be a non-negative integer");
  if (!isMissing(p?.reorder_level) && !isWholeNonNeg(p.reorder_level)) errs.push("reorder_level must be a non-negative integer");
  return errs;
}

/** Call only after validateProduct passed. Fills defaults. */
function normalizeProduct(p: any): ProductInput {
  return {
    sku: p.sku.trim(),
    name: p.name.trim(),
    category: (typeof p.category === "string" && p.category.trim()) || "Other",
    cost_cents: p.cost_cents,
    price_cents: isMissing(p.price_cents) ? null : p.price_cents,
    currency: typeof p.currency === "string" && /^[A-Za-z]{3}$/.test(p.currency) ? p.currency.toUpperCase() : "USD",
    quantity: isMissing(p.quantity) ? 0 : p.quantity,
    reorder_level: isMissing(p.reorder_level) ? 0 : p.reorder_level,
  };
}

/**
 * Serialises product writes per organization for the length of the transaction.
 * The DB only enforces SKU uniqueness per product, so without this two imports
 * running at once could both pass the "does this SKU exist?" check.
 */
const lockOrgProducts = (db: Db, orgId: string) =>
  db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`products:${orgId}`]);

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

/** sku -> its live variant and product, for update-mode imports. */
async function findExistingVariants(db: Db, orgId: string, skus: string[]) {
  const out = new Map<string, { variant_id: string; product_id: string }>();
  if (skus.length === 0) return out;
  const { rows } = await db.query(
    `SELECT v.sku, v.id AS variant_id, v.product_id
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE p.organization_id = $1 AND v.sku = ANY($2::text[])
        AND v.deleted_at IS NULL AND p.deleted_at IS NULL`,
    [orgId, skus],
  );
  for (const r of rows) out.set(r.sku, { variant_id: r.variant_id, product_id: r.product_id });
  return out;
}

async function resolveLocationId(db: Db, orgId: string, requested?: string): Promise<string | null> {
  if (requested) {
    const { rows } = await db.query(
      "SELECT id FROM locations WHERE id = $1 AND organization_id = $2",
      [requested, orgId],
    );
    return rows[0]?.id ?? null;
  }
  const { rows } = await db.query(
    "SELECT id FROM locations WHERE organization_id = $1 ORDER BY name LIMIT 1",
    [orgId],
  );
  if (rows[0]) return rows[0].id;

  // New organizations start with no locations; create a default instead of leaving the user stuck.
  // Needs the unique index on (organization_id, name) from migration 003.
  const created = await db.query(
    `INSERT INTO locations (organization_id, name) VALUES ($1, 'Main Warehouse')
     ON CONFLICT (organization_id, name) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [orgId],
  );
  return created.rows[0].id;
}

async function insertProduct(db: Db, orgId: string, locationId: string, p: ProductInput) {
  const prod = await db.query(
    "INSERT INTO products (organization_id, name, category) VALUES ($1, $2, $3) RETURNING id",
    [orgId, p.name, p.category],
  );
  const variant = await db.query(
    "INSERT INTO product_variants (product_id, sku, unit_cost_cents, current_price_cents, currency) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [prod.rows[0].id, p.sku, p.cost_cents, p.price_cents, p.currency],
  );
  const level = await db.query(
    "INSERT INTO inventory_levels (product_variant_id, location_id, on_hand, reorder_point) VALUES ($1, $2, $3, $4) RETURNING id",
    [variant.rows[0].id, locationId, p.quantity, p.reorder_level],
  );
  return { product_id: prod.rows[0].id, variant_id: variant.rows[0].id, level_id: level.rows[0].id };
}

/**
 * Inserts many products in 3 queries total (not 3 per row). IDs are generated
 * here so rows can be linked without relying on RETURNING order.
 */
async function insertProductsBatch(db: Db, orgId: string, locationId: string, list: ProductInput[]) {
  const productIds = list.map(() => randomUUID());
  const variantIds = list.map(() => randomUUID());

  await db.query(
    `INSERT INTO products (id, organization_id, name, category)
     SELECT t.id, $1::uuid, t.name, t.category
       FROM unnest($2::uuid[], $3::text[], $4::text[]) AS t(id, name, category)`,
    [orgId, productIds, list.map((p) => p.name), list.map((p) => p.category)],
  );
  await db.query(
    `INSERT INTO product_variants (id, product_id, sku, unit_cost_cents, current_price_cents, currency)
     SELECT t.id, t.product_id, t.sku, t.cost, t.price, t.currency
       FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::int[], $6::char(3)[]) AS t(id, product_id, sku, cost, price, currency)`,
    [variantIds, productIds, list.map((p) => p.sku), list.map((p) => p.cost_cents), list.map((p) => p.price_cents), list.map((p) => p.currency)],
  );
  await db.query(
    `INSERT INTO inventory_levels (product_variant_id, location_id, on_hand, reorder_point)
     SELECT t.variant_id, $1::uuid, t.qty, t.reorder
       FROM unnest($2::uuid[], $3::int[], $4::int[]) AS t(variant_id, qty, reorder)`,
    [locationId, variantIds, list.map((p) => p.quantity), list.map((p) => p.reorder_level)],
  );
}

/** Update-mode import: name, category, cost, and price (a blank price keeps the current one). Stock is never touched. */
async function updateProductsBatch(
  db: Db,
  list: { p: ProductInput; variantId: string; productId: string }[],
) {
  await db.query(
    `UPDATE product_variants v
        SET unit_cost_cents = t.cost,
            current_price_cents = COALESCE(t.price, v.current_price_cents),
            currency = t.currency,
            updated_at = now()
       FROM unnest($1::uuid[], $2::int[], $3::int[], $4::char(3)[]) AS t(id, cost, price, currency)
      WHERE v.id = t.id`,
    [list.map((x) => x.variantId), list.map((x) => x.p.cost_cents), list.map((x) => x.p.price_cents), list.map((x) => x.p.currency)],
  );
  await db.query(
    `UPDATE products p
        SET name = t.name, category = t.category, updated_at = now()
       FROM unnest($1::uuid[], $2::text[], $3::text[]) AS t(id, name, category)
      WHERE p.id = t.id`,
    [list.map((x) => x.productId), list.map((x) => x.p.name), list.map((x) => x.p.category)],
  );
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
  SELECT v.id, v.product_id, v.sku, v.unit_cost_cents, v.current_price_cents, v.currency, p.name, p.category
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
    captureError(req, err, "GET /products failed");
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /api/products  body: ProductInput & { location_id? } */
router.post("/", canWrite, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const errs = validateProduct(req.body);
  if (errs.length) return res.status(400).json({ error: errs.join("; ") });
  const p = normalizeProduct(req.body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockOrgProducts(client, orgId);
    const dupes = await findExistingSkus(client, orgId, [p.sku]);
    if (dupes.size) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: `SKU "${p.sku}" already exists` });
    }
    const locationId = await resolveLocationId(client, orgId, req.body.location_id);
    if (!locationId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No valid location found; create a location first" });
    }
    const ids = await insertProduct(client, orgId, locationId, p);
    await client.query("COMMIT");
    return res.status(201).json(ids);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    captureError(req, err, "POST /products failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/products/bulk
 * body: { items: (ProductInput & { row?: number })[], location_id?, mode?: "skip" | "update" }
 *
 * Partial success: invalid rows, duplicates inside the file, and (in "skip" mode) SKUs that
 * already exist are reported back and left out; every other row is written in ONE transaction,
 * so a database error still rolls back the whole import.
 *
 * 201 { created, updated, skipped, location_id, skipped_rows }  something was written
 * 200 same shape                                                  nothing to write (all skipped)
 * 422 { error, rows }                                             no row was valid
 */
router.post("/bulk", canWrite, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  if (!orgId) return res.status(401).json({ error: "Unauthorized" });

  const items: unknown = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  if (items.length > MAX_BULK_ROWS) {
    return res.status(413).json({ error: `Too many rows (max ${MAX_BULK_ROWS})` });
  }
  const mode: "skip" | "update" = req.body?.mode === "update" ? "update" : "skip";

  type Report = { row: number; sku?: string; reason: string };
  const problems: Report[] = [];
  const valid: { row: number; p: ProductInput }[] = [];
  const firstRowOfSku = new Map<string, number>();

  (items as any[]).forEach((raw, i) => {
    const row = Number.isInteger(raw?.row) && raw.row > 0 ? (raw.row as number) : i + 1;
    const sku = typeof raw?.sku === "string" ? raw.sku.trim() : "";
    const errs = validateProduct(raw);
    if (errs.length) {
      problems.push({ row, sku: sku || undefined, reason: errs.join("; ") });
      return;
    }
    const first = firstRowOfSku.get(sku);
    if (first !== undefined) {
      problems.push({ row, sku, reason: `Duplicate SKU in file (first used on row ${first})` });
      return;
    }
    firstRowOfSku.set(sku, row);
    valid.push({ row, p: normalizeProduct(raw) });
  });

  if (valid.length === 0) {
    return res.status(422).json({
      error: "No valid rows to import",
      rows: problems.slice(0, MAX_REPORTED_ROWS).map((p) => ({ row: p.row, sku: p.sku, errors: [p.reason] })),
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockOrgProducts(client, orgId);

    const locationId = await resolveLocationId(client, orgId, req.body?.location_id);
    if (!locationId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No valid location found; create a location first" });
    }

    const existing = await findExistingVariants(client, orgId, valid.map((v) => v.p.sku));
    const toCreate: ProductInput[] = [];
    const toUpdate: { p: ProductInput; variantId: string; productId: string }[] = [];
    for (const v of valid) {
      const ex = existing.get(v.p.sku);
      if (!ex) toCreate.push(v.p);
      else if (mode === "update") toUpdate.push({ p: v.p, variantId: ex.variant_id, productId: ex.product_id });
      else problems.push({ row: v.row, sku: v.p.sku, reason: "SKU already exists (skipped)" });
    }

    if (toCreate.length) await insertProductsBatch(client, orgId, locationId, toCreate);
    if (toUpdate.length) await updateProductsBatch(client, toUpdate);
    await client.query("COMMIT");

    problems.sort((a, b) => a.row - b.row);
    const written = toCreate.length + toUpdate.length;
    return res.status(written > 0 ? 201 : 200).json({
      created: toCreate.length,
      updated: toUpdate.length,
      skipped: problems.length,
      location_id: locationId,
      skipped_rows: problems.slice(0, MAX_REPORTED_ROWS),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    captureError(req, err, "POST /products/bulk failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/** PATCH /api/products/:variantId  body: { sku?, name?, category?, cost_cents? } */
router.patch("/:variantId", canWrite, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  const actorId = actorIdOf(req);
  if (!orgId || !actorId) return res.status(401).json({ error: "Unauthorized" });

  const { sku, name, category, cost_cents, price_cents, currency } = req.body ?? {};
  if (sku === undefined && name === undefined && category === undefined && cost_cents === undefined && price_cents === undefined && currency === undefined) {
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
  if (price_cents !== undefined && price_cents !== null && (!isWholeNonNeg(price_cents) || price_cents <= 0)) {
    return res.status(400).json({ error: "price_cents must be a positive integer or null" });
  }
  if (currency !== undefined && (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency))) {
    return res.status(400).json({ error: "currency must be a 3-letter ISO code" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (sku !== undefined) await lockOrgProducts(client, orgId);
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
      `UPDATE product_variants
          SET sku = COALESCE($2, sku),
              unit_cost_cents = COALESCE($3, unit_cost_cents),
              current_price_cents = CASE WHEN $4::boolean THEN $5::int ELSE current_price_cents END,
              currency = COALESCE($6, currency),
              updated_at = now()
        WHERE id = $1`,
      [req.params.variantId, sku?.trim() ?? null, cost_cents ?? null, price_cents !== undefined, price_cents ?? null, currency?.toUpperCase() ?? null],
    );
    if (name !== undefined || category !== undefined) {
      await client.query(
        "UPDATE products SET name = COALESCE($2, name), category = COALESCE($3, category), updated_at = now() WHERE id = $1",
        [found.rows[0].product_id, name?.trim() ?? null, category?.trim() ?? null],
      );
    }
    const before = {
      sku: found.rows[0].sku,
      cost_cents: found.rows[0].unit_cost_cents,
      price_cents: found.rows[0].current_price_cents,
      currency: found.rows[0].currency,
      name: found.rows[0].name,
      category: found.rows[0].category,
    };
    const after = {
      sku: sku?.trim() ?? before.sku,
      cost_cents: cost_cents ?? before.cost_cents,
      price_cents: price_cents === undefined ? before.price_cents : price_cents,
      currency: currency?.toUpperCase() ?? before.currency,
      name: name?.trim() ?? before.name,
      category: category?.trim() ?? before.category,
    };
    await audit(client, orgId, actorId, "product.update", req.params.variantId, before, after);
    await client.query("COMMIT");
    return res.json({ variant_id: req.params.variantId, product_id: found.rows[0].product_id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    captureError(req, err, "PATCH /products/:variantId failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/** DELETE /api/products/:variantId: soft delete the variant (and its product if no live variants remain). */
router.delete("/:variantId", canWrite, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  const actorId = actorIdOf(req);
  if (!orgId || !actorId) return res.status(401).json({ error: "Unauthorized" });

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
      [req.params.variantId],
    );
    await client.query(
      "UPDATE products SET deleted_at = now(), updated_at = now() WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = $1 AND deleted_at IS NULL)",
      [productId],
    );
    await client.query(
      `UPDATE scraping_sources ss
          SET paused = true, updated_at = now()
         FROM competitor_products cp
        WHERE cp.scraping_source_id = ss.id
          AND cp.product_variant_id = $1
          AND ss.organization_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM competitor_products cp2
              JOIN product_variants v2 ON v2.id = cp2.product_variant_id
             WHERE cp2.scraping_source_id = ss.id
               AND cp2.product_variant_id <> $1
               AND v2.deleted_at IS NULL
          )`,
      [req.params.variantId, orgId],
    );
    await audit(client, orgId, actorId, "product.delete", req.params.variantId, found.rows[0], null);
    await client.query("COMMIT");
    return res.status(204).send();
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    captureError(req, err, "DELETE /products/:variantId failed");
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;