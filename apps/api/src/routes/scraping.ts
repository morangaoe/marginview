/**
 * Scraping routes:
 *  POST /api/scraping/sources          — register a URL to track
 *  GET  /api/scraping/sources          — list sources with their status & latest price
 *  PATCH /api/scraping/sources/:id     — update selector or interval
 *  POST /api/scraping/sources/:id/run  — manually trigger a single-source run
 *  POST /api/scraping/run-now          — manually trigger the full cycle (owner only)
 *  GET  /api/scraping/sources/:id/snapshots — price history for one source
 */

import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../db/pool";
import { requireAuth, requireRole } from "../middleware/auth";
import { checkCompliance } from "../services/scraping/complianceCheck";
import { extractPrice } from "../services/scraping/extractPrice";
import { runScrapingCycle } from "../services/scraping/runScrapingCycle";
import { validateSnapshot } from "../services/scraping/validateSnapshot";

export const scrapingRouter = Router();
scrapingRouter.use(requireAuth);

const registerSchema = z.object({
  url: z.string().url(),
  competitorName: z.string().min(1),
  productVariantId: z.string().uuid(),
  priceSelector: z.string().optional(),
  scrapeIntervalMinutes: z.number().int().min(60).max(10_080).default(720), // 1h – 7d
});

// Register a new competitor URL to track
scrapingRouter.post("/sources", requireRole("owner", "pricing_manager"), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { url, competitorName, productVariantId, priceSelector, scrapeIntervalMinutes } = parsed.data;

  // Compliance check runs synchronously so the caller knows immediately
  // whether automated scraping is permitted for this URL
  const complianceStatus = await checkCompliance(url);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const [source] = (await client.query(
      `insert into scraping_sources
         (organization_id, url, compliance_status, scrape_interval_minutes)
       values ($1, $2, $3, $4) returning id`,
      [req.user!.organizationId, url, complianceStatus, scrapeIntervalMinutes]
    )).rows;

    const [cp] = (await client.query(
      `insert into competitor_products
         (product_variant_id, scraping_source_id, competitor_name, price_selector)
       values ($1, $2, $3, $4) returning id`,
      [productVariantId, source.id, competitorName, priceSelector ?? null]
    )).rows;

    await client.query("COMMIT");

    res.status(201).json({
      sourceId: source.id,
      competitorProductId: cp.id,
      complianceStatus,
      message:
        complianceStatus === "automated_allowed"
          ? "Source registered. Automated scraping will begin within the next cycle."
          : "Source registered as manual-only. robots.txt disallows automated access; enter prices by hand.",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// List all tracked sources for this org with their current status
scrapingRouter.get("/sources", async (req, res) => {
  const rows = await query(
    `select
       ss.id,
       ss.url,
       ss.compliance_status,
       ss.scrape_interval_minutes,
       ss.last_checked_at,
       ss.last_status,
       cp.id as competitor_product_id,
       cp.competitor_name,
       cp.price_selector,
       v.sku,
       p.name as product_name,
       snap.price_cents as latest_price_cents,
       snap.currency as latest_currency,
       snap.observed_at as latest_observed_at,
       snap.validation_flag
     from scraping_sources ss
     join competitor_products cp on cp.scraping_source_id = ss.id
     join product_variants v on v.id = cp.product_variant_id
     join products p on p.id = v.product_id
     left join lateral (
       select price_cents, currency, observed_at, validation_flag
       from price_snapshots
       where competitor_product_id = cp.id
       order by observed_at desc limit 1
     ) snap on true
     where ss.organization_id = $1
     order by ss.created_at desc`,
    [req.user!.organizationId]
  );
  res.json(rows);
});

// Update selector or interval for a source
const updateSchema = z.object({
  priceSelector: z.string().optional(),
  scrapeIntervalMinutes: z.number().int().min(60).max(10_080).optional(),
});

scrapingRouter.patch("/sources/:id", requireRole("owner", "pricing_manager"), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { priceSelector, scrapeIntervalMinutes } = parsed.data;

  if (priceSelector !== undefined) {
    await query(
      `update competitor_products set price_selector = $1, updated_at = now()
       where scraping_source_id = $2`,
      [priceSelector || null, req.params.id]
    );
  }

  if (scrapeIntervalMinutes !== undefined) {
    await query(
      `update scraping_sources set scrape_interval_minutes = $1, updated_at = now() where id = $2`,
      [scrapeIntervalMinutes, req.params.id]
    );
  }

  res.status(204).send();
});

// Price history for a single source
scrapingRouter.get("/sources/:id/snapshots", async (req, res) => {
  const rows = await query(
    `select ps.price_cents, ps.currency, ps.in_stock, ps.observed_at, ps.source, ps.validation_flag
     from price_snapshots ps
     join competitor_products cp on cp.id = ps.competitor_product_id
     join scraping_sources ss on ss.id = cp.scraping_source_id
     where ss.id = $1 and ss.organization_id = $2
     order by ps.observed_at desc
     limit 200`,
    [req.params.id, req.user!.organizationId]
  );
  res.json(rows);
});

// Manual run for a single source (useful for testing a new selector)
scrapingRouter.post(
  "/sources/:id/run",
  requireRole("owner", "pricing_manager"),
  async (req, res) => {
    const [source] = await query(
      `select ss.url, cp.id as competitor_product_id, cp.price_selector,
              ps_latest.price_cents as last_price_cents, coalesce(ps_latest.currency, 'USD') as currency
       from scraping_sources ss
       join competitor_products cp on cp.scraping_source_id = ss.id
       left join lateral (
         select price_cents, currency from price_snapshots
         where competitor_product_id = cp.id order by observed_at desc limit 1
       ) ps_latest on true
       where ss.id = $1 and ss.organization_id = $2`,
      [req.params.id, req.user!.organizationId]
    );

    if (!source) return res.status(404).json({ error: "Source not found" });

    try {
      const extracted = await extractPrice(source.url, source.price_selector);
      const flag = validateSnapshot(extracted, source.last_price_cents);

      let snapshotId: string | null = null;
      if (extracted.priceCents !== null) {
        const [snap] = await query(
          `insert into price_snapshots
             (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
           values ($1, $2, $3, $4, 'scraped', $5) returning id`,
          [
            source.competitor_product_id,
            extracted.priceCents,
            extracted.currency || source.currency,
            extracted.inStock,
            flag,
          ]
        );
        snapshotId = snap.id;

        await query(
          `update scraping_sources set last_checked_at = now(), last_status = 'ok' where id = $1`,
          [req.params.id]
        );
      } else {
        await query(
          `update scraping_sources set last_checked_at = now(), last_status = 'failed' where id = $1`,
          [req.params.id]
        );
      }

      res.json({ extracted, validationFlag: flag, snapshotId });
    } catch (err: any) {
      res.status(502).json({ error: err?.message ?? "Extraction failed" });
    }
  }
);

// Trigger the full cycle manually (owner only, for testing/catch-up)
scrapingRouter.post("/run-now", requireRole("owner"), async (req, res) => {
  const cycleResult = await runScrapingCycle(pool);
  res.json(cycleResult);
});

// Manual price entry (for manual_only sources)
const manualEntrySchema = z.object({
  competitorProductId: z.string().uuid(),
  priceCents: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  inStock: z.boolean().optional(),
});

scrapingRouter.post("/manual-entry", requireRole("owner", "pricing_manager"), async (req, res) => {
  const parsed = manualEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { competitorProductId, priceCents, currency, inStock } = parsed.data;

  const [snap] = await query(
    `insert into price_snapshots
       (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
     values ($1, $2, $3, $4, 'manual', 'ok') returning id`,
    [competitorProductId, priceCents, currency, inStock ?? null]
  );

  res.status(201).json({ snapshotId: snap.id });
});
