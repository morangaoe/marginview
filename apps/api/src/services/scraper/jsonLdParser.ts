import * as cheerio from "cheerio";

export interface ParsedPrice {
  priceCents: number;
  currency: string;
  inStock: boolean | null;
  via: "json-ld" | "selector";
}

/** "1,299.00", "€ 12,50", "1.299,00" -> cents. Returns null if not a usable number. */
export function parsePriceToCents(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[^\d.,]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", "."); // European format
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const isType = (node: any, t: string) => [].concat(node?.["@type"] ?? []).some((x: string) => String(x).toLowerCase() === t);

function flatten(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node);
    if (node["@graph"]) flatten(node["@graph"], out);
  }
  return out;
}

function pickOffer(offers: any): any | null {
  const list = flatten(offers).filter((o) => o.price != null || o.lowPrice != null || o.priceSpecification);
  return list[0] ?? null;
}

export function extractFromJsonLd(html: string): ParsedPrice | null {
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let json: unknown;
    try {
      json = JSON.parse($(el).contents().text());
    } catch {
      continue; // malformed block, try next
    }
    for (const node of flatten(json)) {
      if (!isType(node, "product")) continue;
      const offer = pickOffer(node.offers);
      if (!offer) continue;
      const spec = offer.priceSpecification && flatten(offer.priceSpecification)[0];
      const cents = parsePriceToCents(offer.price ?? offer.lowPrice ?? spec?.price);
      if (!cents) continue;
      const avail = String(offer.availability ?? "");
      return {
        priceCents: cents,
        currency: String(offer.priceCurrency ?? spec?.priceCurrency ?? "USD").toUpperCase().slice(0, 3),
        inStock: avail ? /InStock|LimitedAvailability|PreOrder/i.test(avail) : null,
        via: "json-ld",
      };
    }
  }
  return null;
}

const SELECTORS: Array<[string, string?]> = [
  ['meta[property="product:price:amount"]', "content"],
  ['meta[property="og:price:amount"]', "content"],
  ['[itemprop="price"]', "content"],
  ['[itemprop="price"]'],
  ['[data-price]', "data-price"],
  [".price .amount"],
  [".product-price"],
  ["#priceblock_ourprice"],
  [".price"],
];

export function extractFromSelectors(html: string): ParsedPrice | null {
  const $ = cheerio.load(html);
  const currency =
    $('meta[property="product:price:currency"], meta[property="og:price:currency"], [itemprop="priceCurrency"]').first().attr("content") ?? "USD";
  for (const [sel, attr] of SELECTORS) {
    const el = $(sel).first();
    if (!el.length) continue;
    const cents = parsePriceToCents(attr ? el.attr(attr) : el.text());
    if (cents) return { priceCents: cents, currency: currency.toUpperCase().slice(0, 3), inStock: null, via: "selector" };
  }
  return null;
}

/** JSON-LD first, CSS selectors second. */
export function extractPriceFromHtml(html: string): ParsedPrice | null {
  return extractFromJsonLd(html) ?? extractFromSelectors(html);
}
