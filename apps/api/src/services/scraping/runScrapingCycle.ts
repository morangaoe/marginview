/**
 * Core scraping cycle: finds every source that is due for a check, runs the
 * extractor, validates the result, and writes a price snapshot. Designed to
 * be called on a timer (see scheduler.ts) or manually via the API route.
 *
 * Each source runs in its own try/catch so one failure never aborts the rest.
 */

import { Pool } from "pg";
import { extractPrice } from "./extractPrice";
import { validateSnapshot } from "./validateSnapshot";

interface DueSource {
  id: string;
  url: string;
  compliance_status: "automated_allowed" | "manual_only" | "unreviewed";
  competitor_product_id: string;
  price_selector: string | null;
  last_price_cents: number | null;
  currency: string;
}

export interface CycleResult {
  sourcesChecked: number;
  snapshotsWritten: number;
  failures: { sourceId: string; reason: string }[];
}

export async function runScrapingCycle(pool: Pool): Promise<CycleResult> {
  const result: CycleResult = { sourcesChecked: 0, snapshotsWritten: 0, failures: [] };

  // Find sources that are due: automated_allowed and past their interval
  const { rows: sources } = await pool.query<DueSource>(`
    select
      ss.id,
      ss.url,
      ss.compliance_status,
      cp.id as competitor_product_id,
      cp.price_selector,
      ps_latest.price_cents as last_price_cents,
      coalesce(ps_latest.currency, 'USD') as currency
    from scraping_sources ss
    join competitor_products cp on cp.scraping_source_id = ss.id
    left join lateral (
      select price_cents, currency
      from price_snapshots
      where competitor_product_id = cp.id
      order by observed_at desc
      limit 1
    ) ps_latest on true
    where ss.compliance_status = 'automated_allowed'
      and (
        ss.last_checked_at is null
        or ss.last_checked_at < now() - (ss.scrape_interval_minutes * interval '1 minute')
      )
    for update of ss skip locked
  `);

  for (const source of sources) {
    result.sourcesChecked++;
    const jobRow = await pool.query(
      `insert into scraping_job_runs (scraping_source_id, status, started_at)
       values ($1, 'running', now()) returning id`,
      [source.id]
    );
    const jobId: string = jobRow.rows[0].id;

    try {
      const extracted = await extractPrice(source.url, source.price_selector);

      if (extracted.priceCents === null) {
        throw new Error(`Extractor returned no price (confidence: ${extracted.confidence})`);
      }

      const flag = validateSnapshot(extracted, source.last_price_cents);

      await pool.query(
        `insert into price_snapshots
           (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
         values ($1, $2, $3, $4, 'scraped', $5)`,
        [
          source.competitor_product_id,
          extracted.priceCents,
          extracted.currency || source.currency,
          extracted.inStock,
          flag,
        ]
      );

      await pool.query(
        `update scraping_sources
         set last_checked_at = now(), last_status = 'ok', updated_at = now()
         where id = $1`,
        [source.id]
      );

      await pool.query(
        `update scraping_job_runs
         set status = 'succeeded', finished_at = now()
         where id = $1`,
        [jobId]
      );

      result.snapshotsWritten++;
    } catch (err: any) {
      const reason = err?.message ?? "Unknown error";
      result.failures.push({ sourceId: source.id, reason });

      await pool.query(
        `update scraping_sources
         set last_checked_at = now(), last_status = 'failed', updated_at = now()
         where id = $1`,
        [source.id]
      );

      await pool.query(
        `update scraping_job_runs
         set status = 'failed', failure_reason = $1, finished_at = now()
         where id = $2`,
        [reason, jobId]
      );
    }
  }

  return result;
}
