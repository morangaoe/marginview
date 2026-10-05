/**
 * Single price extractor. Replaces jsonLdParser.ts and services/scraping/extractPrice.ts.
 *
 * Resolution order:
 *   1. CSS selector saved for this competitor product   -> confidence "high"
 *   2. schema.org Product offers in JSON-LD             -> "high"
 *   3. Open Graph / itemprop / common CSS classes       -> "medium"
 *
 * Money is returned in minor units (cents).
 */
import * as cheerio from "cheerio";

export type Confidence = "high" | "medium";

export interface ExtractedPrice {
  priceCents: number;
  currency: string;
  inStock: boolean | null;
  via: "selector" | "json-ld" | "dom";
  confidence: Confidence;
}

export interface ExtractOptions {
  selector?: string | null;
  defaultCurrency?: string;
}

/** Currencies with no minor unit (¥100 is stored as 100, not 10000). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

const KNOWN_ISO = new Set([
  "USD", "EUR", "GBP", "AUD", "CAD", "NZD", "HKD", "BRL", "KRW", "JPY", "INR", "KES", "CHF", "SGD", "ZAR",
]);

/** Specific prefixes must come before the bare "$", or "A$" and "C$" parse as USD. */
const SYMBOL_CURRENCY: Array<[RegExp, string]> = [
  [/\bNZ\$/, "NZD"],
  [/\bA\$|\bAU\$/, "AUD"],
  [/\bC\$|\bCA\$/, "CAD"],
  [/\bHK\$/, "HKD"],
  [/\bUS\$/, "USD"],
  [/R\$/, "BRL"],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/₹|\bRs\.?/, "INR"],
  [/₩/, "KRW"],
  [/¥/, "JPY"], // ambiguous with CNY; the page's currency meta wins when present
  [/\bKSh\b/, "KES"],
  [/\$/, "USD"],
];

export function currencyFromText(text: string): string | null {
  const iso = text.match(/\b([A-Z]{3})\b/);
  if (iso && KNOWN_ISO.has(iso[1])) return iso[1];
  for (const [re, code] of SYMBOL_CURRENCY) if (re.test(text)) return code;
  return null;
}

/** "1,299.00" -> 1299, "12,50" -> 12.5, "1.299,00" -> 1299. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency) ? Math.round(amount) : Math.round(amount * 100);
}

const isType = (node: any, t: string) =>
  [].concat(node?.["@type"] ?? []).some((x: string) => String(x).toLowerCase() === t);

function flatten(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    if (node["@graph"]) flatten(node["@graph"], out);
  }
  return out;
}

function extractJsonLd(html: string) {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let json: unknown;
    try {
      json = JSON.parse($(el).contents().text());
    } catch {
      continue;
    }
    for (const node of flatten(json)) {
      if (!isType(node, "product")) continue;
      const offers = flatten(node.offers).filter(
        (o) => o && (o.price != null || o.lowPrice != null || o.priceSpecification),
      );
      for (const offer of offers) {
        const spec = offer.priceSpecification ? flatten(offer.priceSpecification)[0] : undefined;
        const amount = parseAmount(offer.price ?? offer.lowPrice ?? spec?.price);
        if (!amount) continue;
        const avail = String(offer.availability ?? "");
        return {
          amount,
          currency: (offer.priceCurrency ?? spec?.priceCurrency ?? null) as string | null,
          inStock: avail ? /InStock|LimitedAvailability|PreOrder|OnlineOnly/i.test(avail) : null,
        };
      }
    }
  }
  return null;
}

const DOM_SELECTORS: Array<[string, string?]> = [
  ['meta[property="product:price:amount"]', "content"],
  ['meta[property="og:price:amount"]', "content"],
  ['[itemprop="price"]', "content"],
  ['[itemprop="price"]'],
  ["[data-price]", "data-price"],
  [".price .amount"],
  [".product-price"],
  ["#priceblock_ourprice"],
  [".price"],
];

function metaCurrency($: cheerio.CheerioAPI): string | null {
  const v =
    $('meta[property="product:price:currency"], meta[property="og:price:currency"]').first().attr("content") ??
    $('[itemprop="priceCurrency"]').first().attr("content");
  return v ? v.trim().toUpperCase().slice(0, 3) : null;
}

export function extractPrice(html: string, opts: ExtractOptions = {}): ExtractedPrice | null {
  const $ = cheerio.load(html);
  const fallback = (opts.defaultCurrency ?? "USD").toUpperCase().slice(0, 3);
  const pageCurrency = metaCurrency($);

  const build = (
    amount: number,
    currency: string,
    inStock: boolean | null,
    via: ExtractedPrice["via"],
    confidence: Confidence,
  ) => {
    const priceCents = toMinorUnits(amount, currency);
    return priceCents > 0 ? { priceCents, currency, inStock, via, confidence } : null;
  };

  // 1. The user's selector
  if (opts.selector) {
    const el = $(opts.selector).first();
    if (el.length) {
      const raw = el.attr("content") ?? el.attr("data-price") ?? el.text();
      const amount = parseAmount(raw);
      if (amount) {
        const hit = build(amount, pageCurrency ?? currencyFromText(raw) ?? fallback, null, "selector", "high");
        if (hit) return hit;
      }
    }
  }

  // 2. Structured data
  const ld = extractJsonLd(html);
  if (ld) {
    const hit = build(
      ld.amount,
      (ld.currency ?? pageCurrency ?? fallback).toUpperCase().slice(0, 3),
      ld.inStock,
      "json-ld",
      "high",
    );
    if (hit) return hit;
  }

  // 3. Generic markup
  for (const [sel, attr] of DOM_SELECTORS) {
    const el = $(sel).first();
    if (!el.length) continue;
    const raw = attr ? el.attr(attr) ?? "" : el.text();
    const amount = parseAmount(raw);
    if (!amount) continue;
    const hit = build(amount, pageCurrency ?? currencyFromText(raw) ?? fallback, null, "dom", "medium");
    if (hit) return hit;
  }

  return null;
}