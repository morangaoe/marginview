# products.ts patch (module 3)

Apply to apps/api/src/routes/products.ts. These are snippets; names match the existing file.

## 1. Accept currency and store it
In `ProductInput` add `currency: string;`. In `normalizeProduct` add:

    currency: typeof p.currency === "string" && /^[A-Za-z]{3}$/.test(p.currency) ? p.currency.toUpperCase() : "USD",

In `validateProduct` add:

    if (!isMissing(p?.currency) && (typeof p.currency !== "string" || !/^[A-Za-z]{3}$/.test(p.currency))) {
      errs.push("currency must be a 3-letter ISO code");
    }

In `insertProduct` write the column:

    "INSERT INTO product_variants (product_id, sku, unit_cost_cents, current_price_cents, currency) VALUES ($1, $2, $3, $4, $5) RETURNING id"
    [prod.rows[0].id, p.sku, p.cost_cents, p.price_cents, p.currency]

For `insertProductsBatch`, add `currency` to the unnest arrays and cast with `::char(3)[]`.

## 2. Audit helper (add once)

    async function audit(db: Db, orgId: string, actorId: string, action: string, variantId: string, before: unknown, after: unknown) {
      await db.query(
        `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, before_state, after_state)
         VALUES ($1, $2, $3, 'product_variant', $4, $5, $6)`,
        [orgId, actorId, action, variantId, JSON.stringify(before), JSON.stringify(after)],
      );
    }
    const actorIdOf = (req: Request) => (req as any).user?.id ?? (req as any).user?.userId;

## 3. PATCH /:variantId accepts price and currency, and audits
Read the current row first (cost, price, currency, name, category). Accept `price_cents` (positive int, or null to clear) and `currency` (3-letter code). Update in one statement:

    UPDATE product_variants
       SET sku = COALESCE($2, sku),
           unit_cost_cents = COALESCE($3, unit_cost_cents),
           current_price_cents = CASE WHEN $4::boolean THEN $5::int ELSE current_price_cents END,
           currency = COALESCE($6, currency),
           updated_at = now()
     WHERE id = $1

Where `$4` is `req.body.price_cents !== undefined` and `$5` is `req.body.price_cents ?? null`. Then call `audit(client, orgId, actorIdOf(req), "product.update", variantId, before, after)` in the same transaction.

## 4. DELETE /:variantId pauses tracking and audits
Inside the soft-delete transaction, before COMMIT:

    -- Pause only sources that no other live variant still uses.
    UPDATE scraping_sources ss
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
            AND v2.deleted_at IS NULL)

    await audit(client, orgId, actorIdOf(req), "product.delete", variantId, before, null);

Paused sources are skipped by the scheduler and only resume through an explicit action.
