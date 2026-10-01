import { chromium } from "playwright-core";

/** Fallback: remote Bright Data Scraping Browser over WebSocket (BRIGHTDATA_WS_ENDPOINT). */
export async function fetchHtmlViaBrowser(targetUrl: string): Promise<string> {
  const ws = process.env.BRIGHTDATA_WS_ENDPOINT;
  if (!ws) throw new Error("BRIGHTDATA_WS_ENDPOINT is not configured");
  const browser = await chromium.connectOverCDP(ws, { timeout: 30_000 });
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined); // best effort
    return await page.content();
  } finally {
    await browser.close().catch(() => undefined);
  }
}
