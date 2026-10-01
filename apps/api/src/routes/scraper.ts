import { Router } from "express";
import { pool } from "../db/pool";
import { enqueueScrape } from "../queues/scrapeQueue";
import { HttpError, orgIdOf, wrap } from "../utils/http";

const router = Router();

/** POST /api/scraper/run { sourceId }  ->  202 { jobId } */
router.post(
  "/run",
  wrap(async (req, res) => {
    const sourceId = String(req.body?.sourceId ?? "");
    if (!sourceId) throw new HttpError(400, "sourceId is required.");
    try {
      const jobId = await enqueueScrape(orgIdOf(req), sourceId);
      res.status(202).json({ jobId });
    } catch (e: any) {
      if (e.status) throw new HttpError(e.status, e.message);
      throw e;
    }
  }),
);

router.get(
  "/jobs/:id",
  wrap(async (req, res) => {
    const r = await pool.query(
      `select id, status, failure_reason as "failureReason", result_price_cents as "priceCents",
              result_currency as currency, method, started_at as "startedAt", finished_at as "finishedAt"
         from scraping_job_runs where id = $1 and organization_id = $2`,
      [req.params.id, orgIdOf(req)],
    );
    if (!r.rowCount) throw new HttpError(404, "Job not found.");
    res.json(r.rows[0]);
  }),
);

export default router;
