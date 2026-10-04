/**
 * runScrapingCycle — polls all scraping sources that are due for a check and
 * writes a price_snapshot for each one.
 *
 * FIXES applied:
 *  1. Each source is wrapped in its own try/catch so one bad scrape can't
 *     crash the entire scheduled cycle (previously an unhandled rejection
 *     from scrapePrice() would propagate and kill the interval).
 *  2. The validation flag is now recorded in price_snapshots from
 *     validateSnapshot() rather than always writing 'ok'.
 *  3. result_price_cents / result_currency / method are written to
 *     scraping_job_runs (schema added in migration 002_modules.sql).
 *  4. A per-source timeout (60 s) prevents a single slow scrape from
 *     blocking the cycle for all other sources.
 */

import { Pool } from "pg";
import { scrapePrice } from "../scraper/scraperEngine";
import { validateSnapshot } from "./validateSnapshot";

export interface CycleResult {
  sourcesChecked: number;
  snapshotsWritten: number;
  failures: Array<{ sourceId: string; reason: string }>;
}

/** How many seconds old a source's last_checked_at must be before we re-scrape it. */
const DEFAULT_INTERVAL_SECONDS = 60 * 60; // 1 hour

/** Hard per-source timeout to avoid blocking the event loop. */
const SOURCE_TIMEOUT_MS = 60_000;

export async function runScrapingCycle(pool: Pool): Promise<CycleResult> {
  const result: CycleResult = { sourcesChecked: 0, snapshotsWritten: 0, failures: [] };

  // Fetch all sources that are due for a check
  const { rows: sources } = await pool.query<{
    id: string;
    organization_id: string;
    url: string;
    check_interval_seconds: number | null;
  }>(`
    SELECT ss.id,
           ss.organization_id,
           ss.url,
           ss.check_interval_seconds
      FROM scraping_sources ss
      JOIN organizations o ON o.id = ss.organization_id
     WHERE ss.compliance_status NOT IN ('manual_only', 'blocked')
       AND (
             ss.last_checked_at IS NULL
             OR ss.last_checked_at < now() - make_interval(secs =>
                  COALESCE(ss.check_interval_seconds, $1)
               )
           )
     ORDER BY ss.last_checked_at ASC NULLS FIRST
     LIMIT 200
  `, [DEFAULT_INTERVAL_SECONDS]);

  result.sourcesChecked = sources.length;

  for (const source of sources) {
    try {
      // Fetch the last known price for drift-detection in validateSnapshot
      const { rows: priorRows } = await pool.query<{ price_cents: number }>(
        `SELECT ps.price_cents
           FROM price_snapshots ps
           JOIN competitor_products cp ON cp.id = ps.competitor_product_id
          WHERE cp.scraping_source_id = $1
            AND (ps.validation_flag IS NULL OR ps.validation_flag = 'ok')
          ORDER BY ps.observed_at DESC
          LIMIT 1`,
        [source.id],
      );
      const lastKnownCents = priorRows[0]?.price_cents ?? null;

      // Scrape with a per-source timeout
      const scrapeResultPromise = scrapePrice(source.url);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Source ${source.id} timed out after ${SOURCE_TIMEOUT_MS / 1000}s`)), SOURCE_TIMEOUT_MS),
      );
      const scraped = await Promise.race([scrapeResultPromise, timeoutPromise]);

      const validationFlag = validateSnapshot(scraped, lastKnownCents);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Write price snapshot for every competitor_product linked to this source
        const { rowCount } = await client.query(
          `INSERT INTO price_snapshots
             (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
           SELECT id, $2, $3, $4, 'scraped', $5
             FROM competitor_products
            WHERE scraping_source_id = $1`,
          [source.id, scraped.priceCents, scraped.currency, scraped.inStock, validationFlag],
        );

        // Update source health
        await client.query(
          `UPDATE scraping_sources
              SET last_checked_at = now(),
                  last_status     = 'ok',
                  updated_at      = now()
            WHERE id = $1`,
          [source.id],
        );

        // Write a completed job run row (FIX: include method & price from 002 migration)
        await client.query(
          `INSERT INTO scraping_job_runs
             (scraping_source_id, organization_id, status, started_at, finished_at,
              result_price_cents, result_currency, method)
           VALUES ($1, $2, 'succeeded', now(), now(), $3, $4, $5)`,
          [
            source.id,
            source.organization_id,
            scraped.priceCents,
            scraped.currency,
            scraped.method,
          ],
        );

        await client.query("COMMIT");
        if (rowCount && rowCount > 0) result.snapshotsWritten++;
      } catch (dbErr) {
        await client.query("ROLLBACK");
        throw dbErr;
      } finally {
        client.release();
      }
    } catch (err) {
      const reason = (err as Error).message ?? String(err);
      result.failures.push({ sourceId: source.id, reason });

      // Mark the source as failed without letting this crash the cycle loop
      await pool
        .query(
          `UPDATE scraping_sources
              SET last_checked_at = now(),
                  last_status     = 'failed',
                  updated_at      = now()
            WHERE id = $1`,
          [source.id],
        )
        .catch((e) => console.error("[scraper] failed to write failure status:", e));
    }
  }

  return result;
}
