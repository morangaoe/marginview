/**
 * The single scraping pipeline. Everything that fetches a price goes through here:
 *   - the scheduler (enqueueDueSources), every minute
 *   - "Check now" (enqueueScrape), manual=true so paused sources still run
 */
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { pool } from "../db/pool";
import { scrapePrice, ScrapeError } from "../services/scraper/scrapePrice";
import { activateTrialIfNeeded } from "../services/billing";
import { validateSnapshot } from "../services/scraping/validateSnapshot";

const ENFORCE_CREDITS = process.env.ENFORCE_SCRAPING_CREDITS === "true";
const QUEUE = "scrape";
const ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 90_000;
const AUTO_PAUSE_AFTER = 5;
const BASE_BACKOFF_MIN = 15;
const MAX_BACKOFF_MIN = 24 * 60;

export interface ScrapeJobData {
  jobRunId: string;
  sourceId: string;
  organizationId: string;
  manual?: boolean;
}

interface SourceRow {
  url: string;
  paused: boolean;
  compliance_status: string;
  scrape_interval_minutes: number;
  default_currency: string;
  remaining: number;
  selector: string | null;
}

function makeRedisConnection(): IORedis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => (times >= 10 ? null : Math.min(times * 1000, 30_000)),
    enableReadyCheck: false,
  });
}

const connection = makeRedisConnection();
export const scrapeQueue = connection ? new Queue<ScrapeJobData>(QUEUE, { connection }) : null;

