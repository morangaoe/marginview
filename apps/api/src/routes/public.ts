import crypto from "node:crypto";
import { Router, type Request } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { HttpError, wrap } from "../utils/http";
import { AUDIT_MAX_ROWS, auditCatalog, type AuditInputRow } from "../services/priceAudit";
import { median } from "../services/pricingStrategies";
import { searchCompetitorListings, serpFailure } from "../services/serpService";
import { logger } from "../utils/log";

/**
 * Unauthenticated lead-magnet endpoints. Market search costs real SerpAPI credits,
 * so it is quota'd per visitor (IP hash) and capped globally per day.
 */
const router = Router();
const log = logger("public");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const ANON_SEARCHES = 2; // per IP per 24h, no email
const LEAD_SEARCHES = 5; // per lead per 24h, once an email is given
const DAILY_SEARCH_CAP = Number(process.env.PUBLIC_SEARCH_DAILY_CAP) || 300;
const AUDITS_PER_LEAD = 10; // per lead per 24h
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ipHash = (req: Request) =>
  crypto.createHash("sha256").update(`${JWT_SECRET}:${req.ip ?? "unknown"}`).digest("hex").slice(0, 32);

/** Returns the lead id from `Authorization: Bearer <lead token>`, or null. */
function leadIdOf(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  try {
    const raw = jwt.verify(h.slice(7), JWT_SECRET) as Record<string, unknown>;
    return raw.kind === "lead" && typeof raw.leadId === "string" ? raw.leadId : null;
  } catch {
    return null;
  }
}

async function used(kind: "search" | "audit", where: "ip_hash" | "lead_id", value: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `select count(*) n from public_usage where kind = $1 and ${where} = $2 and created_at > now() - interval '24 hours'`,
    [kind, value],
  );
  return Number(r.rows[0].n);
}

/** POST /api/public/leads { email, source? } -> { token }. Unlocks more searches and the audit. */
router.post(
  "/leads",
  wrap(async (req, res) => {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "Enter a valid email address.");
    const source = req.body?.source === "audit" ? "audit" : "market_search";
    const r = await pool.query<{ id: string }>(
      `insert into leads (email, source, ip_hash) values ($1, $2, $3)
       on conflict (lower(email)) do update set last_seen_at = now()
       returning id`,
      [email, source, ipHash(req)],
    );
    const token = jwt.sign({ kind: "lead", leadId: r.rows[0].id }, JWT_SECRET, { expiresIn: "30d" });
    log.info("lead captured", { source });
    res.status(201).json({ token, searchesPerDay: LEAD_SEARCHES });
  }),
);

/** GET /api/public/search?q= : same market search as the app, a few times without an account. */
router.get(
  "/search",
  wrap(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 3 || q.length > 120) throw new HttpError(400, "Enter between 3 and 120 characters.");

    const leadId = leadIdOf(req);
    const ip = ipHash(req);
    const limit = leadId ? LEAD_SEARCHES : ANON_SEARCHES;
    const spent = leadId ? await used("search", "lead_id", leadId) : await used("search", "ip_hash", ip);
    if (spent >= limit) {
      // 402 tells the UI to show the email gate (or the signup prompt once past the lead quota).
      throw new HttpError(402, leadId
        ? "You've used today's free searches. Start a free trial to keep going."
        : "Enter your email to unlock more free searches.");
    }
    const today = await pool.query<{ n: string }>(
      "select count(*) n from public_usage where kind = 'search' and created_at > now() - interval '24 hours'",
    );
    if (Number(today.rows[0].n) >= DAILY_SEARCH_CAP) {
      throw new HttpError(503, "Free search is busy right now. Try again tomorrow, or start a free trial.");
    }

    let listings;
    try {
      listings = await searchCompetitorListings(q, { limit: 12, currency: "USD" });
    } catch (e) {
      log.error("public search failed", { error: (e as Error).message });
      const f = serpFailure(e);
      throw new HttpError(f.status, f.message);
    }
    // Count the search only after it succeeded, so a SerpAPI outage doesn't burn the visitor's quota.
    await pool.query("insert into public_usage (kind, ip_hash, lead_id, detail) values ('search', $1, $2, $3)", [ip, leadId, q]);

    const prices = listings.filter((l) => l.priceCents !== null && l.currency === "USD").map((l) => l.priceCents!);
    res.json({
      query: q,
      results: listings.map(({ title, merchant, url, googleUrl, priceCents, currency, thumbnail }) => ({
        title, merchant, url, googleUrl, priceCents, currency, thumbnail,
      })),
      stats: prices.length
        ? { medianCents: Math.round(median(prices)!), minCents: Math.min(...prices), maxCents: Math.max(...prices), count: prices.length, currency: "USD" }
        : null,
      remaining: Math.max(0, limit - spent - 1),
      unlocked: leadId !== null,
    });
  }),
);

/** POST /api/public/audit { rows: [{sku,name,costCents,priceCents,quantity}], targetMarginPct? } (lead token required) */
router.post(
  "/audit",
  wrap(async (req, res) => {
    const leadId = leadIdOf(req);
    if (!leadId) throw new HttpError(402, "Enter your email to get the margin report.");
    if ((await used("audit", "lead_id", leadId)) >= AUDITS_PER_LEAD) {
      throw new HttpError(429, "That's enough audits for today. Start a free trial to keep going.");
    }

    const body = Array.isArray(req.body?.rows) ? (req.body.rows as unknown[]) : [];
    if (body.length === 0) throw new HttpError(400, "Upload a CSV with at least one product.");
    if (body.length > AUDIT_MAX_ROWS) throw new HttpError(400, `The free audit covers up to ${AUDIT_MAX_ROWS} products. Start a trial for larger catalogs.`);

    const cents = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2_147_483_647 ? v : null);
    const rows: AuditInputRow[] = body.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const costCents = cents(r.costCents);
      if (costCents === null) throw new HttpError(400, `Row ${i + 1}: cost must be a positive amount.`);
      const qty = typeof r.quantity === "number" && Number.isSafeInteger(r.quantity) && r.quantity >= 0 ? r.quantity : 0;
      return {
        sku: String(r.sku ?? "").slice(0, 100),
        name: String(r.name ?? "").slice(0, 255),
        costCents,
        priceCents: r.priceCents == null ? null : cents(r.priceCents),
        quantity: qty,
      };
    });
    const target = Number(req.body?.targetMarginPct);
    const report = auditCatalog(rows, Number.isFinite(target) ? { targetMarginPct: target } : {});

    await pool.query("insert into public_usage (kind, ip_hash, lead_id, detail) values ('audit', $1, $2, $3)", [ipHash(req), leadId, `${rows.length} rows`]);
    res.json(report);
  }),
);

export default router;
