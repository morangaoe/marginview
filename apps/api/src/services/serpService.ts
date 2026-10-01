export interface CompetitorListing {
  title: string;
  merchant: string;
  url: string;
  priceCents: number | null;
  currency: string;
  thumbnail: string | null;
}

const TIMEOUT_MS = 12_000;

/** SerpAPI Google Shopping search. Swap the body for DataForSEO if you prefer. */
export async function searchCompetitorListings(query: string, limit = 10): Promise<CompetitorListing[]> {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error("SERPAPI_KEY is not configured");
  const params = new URLSearchParams({ engine: "google_shopping", q: query, api_key: key, num: String(limit) });
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SerpAPI responded ${res.status}`);
  const data = (await res.json()) as { shopping_results?: any[] };
  return (data.shopping_results ?? [])
    .map((r): CompetitorListing | null => {
      const url: string | undefined = r.product_link ?? r.link;
      if (!url || !r.title) return null;
      const price = typeof r.extracted_price === "number" ? Math.round(r.extracted_price * 100) : null;
      return {
        title: String(r.title),
        merchant: String(r.source ?? "Unknown seller"),
        url,
        priceCents: price,
        currency: "USD",
        thumbnail: r.thumbnail ?? null,
      };
    })
    .filter((x): x is CompetitorListing => x !== null)
    .slice(0, limit);
}
