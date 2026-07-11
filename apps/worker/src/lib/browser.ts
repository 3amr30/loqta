import { chromium, type Browser } from "playwright";
import { AdapterError } from "@loqta/core";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
  browser = null;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Fetch fully-rendered HTML for a product page.
 *
 * Strategy:
 *  1. If SCRAPER_API_KEY is set -> use the scraping API (they run the proxies
 *     and the browsers; do NOT build your own rotating-proxy farm).
 *  2. Otherwise -> local Playwright. Fine for most local Egyptian supplier
 *     sites (WooCommerce/Shopify/Salla style); big marketplaces will block it.
 */
export async function getHtml(url: string): Promise<string> {
  const apiKey = process.env.SCRAPER_API_KEY;

  if (apiKey) {
    const proxied =
      `https://api.scraperapi.com/?api_key=${apiKey}` +
      `&render=true&url=${encodeURIComponent(url)}`;
    const res = await fetch(proxied, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) {
      throw new AdapterError("BLOCKED", `ScraperAPI responded ${res.status} for ${url}`);
    }
    return res.text();
  }

  const b = await getBrowser();
  const ctx = await b.newContext({ userAgent: UA, locale: "ar-EG" });
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (resp && resp.status() === 404) {
      throw new AdapterError("NOT_FOUND", `404 for ${url}`);
    }
    if (resp && (resp.status() === 403 || resp.status() === 429)) {
      throw new AdapterError(
        "BLOCKED",
        `Got ${resp.status()} for ${url} — set SCRAPER_API_KEY for blocked sites.`,
      );
    }
    // Give client-rendered stores a moment to hydrate price/JSON-LD.
    await page.waitForTimeout(1_500);
    return await page.content();
  } finally {
    await ctx.close().catch(() => {});
  }
}
