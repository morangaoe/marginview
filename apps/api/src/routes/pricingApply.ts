/**
 * Apply and undo optimized prices. Each change writes current_price_cents,
 * price_change_log and audit_logs in one transaction.
 * Mounted in index.ts as: app.use("/api/pricing", pricingApplyRouter);
 */
import { Router, type Request, type Response } from "express";
import { pool } from "../db/pool";
import { requireRole } from "../middleware/auth";

const router = Router();
const canChangePrice = requireRole("owner", "pricing_manager");
const orgIdOf = (req: Request): string | undefined => (req as any).user?.organizationId;
const actorIdOf = (req: Request): string | undefined => (req as any).user?.id ?? (req as any).user?.userId;

/** POST /api/pricing/:variantId/apply  { price_cents, strategy?, margin_after_pct? } */
router.post("/:variantId/apply", canChangePrice, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  const actorId = actorIdOf(req);
  if (!orgId || !actorId) return res.status(401).json({ error: "Unauthorized" });

  const newCents = req.body?.price_cents;
  if (!Number.isInteger(newCents) || newCents <= 0) {
    return res.status(400).json({ error: "price_cents must be a positive whole number of cents" });
  }
  const strategy = typeof req.body?.strategy === "string" ? req.body.strategy.slice(0, 40) : "optimized";
  const marginAfter = typeof req.body?.margin_after_pct === "number" ? req.body.margin_after_pct : null;
  const variantId = req.params.variantId;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const cur = await client.query(
      `select v.current_price_cents from product_variants v
         join products p on p.id = v.product_id
        where v.id = $1 and p.organization_id = $2 and v.deleted_at is null
        for update of v`,
      [variantId, orgId],
    );
    if (!cur.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "Variant not found" });
    }
    const oldCents: number | null = cur.rows[0].current_price_cents;

    await client.query(
      "update product_variants set current_price_cents = $2, updated_at = now() where id = $1",
      [variantId, newCents],
    );
    const log = await client.query(
      `insert into price_change_log
         (product_variant_id, old_price_cents, new_price_cents, actor_user_id, strategy, margin_after_pct)
       values ($1, $2, $3, $4, $5, $6)
       returning id, applied_at`,
      [variantId, oldCents, newCents, actorId, strategy, marginAfter],
    );
    await client.query(
      `insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
       values ($1, $2, 'price.apply', 'product_variant', $3, $4, $5)`,
      [orgId, actorId, variantId, JSON.stringify({ price_cents: oldCents }), JSON.stringify({ price_cents: newCents })],
    );
    await client.query("commit");
    return res.status(201).json({
      change_id: log.rows[0].id,
      old_price_cents: oldCents,
      new_price_cents: newCents,
      applied_at: log.rows[0].applied_at,
    });
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    console.error("POST /pricing/:variantId/apply failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/pricing/:variantId/undo
 * Restores the price from the most recent change. The undo is itself logged.
 */
router.post("/:variantId/undo", canChangePrice, async (req: Request, res: Response) => {
  const orgId = orgIdOf(req);
  const actorId = actorIdOf(req);
  if (!orgId || !actorId) return res.status(401).json({ error: "Unauthorized" });
  const variantId = req.params.variantId;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const last = await client.query(
      `select l.id, l.old_price_cents, l.new_price_cents
         from price_change_log l
         join product_variants v on v.id = l.product_variant_id
         join products p on p.id = v.product_id
        where l.product_variant_id = $1 and p.organization_id = $2
        order by l.applied_at desc
        limit 1`,
      [variantId, orgId],
    );
    if (!last.rowCount) {
      await client.query("rollback");
      return res.status(404).json({ error: "No price change to undo" });
    }
    const { old_price_cents: restore, new_price_cents: undone } = last.rows[0];
    if (restore === null) {
      await client.query("rollback");
      return res.status(409).json({ error: "The price had no value before the last change, so there is nothing to restore." });
    }

    await client.query(
      "update product_variants set current_price_cents = $2, updated_at = now() where id = $1",
      [variantId, restore],
    );
    await client.query(
      `insert into price_change_log (product_variant_id, old_price_cents, new_price_cents, actor_user_id, strategy)
       values ($1, $2, $3, $4, 'undo')`,
      [variantId, undone, restore, actorId],
    );
    await client.query(
      `insert into audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
       values ($1, $2, 'price.undo', 'product_variant', $3, $4, $5)`,
      [orgId, actorId, variantId, JSON.stringify({ price_cents: undone }), JSON.stringify({ price_cents: restore })],
    );
    await client.query("commit");
    return res.json({ restored_price_cents: restore, undone_price_cents: undone });
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    console.error("POST /pricing/:variantId/undo failed", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;