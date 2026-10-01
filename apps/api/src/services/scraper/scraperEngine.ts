import { extractPriceFromHtml, type ParsedPrice } from "./jsonLdParser";
import { fetchHtmlViaApi } from "./zenrowsClient";
import { fetchHtmlViaBrowser } from "./brightDataClient";

export interface ScrapeResult extends ParsedPrice {
  method: "api" | "browser";
}

/** Pipeline: API fetch -> JSON-LD/selectors -> (on failure) remote browser -> JSON-LD/selectors. */
export async function scrapePrice(url: string): Promise<ScrapeResult> {
  const errors: string[] = [];

  try {
    const parsed = extractPriceFromHtml(await fetchHtmlViaApi(url));
    if (parsed) return { ...parsed, method: "api" };
    errors.push("api: no price found in page");
  } catch (e) {
    errors.push(`api: ${(e as Error).message}`);
  }

  try {
    const parsed = extractPriceFromHtml(await fetchHtmlViaBrowser(url));
    if (parsed) return { ...parsed, method: "browser" };
    errors.push("browser: no price found in page");
  } catch (e) {
    errors.push(`browser: ${(e as Error).message}`);
  }

  throw new Error(errors.join(" | "));
}