async function queueRun(organizationId: string, sourceId: string, manual: boolean): Promise<string> {
  if (!scrapeQueue) {
    throw Object.assign(new Error("Background scraping isn't configured yet (REDIS_URL is not set)."), { status: 503 });
  }
  const run = await pool.query(
    "insert into scraping_job_runs (scraping_source_id, organization_id, status) values ($1, $2, 'queued') returning id",
    [sourceId, organizationId],
  );
  const jobRunId: string = run.rows[0].id;
  await scrapeQueue.add(
    "scrape",
    { jobRunId, sourceId, organizationId, manual },
    {
      jobId: jobRunId,
      attempts: ATTEMPTS,
      backoff: { type: "exponential", delay: 15_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
  return jobRunId;
}

/** "Check now" from the UI. Works on paused sources too, since the person asked for it. */
export async function enqueueScrape(organizationId: string, sourceId: string): Promise<string> {
  const src = await pool.query(
    "select compliance_status from scraping_sources where id = $1 and organization_id = $2",
    [sourceId, organizationId],
  );
  if (!src.rowCount) throw Object.assign(new Error("Source not found"), { status: 404 });
  const status = src.rows[0].compliance_status;
  if (status === "manual_only" || status === "blocked") {
    throw Object.assign(new Error(`This source is ${status.replace("_", " ")} and can't be scraped automatically.`), {
      status: 409,
    });
  }
  return queueRun(organizationId, sourceId, true);
}

/** Called by the scheduler. Returns how many sources were queued. */
export async function enqueueDueSources(limit = 200): Promise<number> {
  if (!scrapeQueue) return 0;
  const { rows } = await pool.query<{ id: string; organization_id: string }>(
    `select ss.id, ss.organization_id
       from scraping_sources ss
      where ss.paused = false
        and ss.compliance_status not in ('manual_only', 'blocked')
        and (ss.next_check_at is null or ss.next_check_at <= now())
        and not exists (
          select 1 from scraping_job_runs j
           where j.scraping_source_id = ss.id
             and j.status in ('queued', 'running')
             and j.created_at > now() - interval '1 hour')
      order by ss.next_check_at nulls first
      limit $1`,
    [limit],
  );
  let queued = 0;
  for (const r of rows) {
    try {
      await queueRun(r.organization_id, r.id, false);
      queued++;
    } catch (e) {
      console.warn("[scrape] could not queue source", r.id, (e as Error).message);
    }
  }
  return queued;
}

async function finishRun(jobRunId: string, status: "failed" | "succeeded", reason?: string) {
  await pool.query(
    "update scraping_job_runs set status = $2, failure_reason = $3, finished_at = now() where id = $1",
    [jobRunId, status, reason ? reason.slice(0, 1000) : null],
  );
}

async function recordFinalFailure(
  jobRunId: string,
  sourceId: string,
  organizationId: string,
  reason: string,
  blocked: boolean,
) {
  const msg = reason.slice(0, 1000);
  await pool.query(
    "update scraping_job_runs set status = 'failed', failure_reason = $2, finished_at = now() where id = $1",
    [jobRunId, msg],
  );
  const r = await pool.query<{ consecutive_failures: number; paused: boolean }>(
    `update scraping_sources
        set last_checked_at = now(),
            last_status = 'failed',
            last_failure_reason = $2,
            consecutive_failures = consecutive_failures + 1,
            paused = paused or (consecutive_failures + 1 >= $3) or $4,
            next_check_at = now() + make_interval(
              mins => least($5::int * power(2, consecutive_failures), $6::int)::int),
            updated_at = now()
      where id = $1
  returning consecutive_failures, paused`,
    [sourceId, msg, AUTO_PAUSE_AFTER, blocked, BASE_BACKOFF_MIN, MAX_BACKOFF_MIN],
  );
  const row = r.rows[0];
  if (row?.paused && (row.consecutive_failures >= AUTO_PAUSE_AFTER || blocked)) {
    await pool.query(
      `insert into notifications (user_id, type, payload)
       select u.id, 'source_paused', $2::jsonb from users u where u.organization_id = $1`,
      [organizationId, JSON.stringify({ sourceId, reason: msg })],
    );
  }
}

async function processJob(job: Job<ScrapeJobData>) {
  const { jobRunId, sourceId, organizationId, manual } = job.data;
  const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

  await pool.query(
    "update scraping_job_runs set status = 'running', started_at = coalesce(started_at, now()) where id = $1",
    [jobRunId],
  );

  const src = await pool.query<SourceRow>(
    `select ss.url, ss.paused, ss.compliance_status, ss.scrape_interval_minutes,
            o.default_currency,
            o.scraping_credits_total - o.scraping_credits_used as remaining,
            (select cp.price_selector from competitor_products cp
              where cp.scraping_source_id = ss.id and cp.price_selector is not null
              limit 1) as selector
       from scraping_sources ss
       join organizations o on o.id = ss.organization_id
      where ss.id = $1 and ss.organization_id = $2`,
    [sourceId, organizationId],
  );
  if (!src.rowCount) return finishRun(jobRunId, "failed", "Source no longer exists.");
  const s = src.rows[0];

  if (s.paused && !manual) return finishRun(jobRunId, "failed", "Tracking is paused for this source.");
  if (s.compliance_status === "manual_only" || s.compliance_status === "blocked") {
    return finishRun(jobRunId, "failed", `Source is ${s.compliance_status}.`);
  }
  if (ENFORCE_CREDITS && s.remaining <= 0) {
    return finishRun(jobRunId, "failed", "Out of scraping credits. Upgrade your plan to keep tracking prices.");
  }

  const prior = await pool.query<{ price_cents: number }>(
    `select ps.price_cents from price_snapshots ps
       join competitor_products cp on cp.id = ps.competitor_product_id
      where cp.scraping_source_id = $1 and (ps.validation_flag is null or ps.validation_flag = 'ok')
      order by ps.observed_at desc limit 1`,
    [sourceId],
  );
  const lastKnown = prior.rows[0]?.price_cents ?? null;

  let scraped;
  try {
    scraped = await scrapePrice(s.url, {
      selector: s.selector,
      defaultCurrency: s.default_currency,
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });
  } catch (e) {
    const blocked = e instanceof ScrapeError && e.blocked;
    if (isFinalAttempt) await recordFinalFailure(jobRunId, sourceId, organizationId, (e as Error).message, blocked);
    throw e;
  }

  const flag = validateSnapshot(scraped, lastKnown);
  const changed = lastKnown !== null && lastKnown !== scraped.priceCents;

  const client = await pool.connect();
  try {
    await client.query("begin");

    const spent = await client.query(
      `update organizations
          set scraping_credits_used = scraping_credits_used + 1, updated_at = now()
        where id = $1 ${ENFORCE_CREDITS ? "and scraping_credits_used < scraping_credits_total" : ""}`,
      [organizationId],
    );
    if (ENFORCE_CREDITS && !spent.rowCount) throw new Error("Out of scraping credits.");

    await client.query(
      `insert into price_snapshots
         (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
       select id, $2, $3, $4, 'scraped', $5
         from competitor_products where scraping_source_id = $1`,
      [sourceId, scraped.priceCents, scraped.currency, scraped.inStock, flag],
    );

    await client.query(
      `update scraping_sources
          set last_checked_at = now(), last_status = 'ok',
              consecutive_failures = 0, last_failure_reason = null,
              next_check_at = now() + make_interval(mins => scrape_interval_minutes),
              updated_at = now()
        where id = $1`,
      [sourceId],
    );

    await client.query(
      `update scraping_job_runs
          set status = 'succeeded', finished_at = now(),
              result_price_cents = $2, result_currency = $3, method = $4
        where id = $1`,
      [jobRunId, scraped.priceCents, scraped.currency, scraped.method],
    );

    if (changed && flag === "ok") {
      await client.query(
        `insert into notifications (user_id, type, payload)
         select u.id, 'competitor_price_change', $2::jsonb from users u where u.organization_id = $1`,
        [
          organizationId,
          JSON.stringify({ sourceId, previousCents: lastKnown, newCents: scraped.priceCents, currency: scraped.currency }),
        ],
      );
    }

    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  await activateTrialIfNeeded(organizationId).catch((e) => console.warn("[scrape] trial activation failed", e));
}

export function startScrapeWorker(): Worker<ScrapeJobData> | null {
  if (!connection) {
    console.warn("[scrape] REDIS_URL not set. Scraper worker disabled.");
    return null;
  }
  const worker = new Worker<ScrapeJobData>(QUEUE, processJob, {
    connection,
    concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 3),
  });
  worker.on("failed", (job, err) =>
    console.warn(`[scrape] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`),
  );
  worker.on("completed", (job) => console.log(`[scrape] job ${job.id} done`));
  worker.on("error", (err) => console.error("[scrape] worker error:", err));
  return worker;
}