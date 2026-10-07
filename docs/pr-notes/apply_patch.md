# Wiring for modules 7 and 8

## API (apps/api/src/index.ts)
    import pricingApplyRouter from "./routes/pricingApply";
    app.use("/api/pricing", pricingApplyRouter);

## Pricing page (where OptimizedPricingPanel is rendered)
Pass the current price and a refresh callback:

    <OptimizedPricingPanel
      variantId={variant.id}
      costCents={variant.cost_cents}
      currentPriceCents={variant.current_price_cents}
      onChanged={reloadVariant}
    />

## types/inventory.ts
Add the warning to the response type so the panel compiles without a cast:

    baselines: Record<keyof PricingWeights, { price_cents: number; margin_percent: number; warning?: string | null }>;

## routes/scraping.ts, GET /sources
Add `last_failure_reason` to the SELECT so failure reasons show in the table:

    ss.last_failure_reason,

## Not done (need code I haven't seen)
- Module 7: competitor low/average display; the /app/pricing/:productId/history route (App.tsx passes a product ID but the API expects a variant ID).
- Module 8: Accept/reject for "Needs review" (no endpoint exists yet); "test selector" preview; Delete (no DELETE route in routes/scraping.ts, despite the earlier review); link from navigation (AppShell); reuse of CompetitorSearchBar for the SKU picker (the native datalist is simpler).
