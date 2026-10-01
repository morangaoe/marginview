import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { pool } from "../db/pool";
import { scrapePrice } from "../services/scraper/scraperEngine";
import { activateTrialIfNeeded } from "../services/billing";

// Your pricing doc says "soft nudge, never lock out", so credits only block scraping when this is "true".
const ENFORCE_CREDITS = process.env.ENFORCE_SCRAPING_CREDITS === "true";

export interface ScrapeJobData {
  jobRunId: string;
  sourceId: string;
  organizationId: string;
}

const QUEUE = "scrape";
// Redis is optional: without REDIS_URL the queue stays off instead of retry-looping against localhost.
const REDIS_URL = process.env.REDIS_URL;
const connection = REDIS_URL ? new IORedis(REDIS_URL, { maxRetriesPerRequest: null }) : null;
export const scrapeQueue = connection ? new Queue<ScrapeJobData>(QUEUE, { connection }) : null;
const ATTEMPTS = 3;

/** Creates a scraping_job_runs row and enqueues it. Verifies the source belongs to the org. */
export async function enqueueScrape(organizationId: string, sourceId: string): Promise<string> {
  if (!scrapeQueue) {
    throw Object.assign(new Error("Background scraping isn't configured yet (REDIS_URL is not set)."), { status: 503 });
  }
  const src = await pool.query("select compliance_status from scraping_sources where id = $1 and organization_id = $2", [sourceId, organizationId]);
  if (!src.rowCount) throw Object.assign(new Error("Source not found"), { status: 404 });
  if (src.rows[0].compliance_status === "manual_only") {
    throw Object.assign(new Error("This source is marked manual-only and can't be scraped automatically."), { status: 409 });
  }
  const run = await pool.query(
    "insert into scraping_job_runs (scraping_source_id, organization_id, status) values ($1, $2, 'queued') returning id",
    [sourceId, organizationId],
  );
  const jobRunId: string = run.rows[0].id;
  await scrapeQueue.add("scrape", { jobRunId, sourceId, organizationId }, {
    jobId: jobRunId,
    attempts: ATTEMPTS,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  return jobRunId;
}

async function processJob(job: Job<ScrapeJobData>) {
  const { jobRunId, sourceId, organizationId } = job.data;
  await pool.query("update scraping_job_runs set status = 'running', started_at = coalesce(started_at, now()) where id = $1", [jobRunId]);

  const credits = await pool.query("select scraping_credits_total - scraping_credits_used as remaining from organizations where id = $1", [organizationId]);
  if (!credits.rowCount) {
    await fail(jobRunId, sourceId, "Organization not found.");
    return;
  }
  if (ENFORCE_CREDITS && credits.rows[0].remaining <= 0) {
    await fail(jobRunId, sourceId, "Out of scraping credits. Upgrade your plan to keep tracking prices.");
    return; // no retry: retrying cannot fix this
  }

  const src = await pool.query("select url from scraping_sources where id = $1 and organization_id = $2", [sourceId, organizationId]);
  if (!src.rowCount) return fail(jobRunId, sourceId, "Source no longer exists.");

  try {
    const r = await scrapePrice(src.rows[0].url);
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Only successful scrapes cost a credit. The guard applies only when enforcement is on.
      const spent = await client.query(
        `update organizations set scraping_credits_used = scraping_credits_used + 1, updated_at = now()
          where id = $1 ${ENFORCE_CREDITS ? "and scraping_credits_used < scraping_credits_total" : ""}`,
        [organizationId],
      );
      if (!spent.rowCount) throw new Error("Out of scraping credits.");
      await client.query(
        `insert into price_snapshots (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
         select id, $2, $3, $4, 'scraped', 'ok' from competitor_products where scraping_source_id = $1`,
        [sourceId, r.priceCents, r.currency, r.inStock],
      );
      await client.query("update scraping_sources set last_checked_at = now(), last_status = 'ok', updated_at = now() where id = $1", [sourceId]);
      await client.query(
        `update scraping_job_runs set status = 'succeeded', finished_at = now(), result_price_cents = $2, result_currency = $3, method = $4
          where id = $1`,
        [jobRunId, r.priceCents, r.currency, r.method],
      );
      await client.query("commit");
      // Your existing helper starts the trial clock (idempotent). Runs after commit; never fails the job.
      await activateTrialIfNeeded(organizationId).catch((e) => console.warn("[scrape] trial activation failed", e));
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (finalAttempt) await fail(jobRunId, sourceId, (e as Error).message);
    throw e; // lets BullMQ retry with backoff
  }
}

async function fail(jobRunId: string, sourceId: string, reason: string) {
  await pool.query("update scraping_job_runs set status = 'failed', failure_reason = $2, finished_at = now() where id = $1", [jobRunId, reason.slice(0, 1000)]);
  await pool.query("update scraping_sources set last_checked_at = now(), last_status = 'failed', updated_at = now() where id = $1", [sourceId]);
}

export function startScrapeWorker(): Worker<ScrapeJobData> | null {
  if (!connection) {
    console.warn("[scrape] REDIS_URL not set: scrape worker disabled");
    return null;
  }
  const worker = new Worker<ScrapeJobData>(QUEUE, processJob, { connection, concurrency: Number(process.env.SCRAPE_CONCURRENCY ?? 3) });
  worker.on("failed", (job, err) => console.warn(`[scrape] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`));
  worker.on("completed", (job) => console.log(`[scrape] job ${job.id} done`));
  return worker;
}
