/**
 * The single scraping pipeline, queued in Postgres (scraping_job_runs) so no Redis is needed. Everything that fetches a price goes through here:
 *   - the scheduler (enqueueDueSources), every minute
 *   - "Check now" (enqueueScrape), manual=true so paused sources still run
 */
import { pool } from "../db/pool";
import { scrapePrice, ScrapeError } from "../services/scraper/scrapePrice";
import { activateTrialIfNeeded } from "../services/billing";
import { validateSnapshot } from "../services/scraping/validateSnapshot";
import { checkComplianceDetailed } from "../services/scraping/complianceCheck";
import { logger } from "../utils/log";
import { recordEvent } from "../services/errorLog";

const log = logger("scrape");

const ENFORCE_CREDITS = process.env.ENFORCE_SCRAPING_CREDITS === "true";
const ATTEMPTS = 3;
const JOB_TIMEOUT_MS = 90_000;
const RETRY_BASE_MS = 15_000;
/** A run still "running" after this long belonged to a worker that died (deploy, sleep, crash). */
const STALE_RUNNING_MIN = 5;
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

async function queueRun(organizationId: string, sourceId: string, manual: boolean): Promise<string> {
  const run = await pool.query(
    "insert into scraping_job_runs (scraping_source_id, organization_id, status, manual) values ($1, $2, 'queued', $3) returning id",
    [sourceId, organizationId, manual],
  );
  return run.rows[0].id as string;
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
  const id = await queueRun(organizationId, sourceId, true);
  kickWorker();
  return id;
}

