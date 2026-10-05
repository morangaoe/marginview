/**
 * The one fetch path for every scrape (queue, scheduler, manual "Check now").
 * Cheap first: direct fetch, then provider basic, provider rendered,
 * and provider premium only after a blocked response.
 * Requires Node 20.3+ (AbortSignal.any).
 */
import { extractPrice, type ExtractOptions, type ExtractedPrice } from "./priceExtractor";

export type ScrapeMethod = "direct" | "api_basic" | "api_rendered" | "api_premium";
export interface ScrapeResult extends ExtractedPrice {
  method: ScrapeMethod;
}
export interface ScrapeOptions extends ExtractOptions {
  /** Hard deadline from the caller (e.g. the queue job timeout). */
  signal?: AbortSignal;
}

export class ScrapeError extends Error {
  constructor(message: string, readonly blocked: boolean) {
    super(message);
    this.name = "ScrapeError";
  }
}

class HttpStatusError extends Error {
  constructor(readonly status: number, label: string) {
    super(`${label} responded ${status}`);
  }
}

const BLOCKED_STATUSES = new Set([401, 403, 429]);
const USER_AGENT = "Mozilla/5.0 (compatible; MarginViewBot/1.0)";

function deadline(ms: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return parent ? AbortSignal.any([parent, t]) : t;
}

async function fetchDirect(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: deadline(15_000, signal),
  });
  if (!res.ok) throw new HttpStatusError(res.status, "direct");
  return res.text();
}

async function fetchViaProvider(
  url: string,
  opts: { render: boolean; premium: boolean },
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.SCRAPING_API_KEY;
  if (!key) throw new Error("SCRAPING_API_KEY is not configured");
  const provider = (process.env.SCRAPING_PROVIDER ?? "zenrows").toLowerCase();
  const isScrapingBee = provider === "scrapingbee";

  // Omit flags that are off so the request is the cheapest mode the provider offers.
  const params: Record<string, string | undefined> = isScrapingBee
    ? { api_key: key, url, render_js: opts.render ? "true" : undefined, premium_proxy: opts.premium ? "true" : undefined }
    : { apikey: key, url, js_render: opts.render ? "true" : undefined, premium_proxy: opts.premium ? "true" : undefined };
  const qs = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const base = isScrapingBee ? "https://app.scrapingbee.com/api/v1/" : "https://api.zenrows.com/v1/";

  const res = await fetch(`${base}?${qs}`, { signal: deadline(45_000, signal) });
  if (!res.ok) throw new HttpStatusError(res.status, provider);
  const html = await res.text();
  if (html.length < 200) throw new Error(`${provider} returned an empty page`);
  return html;
}

interface Tier {
  method: ScrapeMethod;
  run: () => Promise<string>;
  when?: () => boolean;
}

export async function scrapePrice(url: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  const { signal, ...extract } = opts;
  const hasProvider = !!process.env.SCRAPING_API_KEY;
  let blocked = false;

  const tiers: Tier[] = [
    { method: "direct", run: () => fetchDirect(url, signal) },
    {
      method: "api_basic",
      run: () => fetchViaProvider(url, { render: false, premium: false }, signal),
      when: () => hasProvider,
    },
    {
      method: "api_rendered",
      run: () => fetchViaProvider(url, { render: true, premium: false }, signal),
      when: () => hasProvider,
    },
    {
      method: "api_premium",
      run: () => fetchViaProvider(url, { render: true, premium: true }, signal),
      when: () => hasProvider && blocked,
    },
  ];

  const reasons: string[] = [];
  for (const tier of tiers) {
    if (tier.when && !tier.when()) continue;
    if (signal?.aborted) throw new ScrapeError("Scrape cancelled or timed out", false);
    try {
      const html = await tier.run();
      const hit = extractPrice(html, extract);
      if (hit) return { ...hit, method: tier.method };
      reasons.push(`${tier.method}: no price found`);
    } catch (e) {
      const err = e as Error;
      if (err instanceof HttpStatusError && BLOCKED_STATUSES.has(err.status)) blocked = true;
      reasons.push(`${tier.method}: ${err.message}`);
    }
  }
  throw new ScrapeError(reasons.join(" | ") || "No fetch method available", blocked);
}