import "express-async-errors";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { pool } from "./db/pool";
import { requireAuth } from "./middleware/auth";
import { adminRouter } from "./routes/admin";
import { assistantRouter } from "./routes/assistant";
import { authRouter } from "./routes/auth";
import { billingRouter } from "./routes/billing";
import inventoryRouter from "./routes/inventory";
import pricingRouter from "./routes/pricing";
import { procurementRouter } from "./routes/procurement";
import productsRouter from "./routes/products";
import { scrapingRouter } from "./routes/scraping";
import { suppliersRouter } from "./routes/suppliers";
import { startScrapingScheduler } from "./services/scraping/scheduler";
import onboardingRouter from "./routes/onboarding";
import searchRouter from "./routes/search";
import competitorsRouter from "./routes/competitors";
import scraperRouter from "./routes/scraper";
import { startScrapeWorker } from "./queues/scrapeQueue";
import { HttpError } from "./utils/http";

const app = express();

/**
 * CORS: FRONTEND_URL accepts a comma-separated list of allowed origins.
 * Trailing slashes are stripped because browsers send Origin without one.
 * In Railway, set FRONTEND_URL=https://your-app.vercel.app
 */
const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (!process.env.JWT_SECRET) {
  console.warn("[config] JWT_SECRET is not set — using an insecure dev secret. Set it in Railway.");
}
if (!process.env.DATABASE_URL) {
  console.warn("[config] DATABASE_URL is not set — database queries will fail.");
}

app.use(cors({ origin: allowedOrigins, credentials: true }));
// Bulk CSV import accepts up to 2000 rows; bump the JSON body limit.
app.use(express.json({ limit: "5mb" }));

// ── Health check (no auth required) ─────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Public routes ────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter); // /register (public) + / (protected, handled inside router)

// ── Protected routes (requireAuth applied here in index.ts) ─────────────────
app.use("/api/products", requireAuth, productsRouter);
app.use("/api/inventory", requireAuth, inventoryRouter);
app.use("/api/pricing", requireAuth, pricingRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/competitors", requireAuth, competitorsRouter);
app.use("/api/scraper", requireAuth, scraperRouter);

// FIX: SkuDetail.tsx calls /api/skus/:skuId — alias it to the inventory router
// so it resolves without a 404.
app.use("/api/skus", requireAuth, inventoryRouter);

// These apply requireAuth inside their own router.
app.use("/api/procurement", procurementRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/billing", billingRouter);
app.use("/api/scraping", scrapingRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/admin", adminRouter);

// ── Unknown /api routes — return JSON instead of Express's HTML 404 ──────────
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Centralized error handler ────────────────────────────────────────────────
app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === "entity.too.large" || err?.status === 413) {
      return res
        .status(413)
        .json({ error: "Request is too large. Try uploading fewer rows at a time." });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Invalid JSON in request body." });
    }
    // Log with enough context to diagnose in Railway logs
    console.error("[api] unhandled error", {
      message: (err as Error)?.message,
      stack: (err as Error)?.stack,
    });
    res.status(500).json({ error: "Something went wrong on our end. Please try again." });
  },
);

// ── Server startup ───────────────────────────────────────────────────────────
let scrapeWorker: ReturnType<typeof startScrapeWorker> = null;

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`[api] Marginview API listening on port ${port}`);
  console.log(`[api] CORS allowed origins: ${allowedOrigins.join(", ")}`);
  startScrapingScheduler(pool);
  scrapeWorker = startScrapeWorker();
});

// ── Graceful shutdown (Railway sends SIGTERM on redeploy) ────────────────────
const shutdown = (signal: string) => {
  console.log(`[api] Received ${signal} — shutting down gracefully`);
  server.close(() => {
    Promise.resolve(scrapeWorker?.close())
      .catch(() => undefined)
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
  // Force-exit if graceful shutdown takes too long
  setTimeout(() => process.exit(1), 15_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