/** Called by the scheduler. Returns how many sources were queued. */
export async function enqueueDueSources(limit = 200, organizationId?: string): Promise<number> {
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
        and ($2::uuid is null or ss.organization_id = $2::uuid)
      order by ss.next_check_at nulls first
      limit $1`,
    [limit, organizationId ?? null],
  );
  let queued = 0;
  for (const r of rows) {
    try {
      await queueRun(r.organization_id, r.id, false);
      queued++;
    } catch (e) {
      log.error("could not queue source", { source: r.id, error: (e as Error).message });
    }
  }
  if (queued) kickWorker();
  return queued;
}

async function finishRun(jobRunId: string, status: "failed" | "succeeded", reason?: string) {
  await pool.query(
    "update scraping_job_runs set status = $2, failure_reason = $3, finished_at = now() where id = $1",
    [jobRunId, status, reason ? reason.slice(0, 1000) : null],
  );
}

/** A run that was skipped on purpose: record why on both the run and the source so the UI can show it. */
async function skipRun(jobRunId: string, sourceId: string, reason: string, fields: Record<string, unknown> = {}) {
  log.warn("run skipped", { run: jobRunId, source: sourceId, reason, ...fields });
  await finishRun(jobRunId, "failed", reason);
  await pool.query(
    `update scraping_sources set last_status = 'failed', last_failure_reason = $2, updated_at = now() where id = $1`,
    [sourceId, reason.slice(0, 1000)],
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
  log.error("source failed after all attempts", {
    source: sourceId, run: jobRunId, consecutiveFailures: row?.consecutive_failures, paused: row?.paused, blocked, reason: msg,
  });
  await recordEvent({
    source: "scraper",
    level: "warn",
    message: `Scrape failed: ${msg}`,
    organizationId,
    context: { sourceId, jobRunId, consecutiveFailures: row?.consecutive_failures, paused: row?.paused, blocked },
  });
  if (row?.paused && (row.consecutive_failures >= AUTO_PAUSE_AFTER || blocked)) {
    await pool.query(
      `insert into notifications (user_id, type, payload)
       select u.id, 'source_paused', $2::jsonb from users u where u.organization_id = $1`,
      [organizationId, JSON.stringify({ sourceId, reason: msg })],
    );
  }
}

interface ClaimedJob extends ScrapeJobData {
  attempt: number;
}

/** Puts runs left "running" by a dead worker back in the queue (or fails them after the last attempt). */
async function reclaimStale() {
  await pool.query(
    `update scraping_job_runs
        set status = case when attempts >= $2 then 'failed' else 'queued' end,
            failure_reason = case when attempts >= $2 then 'Worker stopped before finishing.' else failure_reason end,
            finished_at = case when attempts >= $2 then now() else finished_at end,
            run_after = now()
      where status = 'running' and locked_at < now() - make_interval(mins => $1::int)`,
    [STALE_RUNNING_MIN, ATTEMPTS],
  );
}

/** Atomically takes up to `n` due jobs. SKIP LOCKED lets several workers claim without blocking each other. */
async function claimJobs(n: number): Promise<ClaimedJob[]> {
  const { rows } = await pool.query(
    `update scraping_job_runs
        set status = 'running', started_at = coalesce(started_at, now()), locked_at = now(), attempts = attempts + 1
      where id in (
        select id from scraping_job_runs
         where status = 'queued' and run_after <= now()
         order by run_after
         limit $1
         for update skip locked)
  returning id, scraping_source_id, organization_id, manual, attempts`,
    [n],
  );
  return rows.map((r) => ({
    jobRunId: r.id,
    sourceId: r.scraping_source_id,
    organizationId: r.organization_id,
    manual: r.manual,
    attempt: r.attempts,
  }));
}

async function processJob(job: ClaimedJob) {
  const { jobRunId, sourceId, organizationId, manual, attempt } = job;
  try {
    await runJob(job, attempt);
  } catch (e) {
    const err = e as Error;
    const isFinalAttempt = attempt >= ATTEMPTS;
    log.warn("attempt failed", { source: sourceId, run: jobRunId, attempt, of: ATTEMPTS, manual: !!manual, error: err.message });
    try {
      if (isFinalAttempt) {
        const blocked = e instanceof ScrapeError && e.blocked;
        await recordFinalFailure(jobRunId, sourceId, organizationId, err.message, blocked);
      } else {
        await pool.query(
          `update scraping_job_runs
              set status = 'queued', failure_reason = $2, run_after = now() + make_interval(secs => $3::int / 1000.0)
            where id = $1`,
          [jobRunId, err.message.slice(0, 1000), RETRY_BASE_MS * 2 ** (attempt - 1)],
        );
      }
    } catch (dbErr) {
      log.error("could not record failure", { source: sourceId, run: jobRunId, error: (dbErr as Error).message });
    }
  }
}

async function runJob({ jobRunId, sourceId, organizationId, manual }: ScrapeJobData, attempt: number) {
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
  if (!src.rowCount) {
    log.warn("run skipped", { run: jobRunId, source: sourceId, reason: "source no longer exists" });
    return finishRun(jobRunId, "failed", "Source no longer exists.");
  }
  const s = src.rows[0];
  log.info("run started", { run: jobRunId, source: sourceId, url: s.url, attempt, manual: !!manual, compliance: s.compliance_status });

  if (s.paused && !manual) return skipRun(jobRunId, sourceId, "Tracking is paused for this source.");

  // A source whose robots.txt couldn't be read yet is re-checked here, never scraped blind.
  if (s.compliance_status === "unreviewed") {
    const c = await checkComplianceDetailed(s.url);
    if (c.status === "unreviewed") throw new Error(c.reason); // transient: retry with backoff
    await pool.query("update scraping_sources set compliance_status = $2, updated_at = now() where id = $1", [
      sourceId,
      c.status,
    ]);
    s.compliance_status = c.status;
    if (c.status === "manual_only") return skipRun(jobRunId, sourceId, c.reason, { url: s.url });
  }
  if (s.compliance_status === "manual_only" || s.compliance_status === "blocked") {
    return skipRun(jobRunId, sourceId, `Source is ${s.compliance_status.replace("_", " ")}; enter its price by hand.`);
  }
  if (ENFORCE_CREDITS && s.remaining <= 0) {
    return skipRun(jobRunId, sourceId, "Out of scraping credits. Upgrade your plan to keep tracking prices.");
  }

  const prior = await pool.query<{ price_cents: number }>(
    `select ps.price_cents from price_snapshots ps
       join competitor_products cp on cp.id = ps.competitor_product_id
      where cp.scraping_source_id = $1 and (ps.validation_flag is null or ps.validation_flag = 'ok')
      order by ps.observed_at desc limit 1`,
    [sourceId],
  );
  const lastKnown = prior.rows[0]?.price_cents ?? null;

  const scraped = await scrapePrice(s.url, {
    selector: s.selector,
    defaultCurrency: s.default_currency,
    signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
  });

  const flag = validateSnapshot(scraped, lastKnown);
  const changed = lastKnown !== null && lastKnown !== scraped.priceCents;

  let stored = 0;
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

    const inserted = await client.query(
      `insert into price_snapshots
         (competitor_product_id, price_cents, currency, in_stock, source, validation_flag)
       select id, $2, $3, $4, 'scraped', $5
         from competitor_products where scraping_source_id = $1`,
      [sourceId, scraped.priceCents, scraped.currency, scraped.inStock, flag],
    );
    stored = inserted.rowCount ?? 0;
    if (!stored) {
      log.warn("price found but no competitor product is linked to this source; nothing stored", { source: sourceId });
    }

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

  log.info("price stored", {
    run: jobRunId, source: sourceId, priceCents: scraped.priceCents, currency: scraped.currency,
    method: scraped.method, via: scraped.via, flag, snapshots: stored,
  });
  await activateTrialIfNeeded(organizationId).catch((e) => log.warn("trial activation failed", { error: (e as Error).message }));
}

const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY ?? 3);
const POLL_MS = 5_000;
let active = 0;
let draining: Promise<void> | null = null;

/** Claims and runs jobs until none are due. Safe to call repeatedly; only one drain runs at a time. */
export function drainQueue(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    try {
      await reclaimStale();
      for (;;) {
        const free = CONCURRENCY - active;
        const jobs = free > 0 ? await claimJobs(free) : [];
        if (!jobs.length && active === 0) break;
        for (const job of jobs) {
          active++;
          void processJob(job)
            .catch((e) => log.error("job crashed", { run: job.jobRunId, error: (e as Error).message }))
            .finally(() => active--);
        }
        await new Promise((r) => setTimeout(r, jobs.length ? 200 : 1000));
      }
    } catch (e) {
      log.error("queue drain failed", { error: (e as Error).message });
    } finally {
      draining = null;
    }
  })();
  return draining;
}

/** Start working the queue now (after enqueueing, or when the cron endpoint wakes the service). */
export function kickWorker() {
  void drainQueue();
}

export function startScrapeWorker(): { stop(): Promise<void> } {
  const timer = setInterval(kickWorker, POLL_MS);
  kickWorker();
  log.info("worker started", { concurrency: CONCURRENCY });
  return {
    async stop() {
      clearInterval(timer);
      await draining?.catch(() => undefined);
    },
  };
}
