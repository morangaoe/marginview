import "express-async-errors";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { pool } from "./db/pool";
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

const app = express();

// FRONTEND_URL should be set in production to your deployed frontend's
// origin (e.g. https://marginview.vercel.app). Multiple origins can be
// comma-separated. Falls back to common local dev ports when unset.
const allowedOrigins = (
  process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:5174"
)
  .split(",")
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: allowedOrigins,
  })
);
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/products", productsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/procurement", procurementRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/billing", billingRouter);
app.use("/api/scraping", scrapingRouter);
app.use("/api/suppliers", suppliersRouter);
app.use("/api/admin", adminRouter);

// Centralized error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Please try again." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Marginview API listening on port ${port}`);
  // Start the Phase 2 scraping scheduler after the server is up
  startScrapingScheduler(pool);
});