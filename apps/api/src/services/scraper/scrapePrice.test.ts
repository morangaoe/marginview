import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHtmlViaBrowser } from "./brightDataClient";
import { scrapePrice } from "./scrapePrice";

vi.mock("./brightDataClient", () => ({
  fetchHtmlViaBrowser: vi.fn(),
}));

describe("scrapePrice provider fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses Bright Data after a direct request fails", async () => {
    vi.stubEnv("SCRAPING_API_KEY", "");
    vi.stubEnv("BRIGHTDATA_WS_ENDPOINT", "wss://bright-data.example/browser");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("blocked")));
    vi.mocked(fetchHtmlViaBrowser).mockResolvedValue(
      '<meta property="product:price:amount" content="19.99"><meta property="product:price:currency" content="USD">',
    );

    const result = await scrapePrice("https://competitor.example/product");

    expect(fetchHtmlViaBrowser).toHaveBeenCalledWith("https://competitor.example/product");
    expect(result.method).toBe("bright_data_browser");
    expect(result.priceCents).toBe(1999);
  });
});
describe("scrapePrice scrapy tier", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("falls through to the Scrapy service after a blocked direct fetch", async () => {
    vi.stubEnv("SCRAPY_URL", "http://scrapy:8000");
    vi.stubEnv("SCRAPING_API_KEY", "");
    vi.stubEnv("BRIGHTDATA_WS_ENDPOINT", "");
    const html = '<meta property="product:price:amount" content="42.50"><meta property="product:price:currency" content="USD">';
    const fetchMock = vi.fn(async (u: string) =>
      u.includes("/fetch")
        ? new Response(JSON.stringify({ status: 200, html }), { status: 200 })
        : new Response("no", { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await scrapePrice("https://competitor.example/p");

    expect(result.method).toBe("scrapy");
    expect(result.priceCents).toBe(4250);
  });
});
