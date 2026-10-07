/**
 * SerpAPI Google Shopping search.
 *
 * Google Shopping results only carry `product_link`, which is a google.com/search
 * URL, not the seller's page. Google's robots.txt disallows /search, so tracking
 * that URL can never be scraped. `url` below is therefore only set when SerpAPI
 * returns a real merchant link; otherwise use `resolveMerchantUrl(pageToken)`,
 * which asks the Immersive Product API for the seller's own product page.
 */
import { currencyFromText, parseAmount, toMinorUnits } from "./scraper/priceExtractor";
import { logger } from "../utils/log";

const log = logger("serp");
const TIMEOUT_MS = 12_000;
const ENDPOINT = "https://serpapi.com/search.json";

export interface CompetitorListing {
  title: string;
  merchant: string;
  /** Seller's own product page, or null when SerpAPI only gave a Google link. */
  url: string | null;
  /** Google Shopping page for the product. Fine for people, not for scraping. */
  googleUrl: string | null;
  /** Pass to resolveMerchantUrl to get the seller's URL when `url` is null. */
  pageToken: string | null;
  priceCents: number | null;
  currency: string;
  thumbnail: string | null;
}

export interface SearchOptions {
  limit?: number;
  /** ISO 4217 code of the caller's prices. Picks the Google country and the fallback currency. */
  currency?: string;
}

/** Google country for each currency we can target unambiguously. EUR spans many countries, so set SERPAPI_GL. */
const GL_BY_CURRENCY: Record<string, string> = {
  USD: "us", GBP: "uk", CAD: "ca", AUD: "au", NZD: "nz", INR: "in", KES: "ke", JPY: "jp", ZAR: "za", SGD: "sg", HKD: "hk", BRL: "br",
};

export function isGoogleUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return /(^|\.)google\.[a-z.]+$/.test(host) || host.endsWith(".googleusercontent.com") || host === "g.co";
  } catch {
    return false;
  }
}

function apiKey(): string {
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    log.error("SERPAPI_KEY is not set; market search is disabled");
    throw new Error("SERPAPI_KEY is not configured");
  }
  return key;
}

async function callSerp(params: Record<string, string>, label: string): Promise<any> {
  const started = Date.now();
  const qs = new URLSearchParams({ ...params, api_key: apiKey() });
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    log.error(`${label} request failed`, { engine: params.engine, error: (e as Error).message, ms: Date.now() - started });
    throw new Error(`SerpAPI request failed: ${(e as Error).message}`);
  }
  const body = (await res.json().catch(() => null)) as any;
  if (res.ok && (body === null || typeof body !== "object")) {
    log.error(`${label} returned invalid JSON`, { engine: params.engine, status: res.status });
    throw new Error("SerpAPI returned an unreadable response");
  }
  // SerpAPI reports problems in `error`, sometimes with a 200 status.
  if (!res.ok || body?.error) {
    const msg = body?.error ?? `HTTP ${res.status}`;
    // "hasn't returned any results" is an empty result, not a failure.
    if (/hasn't returned any results/i.test(String(msg))) {
      log.info(`${label} returned no results`, { engine: params.engine, q: params.q });
      return {};
    }
    log.error(`${label} failed`, { engine: params.engine, status: res.status, error: msg, ms: Date.now() - started });
    throw new Error(`SerpAPI ${res.status}: ${msg}`);
  }
  log.debug(`${label} ok`, { engine: params.engine, ms: Date.now() - started });
  return body;
}

function parsePrice(r: any, fallbackCurrency: string): { priceCents: number | null; currency: string } {
  const priceText = typeof r.price === "string" ? r.price : "";
  const currency = currencyFromText(priceText) ?? fallbackCurrency;
  const amount = typeof r.extracted_price === "number" ? r.extracted_price : parseAmount(priceText);
  return { priceCents: amount ? toMinorUnits(amount, currency) : null, currency };
}

export async function searchCompetitorListings(query: string, opts: SearchOptions | number = {}): Promise<CompetitorListing[]> {
  const { limit = 10, currency = "USD" } = typeof opts === "number" ? { limit: opts } : opts;
  const gl = process.env.SERPAPI_GL || GL_BY_CURRENCY[currency.toUpperCase()];
  const params: Record<string, string> = { engine: "google_shopping", q: query, hl: "en" };
  if (gl) params.gl = gl;

  const data = await callSerp(params, "shopping search");
  const raw: any[] = data.shopping_results ?? [];

  let dropped = 0;
  let googleOnly = 0;
  const listings = raw
    .map((r): CompetitorListing | null => {
      if (!r?.title) {
        dropped++;
        return null;
      }
      const merchantLink = typeof r.link === "string" && !isGoogleUrl(r.link) ? r.link : null;
      if (!merchantLink) googleOnly++;
      return {
        title: String(r.title),
        merchant: String(r.source ?? "Unknown seller"),
        url: merchantLink,
        googleUrl: typeof r.product_link === "string" ? r.product_link : null,
        pageToken: typeof r.immersive_product_page_token === "string" ? r.immersive_product_page_token : null,
        ...parsePrice(r, currency),
        thumbnail: r.thumbnail ?? null,
      };
    })
    .filter((x): x is CompetitorListing => x !== null);

  log.info("shopping search", {
    q: query, gl: gl ?? "default", raw: raw.length, kept: listings.length, dropped, googleOnlyLinks: googleOnly,
  });
  return listings.slice(0, limit);
}

/**
 * Turns a Google Shopping result into the seller's own product URL.
 * Prefers the store whose name matches `merchant`; otherwise the first non-Google link.
 */
export async function resolveMerchantUrl(pageToken: string, merchant?: string): Promise<string | null> {
  const data = await callSerp({ engine: "google_immersive_product", page_token: pageToken, more_stores: "true" }, "merchant lookup");
  const stores: any[] = data.product_results?.stores ?? [];
  const usable = stores.filter((s) => typeof s?.link === "string" && !isGoogleUrl(s.link));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = merchant ? norm(merchant) : "";
  const named = usable.map((s) => ({ s, name: norm(String(s.name ?? "")) })).filter((x) => x.name);
  const match =
    (wanted && named.find((x) => x.name === wanted)?.s) ||
    (wanted && named.find((x) => x.name.includes(wanted) || wanted.includes(x.name))?.s) ||
    usable[0];
  log.info("merchant lookup", {
    merchant, stores: stores.length, usable: usable.length, chosen: match ? new URL(match.link).hostname : null,
  });
  return match ? String(match.link) : null;
}

/** Maps a SerpAPI failure to an HTTP status and a message the UI can show. */
export function serpFailure(e: unknown): { status: number; message: string } {
  const msg = (e as Error)?.message ?? "";
  if (/SERPAPI_KEY/.test(msg)) return { status: 503, message: "Market search isn't configured. Set SERPAPI_KEY on the API." };
  if (/SerpAPI 401|Invalid API key/i.test(msg)) return { status: 503, message: "SerpAPI rejected the API key. Check SERPAPI_KEY." };
  if (/run out of searches|SerpAPI 429/i.test(msg)) return { status: 503, message: "The SerpAPI plan is out of searches for this month." };
  return { status: 502, message: "Market search is unavailable right now. Try again in a minute." };
}
