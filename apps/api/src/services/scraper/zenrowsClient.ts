const TIMEOUT_MS = 45_000;

/** Fetches rendered HTML through ZenRows (set SCRAPING_PROVIDER=scrapingbee to switch). */
export async function fetchHtmlViaApi(targetUrl: string): Promise<string> {
  const provider = (process.env.SCRAPING_PROVIDER ?? "zenrows").toLowerCase();
  const key = process.env.SCRAPING_API_KEY;
  if (!key) throw new Error("SCRAPING_API_KEY is not configured");

  const endpoint =
    provider === "scrapingbee"
      ? `https://app.scrapingbee.com/api/v1/?${new URLSearchParams({ api_key: key, url: targetUrl, render_js: "true", premium_proxy: "true" })}`
      : `https://api.zenrows.com/v1/?${new URLSearchParams({ apikey: key, url: targetUrl, js_render: "true", premium_proxy: "true" })}`;

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${provider} responded ${res.status}`);
  const html = await res.text();
  if (html.length < 200) throw new Error(`${provider} returned an empty page`);
  return html;
}
