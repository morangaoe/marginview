import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isGoogleUrl, resolveMerchantUrl, searchCompetitorListings } from "./serpService";

const json = (body: unknown, status = 200) =>
  vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }));

describe("serpService", () => {
  beforeEach(() => {
    vi.stubEnv("SERPAPI_KEY", "test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("never returns a Google product_link as the merchant url, and parses the currency", async () => {
    vi.stubGlobal("fetch", json({
      shopping_results: [
        { title: "Cleanser", source: "Boots", price: "£12.99", extracted_price: 12.99,
          product_link: "https://www.google.com/search?ibp=oshop&prds=1", immersive_product_page_token: "tok" },
        { title: "Cleanser 2", source: "Shop", price: "$10.00", extracted_price: 10, link: "https://shop.example/p/2" },
      ],
    }));
    const [a, b] = await searchCompetitorListings("cleanser", { currency: "GBP" });
    expect(a.url).toBeNull();
    expect(a.googleUrl).toContain("google.com");
    expect(a.pageToken).toBe("tok");
    expect(a).toMatchObject({ priceCents: 1299, currency: "GBP" });
    expect(b).toMatchObject({ url: "https://shop.example/p/2", currency: "USD", priceCents: 1000 });
    const called = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(called.searchParams.get("gl")).toBe("uk");
  });

  it("throws SerpAPI's error message, but treats 'no results' as empty", async () => {
    vi.stubGlobal("fetch", json({ error: "Invalid API key." }, 401));
    await expect(searchCompetitorListings("x")).rejects.toThrow("Invalid API key.");
    vi.stubGlobal("fetch", json({ error: "Google hasn't returned any results for this query." }));
    await expect(searchCompetitorListings("x")).resolves.toEqual([]);
  });

  it("resolves the seller's own page, preferring the matching store name", async () => {
    vi.stubGlobal("fetch", json({
      product_results: { stores: [
        { name: "Google", link: "https://www.google.com/x" },
        { name: "Walmart", link: "https://www.walmart.com/ip/1" },
        { name: "Target", link: "https://www.target.com/p/1" },
      ] },
    }));
    expect(await resolveMerchantUrl("tok", "Target")).toBe("https://www.target.com/p/1");
    expect(await resolveMerchantUrl("tok", "Unknown")).toBe("https://www.walmart.com/ip/1");
  });

  it("recognises Google hosts", () => {
    expect(isGoogleUrl("https://www.google.co.uk/shopping/product/1")).toBe(true);
    expect(isGoogleUrl("https://shop.example/google")).toBe(false);
  });
});
