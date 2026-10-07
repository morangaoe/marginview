import { Router } from "express";
import { pool } from "../db/pool";
import { HttpError, orgIdOf, wrap } from "../utils/http";
import { searchCompetitorListings, serpFailure } from "../services/serpService";
import { logger } from "../utils/log";

const router = Router();
const log = logger("search");

/** GET /api/search/competitors?q=keywords-or-EAN */
router.get(
  "/competitors",
  wrap(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 3) throw new HttpError(400, "Enter at least 3 characters or a full EAN.");
    const org = await pool.query<{ default_currency: string }>(
      "select default_currency from organizations where id = $1",
      [orgIdOf(req)],
    );
    const currency = org.rows[0]?.default_currency?.trim() || "USD";
    try {
      res.json({ results: await searchCompetitorListings(q, { limit: 40, currency }) });
    } catch (e) {
      const msg = (e as Error).message;
      log.error("market search failed", { q, error: msg });
      const f = serpFailure(e);
      throw new HttpError(f.status, f.message);
    }
  }),
);

export default router;
