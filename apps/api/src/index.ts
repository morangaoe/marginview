import "express-async-errors";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { pool } from "./db/pool";
import { checkScrapingSchema, runMigrations } from "./db/migrate";
import { startScrapeWorker } from "./queues/scrapeQueue";
import { jwtSecret, requireAuth } from "./middleware/auth";
import { requireModule } from "./middleware/plan";
import { adminRouter } from "./routes/admin";
import { assistantRouter } from "./routes/assistant";
import { authRouter } from "./routes/auth";
import { billingRouter, billingWebhookRouter } from "./routes/billing";
import competitorsRouter from "./routes/competitors";
import inventoryRouter from "./routes/inventory";
import onboardingRouter from "./routes/onboarding";
import pricingRouter from "./routes/pricing";
import pricingApplyRouter from "./routes/pricingApply";
import { procurementRouter } from "./routes/procurement";
import publicRouter from "./routes/public";
import productsRouter from "./routes/products";
import searchRouter from "./routes/search";
import scraperRouter from "./routes/scraper";
import { scrapingRouter } from "./routes/scraping";
import { suppliersRouter } from "./routes/suppliers";
import { integrationsRouter } from "./routes/integrations";
import { aiRouter } from "./routes/ai";
import { dashboardRouter } from "./routes/dashboard";
import { errorsRouter } from "./routes/errors";
import { platformRouter } from "./routes/platform";
import { startScrapingScheduler, type SchedulerHandle } from "./services/scraping/scheduler";
import { errorCapture, recordEvent } from "./services/errorLog";
import { HttpError } from "./utils/http";

const app = express();

// FRONTEND_URL should be set in production to your deployed frontend's
// origin (e.g. https://marginview.vercel.app). Multiple origins can be
// comma-separated. Falls back to common local dev ports when unset.
// Trailing slashes are stripped because browsers send Origin without one,
// and "https://app.vercel.app/" would never match.
const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

// Fails fast in production when JWT_SECRET is missing or a placeholder.
jwtSecret();
if (!process.env.PLATFORM_ADMIN_EMAILS) {
  console.warn("[config] PLATFORM_ADMIN_EMAILS is not set. Nobody can open the platform admin dashboard.");
}
if (!process.env.DATABASE_URL) {
  console.warn("[config] DATABASE_URL is not set. Database queries will fail.");
}

// Railway/Vercel sit behind one proxy hop; without this req.ip is the proxy and every visitor shares one quota.
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigins }));
// Stripe webhook needs the raw body for signature checks, so it goes before express.json().
app.use("/api/billing/webhook", billingWebhookRouter);
// Bulk CSV import accepts up to 2000 rows, which exceeds Express's 100kb default.
app.use(express.json({ limit: "5mb" }));
// Logs every 5xx to error_events for the platform admin dashboard.
app.use(errorCapture);

app.get("/health", (_req, res) => res.json({ ok: true }));

// Public
app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/public", publicRouter);
app.use("/api/errors", errorsRouter);

// Protected: these three routers read req.user, so requireAuth must run first.
app.use("/api/products", requireAuth, productsRouter);
app.use("/api/inventory", requireAuth, inventoryRouter);
app.use("/api/pricing", requireAuth, pricingRouter);
app.use("/api/pricing", requireAuth, pricingApplyRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/competitors", requireAuth, competitorsRouter);
app.use("/api/scraper", requireAuth, scraperRouter);

// BUG FIX: mount AI routes with requireAuth at the call site, matching
// the convention used by every other protected route in this file. The
// pasted spec omitted requireAuth here, which would work (both routers
// apply it internally), but breaks the pattern and risks a regression
// if someone later removes the internal middleware.
app.use("/api/integrations", requireAuth, integrationsRouter);
app.use("/api/ai", requireAuth, aiRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);

// These apply requireAuth inside the router themselves.
app.use("/api/procurement", requireAuth, requireModule("procurement"), procurementRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/billing", billingRouter);
app.use("/api/scraping", scrapingRouter);
app.use("/api/suppliers", requireAuth, requireModule("procurement"), suppliersRouter);
app.use("/api/admin", adminRouter);
app.use("/api/platform", platformRouter);

// Unknown /api routes get JSON instead of Express's default HTML 404.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Centralized error handler
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "Request is too large. Try uploading fewer rows at a time." });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON in request body." });
  }
  console.error(err);
  res.locals.capturedError = { message: err?.message ?? String(err), stack: err?.stack };
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

process.on("unhandledRejection", (reason) => {
  const e = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[api] unhandled promise rejection", e);
  void recordEvent({ source: "worker", message: `Unhandled rejection: ${e.message}`, stack: e.stack });
});

// Migrations are idempotent; running them here keeps the code and schema in step on every
// deploy (auth now reads users.password_changed_at). Set AUTO_MIGRATE=false to run them by hand.
async function migrateOnBoot() {
  if (process.env.AUTO_MIGRATE === "false") return;
  try {
    await runMigrations();
  } catch (e) {
    console.error("[migrate] startup migration failed:", (e as Error).message);
  }
}

const port = Number(process.env.PORT) || 4000;
const scrapeWorker = startScrapeWorker();
let scheduler: SchedulerHandle | null = null;
let server: ReturnType<typeof app.listen> | undefined;
void migrateOnBoot().then(() => {
  server = app.listen(port, () => {
    console.log(`Marginview API listening on port ${port}`);
    console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
    // Start the Phase 2 scraping scheduler after the server is up
    scheduler = startScrapingScheduler(pool);
    void checkScrapingSchema();
    if (!process.env.SERPAPI_KEY) console.warn("[config] SERPAPI_KEY is not set. Market search and similar products are disabled.");
  });
});

// Railway sends SIGTERM on redeploy; close cleanly so in-flight requests finish.
const shutdown = (signal: string) => {
  console.log(`[api] Received ${signal} — shutting down gracefully`);
  if (!server) process.exit(0);
  server.close(() => {
    Promise.resolve(scheduler?.stop())
      .then(() => scrapeWorker?.close())
      .catch(() => undefined)
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 15_000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));