/**
 * Every minute, asks the queue to run every due source. Scrapes nothing itself.
 * A Postgres advisory lock keeps multiple instances from enqueuing twice.
 */
import type { Pool } from "pg";
import { enqueueDueSources } from "../../queues/scrapeQueue";

const TICK_MS = 60_000;
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = Number(process.env.SNAPSHOT_RETENTION_DAYS ?? 365);
const LOCK_KEY = "marginview:scrape-scheduler";

export interface SchedulerHandle {
  stop(): Promise<void>;
}

/** Keeps the newest snapshot per competitor product so drift checks still have a baseline. */
export async function pruneSnapshots(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from price_snapshots
      where observed_at < now() - make_interval(days => $1)
        and id not in (
          select distinct on (competitor_product_id) id
            from price_snapshots
           order by competitor_product_id, observed_at desc
        )`,
    [RETENTION_DAYS],
  );
  await pool.query(
    "delete from scraping_job_runs where created_at < now() - interval '90 days' and status in ('succeeded','failed')",
  );
  return rowCount ?? 0;
}

export function startScrapingScheduler(pool: Pool): SchedulerHandle {
  let stopped = false;
  let lastPrune = 0;
  let inFlight: Promise<void> | null = null;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = (async () => {
      const client = await pool.connect();
      let locked = false;
      try {
        const { rows } = await client.query<{ ok: boolean }>(
          "select pg_try_advisory_lock(hashtext($1)) as ok",
          [LOCK_KEY],
        );
        locked = rows[0]?.ok === true;
        if (!locked) return;

        const queued = await enqueueDueSources();
        if (queued) console.log(`[scraper] queued ${queued} due source(s)`);

        if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
          lastPrune = Date.now();
          const removed = await pruneSnapshots(pool);
          if (removed) console.log(`[scraper] pruned ${removed} old snapshot(s)`);
        }
      } catch (err) {
        console.error("[scraper] scheduler tick failed:", err);
      } finally {
        if (locked) await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY]).catch(() => undefined);
        client.release();
        inFlight = null;
      }
    })();
    await inFlight;
  };

  console.log(`[scraper] Scheduler started, checking every ${TICK_MS / 60_000} min`);
  const timer = setInterval(() => void tick(), TICK_MS);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) await inFlight.catch(() => undefined);
    },
  };
}