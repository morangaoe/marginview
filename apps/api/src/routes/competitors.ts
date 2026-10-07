import { Router } from "express";
import { pool } from "../db/pool";
import { requireRole } from "../middleware/auth";
import { HttpError, orgIdOf, wrap } from "../utils/http";
import { checkComplianceDetailed } from "../services/scraping/complianceCheck";
import { isGoogleUrl, resolveMerchantUrl, searchCompetitorListings, serpFailure, type CompetitorListing } from "../services/serpService";
import { logger } from "../utils/log";

const router = Router();
const log = logger("competitors");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Similar products: listings priced within ±SIMILAR_BAND of our price, SIMILAR_COUNT picked at random. */
const SIMILAR_BAND = 0.2;
const SIMILAR_COUNT = 5;

async function assertVariantInOrg(variantId: string, orgId: string) {
  if (!UUID_RE.test(variantId)) throw new HttpError(400, "variantId must be a product variant id.");
  const r = await pool.query(
    `select 1 from product_variants pv join products p on p.id = pv.product_id
      where pv.id = $1 and p.organization_id = $2 and pv.deleted_at is null`,
    [variantId, orgId],
  );
  if (!r.rowCount) throw new HttpError(404, "Product not found.");
}

router.get(
  "/",
  wrap(async (req, res) => {
    const orgId = orgIdOf(req);
    const variantId = String(req.query.variantId ?? "");
    await assertVariantInOrg(variantId, orgId);
    const r = await pool.query(
      `select cp.id, cp.competitor_name as "competitorName", ss.id as "sourceId", ss.url,
              ss.compliance_status as "complianceStatus", ss.last_status as "lastStatus",
              ss.last_failure_reason as "lastFailureReason", ss.paused, ss.next_check_at as "nextCheckAt",
              snap.price_cents as "lastPriceCents", snap.currency as "lastCurrency", snap.observed_at as "lastScrapedAt"
         from competitor_products cp
         join scraping_sources ss on ss.id = cp.scraping_source_id
         left join lateral (select price_cents, currency, observed_at from price_snapshots
                             where competitor_product_id = cp.id order by observed_at desc limit 1) snap on true
        where cp.product_variant_id = $1 and ss.organization_id = $2
        order by cp.created_at`,
      [variantId, orgId],
    );
    res.json({ targets: r.rows });
  }),
);

/**
 * POST /api/competitors { variantId, competitorName, url?, pageToken? }
 * `pageToken` comes from a market-search result and is used to find the seller's
 * own page when `url` is missing or is a Google Shopping link (which can't be scraped).
 */
