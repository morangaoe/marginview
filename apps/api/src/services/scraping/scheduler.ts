/**
 * Scheduler: kicks off runScrapingCycle on a fixed interval.
 *
 * Default: every 5 minutes. Sources with longer intervals just get skipped
 * by the query inside runScrapingCycle until they're actually due.
 *
 * The interval handle is returned so tests or graceful-shutdown code can
 * call clearInterval on it.
 */

import { Pool } from "pg";
import { runScrapingCycle } from "./runScrapingCycle";

const POLL_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes

export function startScrapingScheduler(pool: Pool): ReturnType<typeof setInterval> {
  console.log(`[scraper] Scheduler started — polling every ${POLL_INTERVAL_MS / 60_000} min`);

  const handle = setInterval(async () => {
    try {
      const result = await runScrapingCycle(pool);
      if (result.sourcesChecked > 0) {
        console.log(
          `[scraper] Cycle complete: ${result.snapshotsWritten}/${result.sourcesChecked} written, ` +
          `${result.failures.length} failed`
        );
        for (const f of result.failures) {
          console.warn(`[scraper] Source ${f.sourceId} failed: ${f.reason}`);
        }
      }
    } catch (err) {
      console.error("[scraper] Unhandled cycle error:", err);
    }
  }, POLL_INTERVAL_MS);

  return handle;
}
