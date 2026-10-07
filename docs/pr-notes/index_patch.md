# Wiring changes (apps/api)

## index.ts
Replace the scheduler start and shutdown so the scheduler stops before the DB closes.

    import { startScrapingScheduler, type SchedulerHandle } from "./services/scraping/scheduler";

    let scheduler: SchedulerHandle | null = null;
    // inside app.listen callback, replace startScrapingScheduler(pool) with:
    scheduler = startScrapingScheduler(pool);

    const shutdown = (signal: string) => {
      console.log(`[api] Received ${signal} — shutting down gracefully`);
      server.close(() => {
        Promise.resolve(scheduler?.stop())
          .then(() => scrapeWorker?.close())
          .catch(() => undefined)
          .then(() => pool.end())
          .finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 15_000);
    };

## routes/scraping.ts
- Remove imports of ../services/scraping/extractPrice and ../services/scraping/runScrapingCycle.
- Replace POST /run-now body with:

    scrapingRouter.post("/run-now", requireRole("owner"), async (req, res) => {
      const queued = await enqueueDueSources();
      res.status(202).json({ queued });
    });

- Replace the plain-fetch "Check now" in POST /sources/:id/run with the queue:

    const jobId = await enqueueScrape(req.user.organizationId, req.params.id);
    res.status(202).json({ jobId });

  (Poll GET /api/scraper/jobs/:id for the result.)

## Delete these superseded files
- services/scraper/scraperEngine.ts     -> scrapePrice.ts
- services/scraper/zenrowsClient.ts     -> scrapePrice.ts
- services/scraper/jsonLdParser.ts      -> priceExtractor.ts
- services/scraping/extractPrice.ts     -> priceExtractor.ts
- services/scraping/runScrapingCycle.ts -> queues/scrapeQueue.ts (enqueueDueSources)
- services/scraping/complianceCheck.ts is unchanged.

Update any remaining imports of the deleted files. Run `tsc --noEmit` to find them.
