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
import { checkComplianceDetailed } from "../services/scraping/complianceCheck";
import { enqueueDueSources, enqueueScrape } from "../queues/scrapeQueue";
import { isGoogleUrl } from "../services/serpService";

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
  const orgId = req.user!.organizationId;

  if (isGoogleUrl(url)) {
    return res.status(422).json({ error: "That's a Google link, not the seller's page. Paste the seller's product URL." });
  }
  const owned = await query(
    `select 1 from product_variants v join products p on p.id = v.product_id
      where v.id = $1 and p.organization_id = $2 and v.deleted_at is null`,
    [productVariantId, orgId]
  );
  if (!owned.length) return res.status(404).json({ error: "Product not found." });

  // Compliance check runs synchronously so the caller knows immediately
  // whether automated scraping is permitted for this URL
  const compliance = await checkComplianceDetailed(url);
  const complianceStatus = compliance.status;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upserts: registering the same URL again used to fail on the unique index with a 500.
    const [source] = (await client.query(
      `insert into scraping_sources
         (organization_id, url, compliance_status, scrape_interval_minutes, last_failure_reason)
       values ($1, $2, $3, $4, $5)
       on conflict (organization_id, url) do update
          set compliance_status = case when scraping_sources.compliance_status = 'blocked'
                                       then 'blocked' else excluded.compliance_status end,
              scrape_interval_minutes = excluded.scrape_interval_minutes,
              last_failure_reason = excluded.last_failure_reason,
              paused = false, consecutive_failures = 0, next_check_at = null, updated_at = now()
       returning id`,
      [orgId, url, complianceStatus, scrapeIntervalMinutes,
       complianceStatus === "automated_allowed" ? null : compliance.reason]
    )).rows;

    const [cp] = (await client.query(
      `insert into competitor_products
         (product_variant_id, scraping_source_id, competitor_name, price_selector)
       values ($1, $2, $3, $4)
       on conflict (product_variant_id, scraping_source_id) do update
          set competitor_name = excluded.competitor_name,
              price_selector = coalesce(excluded.price_selector, competitor_products.price_selector),
              updated_at = now()
       returning id`,
      [productVariantId, source.id, competitorName, priceSelector ?? null]
    )).rows;

    await client.query("COMMIT");

    res.status(201).json({
      sourceId: source.id,
      competitorProductId: cp.id,
      complianceStatus,
      complianceReason: compliance.reason,
      message:
        complianceStatus === "automated_allowed"
          ? "Source registered. Automated scraping will begin within the next cycle."
          : complianceStatus === "unreviewed"
            ? `Source registered. ${compliance.reason}`
            : `Source registered as manual-only. ${compliance.reason} Enter prices by hand.`,
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
       ss.last_failure_reason,
       ss.consecutive_failures,
       ss.paused,
       ss.next_check_at,
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

  // Scoped to the caller's org: these updates used to accept any source id.
  const owned = await query(
    "select 1 from scraping_sources where id = $1 and organization_id = $2",
    [req.params.id, req.user!.organizationId]
  );
  if (!owned.length) return res.status(404).json({ error: "Source not found." });

  if (priceSelector !== undefined) {
    await query(
      `update competitor_products set price_selector = $1, updated_at = now()
       where scraping_source_id = $2`,
      [priceSelector || null, req.params.id]
    );
  }

  if (scrapeIntervalMinutes !== undefined) {
    await query(
      `update scraping_sources set scrape_interval_minutes = $1, updated_at = now()
        where id = $2 and organization_id = $3`,
      [scrapeIntervalMinutes, req.params.id, req.user!.organizationId]
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
    try {
      const jobId = await enqueueScrape(req.user!.organizationId, req.params.id);
      res.status(202).json({ jobId });
    } catch (err: any) {
      // Known failures carry a status and a user-facing message; anything else goes to the error handler.
      if (!err?.status) throw err;
      res.status(err.status).json({ error: err.message });
    }
  }
);

// Trigger the full cycle manually (owner only, for testing/catch-up)
scrapingRouter.post("/run-now", requireRole("owner"), async (req, res) => {
  const queued = await enqueueDueSources(200, req.user!.organizationId);
  res.status(202).json({ queued });
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

  const owned = await query(
    `select 1 from competitor_products cp
       join product_variants v on v.id = cp.product_variant_id
       join products p on p.id = v.product_id
      where cp.id = $1 and p.organization_id = $2`,
    [competitorProductId, req.user!.organizationId]
  );
  if (!owned.length) return res.status(404).json({ error: "Competitor not found." });

  const [snap] = await query(
    `insert into price_snapshots
       (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
     values ($1, $2, $3, $4, 'manual', 'ok') returning id`,
    [competitorProductId, priceCents, currency, inStock ?? null]
  );

  res.status(201).json({ snapshotId: snap.id });
});
