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