router.post(
  "/",
  requireRole("owner", "pricing_manager"),
  wrap(async (req, res) => {
    const orgId = orgIdOf(req);
    const { variantId, competitorName, pageToken } = req.body ?? {};
    let url: string = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    await assertVariantInOrg(String(variantId), orgId);

    if ((!url || isGoogleUrl(url)) && typeof pageToken === "string" && pageToken) {
      try {
        url = (await resolveMerchantUrl(pageToken, competitorName)) ?? "";
      } catch (e) {
        log.error("merchant lookup failed", { error: (e as Error).message });
        throw new HttpError(502, "Couldn't look up the seller's page right now. Try again in a minute.");
      }
      if (!url) throw new HttpError(422, "Google didn't list a direct seller page for this result. Paste the seller's product URL instead.");
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      throw new HttpError(400, "Enter a valid http(s) product URL.");
    }
    if (isGoogleUrl(parsed.toString())) {
      throw new HttpError(422, "That's a Google Shopping link, not the seller's page. Open it and copy the seller's product URL.");
    }
    const name = String(competitorName ?? "").trim() || parsed.hostname.replace(/^www\./, "");
    const compliance = await checkComplianceDetailed(parsed.toString());
    const complianceStatus = compliance.status;
    const note = complianceStatus === "automated_allowed" ? null : compliance.reason;

    const client = await pool.connect();
    try {
      await client.query("begin");
      // Re-adding a URL refreshes its robots verdict and health, so a source that
      // failed once (e.g. robots.txt timed out) isn't stuck in manual_only forever.
      const src = await client.query(
        `insert into scraping_sources (organization_id, url, compliance_status, last_failure_reason)
         values ($1, $2, $3, $4)
         on conflict (organization_id, url) do update
            set compliance_status = case when scraping_sources.compliance_status = 'blocked'
                                         then 'blocked' else excluded.compliance_status end,
                last_failure_reason = excluded.last_failure_reason,
                paused = false, consecutive_failures = 0, next_check_at = null,
                updated_at = now()
         returning id`,
        [orgId, parsed.toString(), complianceStatus, note],
      );
      const cp = await client.query(
        `insert into competitor_products (product_variant_id, scraping_source_id, competitor_name)
         values ($1, $2, $3)
         on conflict (product_variant_id, scraping_source_id) do update set competitor_name = excluded.competitor_name
         returning id`,
        [variantId, src.rows[0].id, name],
      );
      await client.query("commit");
      log.info("competitor tracked", { source: src.rows[0].id, url: parsed.toString(), compliance: complianceStatus });
      res.status(201).json({
        id: cp.rows[0].id,
        sourceId: src.rows[0].id,
        url: parsed.toString(),
        complianceStatus,
        complianceReason: compliance.reason,
      });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }),
);

/**
 * GET /api/competitors/similar?variantId=...
 * Searches the market by product name, keeps listings priced within ±20% of our
 * current price (same currency only), and returns 5 of them at random.
 */
router.get(
  "/similar",
  wrap(async (req, res) => {
    const orgId = orgIdOf(req);
    const variantId = String(req.query.variantId ?? "");
    await assertVariantInOrg(variantId, orgId);
    const v = await pool.query<{ sku: string; name: string; price_cents: number | null; currency: string }>(
      `select pv.sku, p.name, pv.current_price_cents as price_cents, pv.currency
         from product_variants pv join products p on p.id = pv.product_id
        where pv.id = $1 and p.organization_id = $2`,
      [variantId, orgId],
    );
    const variant = v.rows[0];
    const ours = variant.price_cents;
    if (!ours || ours <= 0) {
      throw new HttpError(422, `${variant.name} has no current selling price yet. Set one in Inventory to compare.`);
    }
    const currency = variant.currency.trim().toUpperCase();
    const minCents = Math.floor(ours * (1 - SIMILAR_BAND));
    const maxCents = Math.ceil(ours * (1 + SIMILAR_BAND));

    let listings: CompetitorListing[];
    try {
      listings = await searchCompetitorListings(variant.name, { limit: 100, currency });
    } catch (e) {
      const msg = (e as Error).message;
      log.error("similar search failed", { variant: variantId, q: variant.name, error: msg });
      const f = serpFailure(e);
      throw new HttpError(f.status, f.message);
    }

    const stats = { found: listings.length, noPrice: 0, otherCurrency: 0, outsideBand: 0, inBand: 0 };
    const inBand: CompetitorListing[] = [];
    for (const l of listings) {
      if (l.priceCents === null) stats.noPrice++;
      else if (l.currency !== currency) stats.otherCurrency++;
      else if (l.priceCents < minCents || l.priceCents > maxCents) stats.outsideBand++;
      else inBand.push(l);
    }
    stats.inBand = inBand.length;

    // Fisher-Yates shuffle, then take the first few.
    for (let i = inBand.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [inBand[i], inBand[j]] = [inBand[j], inBand[i]];
    }
    const results = inBand.slice(0, SIMILAR_COUNT).map((l) => ({
      ...l,
      diffPct: Math.round(((l.priceCents! - ours) / ours) * 1000) / 10,
    }));

    log.info("similar products", { variant: variantId, q: variant.name, priceCents: ours, currency, ...stats, returned: results.length });
    res.json({
      variant: { id: variantId, sku: variant.sku, name: variant.name, priceCents: ours, currency },
      band: { pct: SIMILAR_BAND * 100, minCents, maxCents },
      query: variant.name,
      stats,
      results,
    });
  }),
);

router.delete(
  "/:id",
  requireRole("owner", "pricing_manager"),
  wrap(async (req, res) => {
    const r = await pool.query(
      `delete from competitor_products cp using product_variants pv, products p
        where cp.id = $1 and pv.id = cp.product_variant_id and p.id = pv.product_id and p.organization_id = $2`,
      [req.params.id, orgIdOf(req)],
    );
    if (!r.rowCount) throw new HttpError(404, "Competitor not found.");
    res.json({ ok: true });
  }),
);

export default router;
