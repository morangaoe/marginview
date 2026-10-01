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

if (!process.env.JWT_SECRET) {
  console.warn("[config] JWT_SECRET is not set. Falling back to an insecure dev secret.");
}
if (!process.env.DATABASE_URL) {
  console.warn("[config] DATABASE_URL is not set. Database queries will fail.");
}

app.use(cors({ origin: allowedOrigins }));
// Bulk CSV import accepts up to 2000 rows, which exceeds Express's 100kb default.
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Public
app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter); // create-or-join workspace signup

// Protected: these three routers read req.user, so requireAuth must run first.
app.use("/api/products", requireAuth, productsRouter);
app.use("/api/inventory", requireAuth, inventoryRouter);
app.use("/api/pricing", requireAuth, pricingRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/competitors", requireAuth, competitorsRouter);
app.use("/api/scraper", requireAuth, scraperRouter);

// These apply requireAuth inside the router themselves.
app.use("/api/procurement", procurementRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/billing", billingRouter);
app.use("/api/scraping", scrapingRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/admin", adminRouter);

// Unknown /api routes get JSON instead of Express's default HTML 404.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Centralized error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

let scrapeWorker: ReturnType<typeof startScrapeWorker> = null;

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`Marginview API listening on port ${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
  // Start the Phase 2 scraping scheduler after the server is up
  startScrapingScheduler(pool);
  // BullMQ worker for on-demand scrapes; returns null (and stays off) when REDIS_URL is unset
  scrapeWorker = startScrapeWorker();
});

// Railway sends SIGTERM on redeploy; close cleanly so in-flight requests finish.
const shutdown = () => {
  server.close(() => {
    Promise.resolve(scrapeWorker?.close())
      .catch(() => undefined)
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
