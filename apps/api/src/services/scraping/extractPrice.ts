/**
 * Price extractor: fetches a competitor page and pulls out a numeric price.
 *
 * Resolution order (TRD section 4, step 3):
 *  1. CSS selector provided by the user (most precise)
 *  2. JSON-LD schema.org/Product offers
 *  3. <meta property="product:price:amount"> (Open Graph commerce)
 *  4. <meta name="price"> or itemprop="price"
 *
 * Returns null when no price can be found with reasonable confidence.
 */

import * as cheerio from "cheerio";

export interface ExtractResult {
  priceCents: number | null;
  currency: string;
  inStock: boolean | null;
  rawText: string | null;
  confidence: "high" | "medium" | "low";
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "A$": "AUD",
  "C$": "CAD",
};

/**
 * Parses a price string like "$12.99", "12,99 €", "1,299" into cents.
 * Returns null when the string does not contain a recognisable number.
 */
export function parsePriceText(raw: string): { cents: number; currency: string } | null {
  const cleaned = raw.trim();

  // Detect currency symbol
  let detectedCurrency = "USD";
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (cleaned.includes(sym)) {
      detectedCurrency = code;
      break;
    }
  }

  // Strip everything that isn't a digit, comma, or period
  const digits = cleaned.replace(/[^0-9.,]/g, "");
  if (!digits) return null;

  // Handle European format (1.234,56) vs standard (1,234.56)
  let normalized: string;
  const lastComma = digits.lastIndexOf(",");
  const lastPeriod = digits.lastIndexOf(".");

  if (lastComma > lastPeriod) {
    // European: comma is decimal separator
    normalized = digits.replace(/\./g, "").replace(",", ".");
  } else {
    // Standard: period is decimal separator
    normalized = digits.replace(/,/g, "");
  }

  const value = parseFloat(normalized);
  if (isNaN(value) || value <= 0 || value > 1_000_000) return null;

  return { cents: Math.round(value * 100), currency: detectedCurrency };
}

function tryJsonLd($: cheerio.CheerioAPI): { priceCents: number; currency: string; inStock: boolean | null } | null {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const data = JSON.parse($(scripts[i]).html() || "{}");
      const items: any[] = Array.isArray(data) ? data : [data];

      for (const item of items) {
        const type = item["@type"];
        if (type !== "Product" && type !== "IndividualProduct") continue;

        const offers = item.offers || item.Offers;
        if (!offers) continue;

        const offer = Array.isArray(offers) ? offers[0] : offers;
        const priceStr = String(offer.price ?? offer.Price ?? "");
        const currency = (offer.priceCurrency || offer.PriceCurrency || "USD").toUpperCase();

        const parsed = parsePriceText(priceStr);
        if (!parsed) continue;

        const avail: string = (offer.availability || "").toLowerCase();
        const inStock = avail.includes("instock")
          ? true
          : avail.includes("outofstock")
          ? false
          : null;

        return { priceCents: parsed.cents, currency, inStock };
      }
    } catch {
      // Malformed JSON-LD — try the next script tag
    }
  }
  return null;
}

function tryMetaTags($: cheerio.CheerioAPI): { priceCents: number; currency: string } | null {
  const candidates = [
    $('meta[property="product:price:amount"]').attr("content"),
    $('meta[name="price"]').attr("content"),
    $('[itemprop="price"]').attr("content") || $('[itemprop="price"]').first().text(),
    $('meta[property="og:price:amount"]').attr("content"),
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const parsed = parsePriceText(raw);
    if (parsed) return { priceCents: parsed.cents, currency: parsed.currency };
  }
  return null;
}

function trySelector($: cheerio.CheerioAPI, selector: string): { priceCents: number; currency: string } | null {
  const el = $(selector).first();
  if (!el.length) return null;
  const text = el.attr("content") || el.text();
  const parsed = parsePriceText(text || "");
  if (!parsed) return null;
  return { priceCents: parsed.cents, currency: parsed.currency };
}

export async function extractPrice(
  url: string,
  cssSelector?: string | null
): Promise<ExtractResult> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MarginviewBot/1.0 (pricing intelligence; contact@marginview.io)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    return { priceCents: null, currency: "USD", inStock: null, rawText: null, confidence: "low" };
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // 1. CSS selector (user-supplied — highest trust)
  if (cssSelector) {
    const result = trySelector($, cssSelector);
    if (result) {
      return {
        priceCents: result.priceCents,
        currency: result.currency,
        inStock: null,
        rawText: $(cssSelector).first().text().trim(),
        confidence: "high",
      };
    }
  }

  // 2. JSON-LD schema.org
  const ld = tryJsonLd($);
  if (ld) {
    return {
      priceCents: ld.priceCents,
      currency: ld.currency,
      inStock: ld.inStock,
      rawText: String(ld.priceCents / 100),
      confidence: "high",
    };
  }

  // 3 & 4. Meta tags / itemprop
  const meta = tryMetaTags($);
  if (meta) {
    return {
      priceCents: meta.priceCents,
      currency: meta.currency,
      inStock: null,
      rawText: String(meta.priceCents / 100),
      confidence: "medium",
    };
  }

  return { priceCents: null, currency: "USD", inStock: null, rawText: null, confidence: "low" };
}
