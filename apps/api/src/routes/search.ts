import { Router } from "express";
import { HttpError, wrap } from "../utils/http";
import { searchCompetitorListings } from "../services/serpService";

const router = Router();

/** GET /api/search/competitors?q=keywords-or-EAN */
router.get(
  "/competitors",
  wrap(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 3) throw new HttpError(400, "Enter at least 3 characters or a full EAN.");
    try {
      res.json({ results: await searchCompetitorListings(q) });
    } catch (e) {
      console.error("[search] SERP failure", e);
      throw new HttpError(502, "Market search is unavailable right now. Try again in a minute.");
    }
  }),
);

export default router;
