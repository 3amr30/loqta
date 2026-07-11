import { AdapterError, type ScrapedProduct, type SourceAdapter } from "@loqta/core";

/**
 * AliExpress adapter — built on the OFFICIAL Dropshipping (DS) API, not scraping.
 *
 * Why: AliExpress aggressively blocks scrapers, and the DS API is exactly what
 * DSers-style tools run on. Apply at https://open.aliexpress.com (create an
 * app of type "Dropshipping") — approval takes a while, so apply EARLY.
 *
 * Once approved you get an appKey/appSecret and call TOP-protocol methods:
 *   - aliexpress.ds.product.get        -> title, sku list, prices, stock, images
 *   - aliexpress.ds.order.create       -> Phase 4: one-click fulfillment
 *   - aliexpress.ds.order.tracking.get -> Phase 4: tracking numbers
 *
 * TOP requests are signed: sort params alphabetically, concatenate
 * secret + key1value1key2value2... + secret, then HMAC-MD5/SHA256 uppercase.
 * Implement `signTopRequest()` below when credentials arrive.
 */
export const aliexpressAdapter: SourceAdapter = {
  id: "aliexpress",

  canHandle(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return /(^|\.)aliexpress\.(com|us|ru)$/i.test(host);
    } catch {
      return false;
    }
  },

  async fetchProduct(url: string): Promise<ScrapedProduct> {
    const appKey = process.env.ALIEXPRESS_APP_KEY;
    const appSecret = process.env.ALIEXPRESS_APP_SECRET;

    if (!appKey || !appSecret) {
      throw new AdapterError(
        "NOT_CONFIGURED",
        "AliExpress DS API credentials missing. Apply at open.aliexpress.com, " +
          "then set ALIEXPRESS_APP_KEY / ALIEXPRESS_APP_SECRET. " +
          "(Scraping AliExpress directly is blocked and against their ToS — don't.)",
      );
    }

    const productId = extractProductId(url);
    if (!productId) {
      throw new AdapterError("UNSUPPORTED_URL", `Could not extract a product id from ${url}`);
    }

    // TODO(aliexpress): implement once credentials are approved.
    // 1. Build params for aliexpress.ds.product.get (product_id, ship_to_country=EG,
    //    target_currency=USD, target_language=AR).
    // 2. signTopRequest(params, appSecret)
    // 3. POST https://api-sg.aliexpress.com/sync
    // 4. Map ae_item_base_info + ae_item_sku_info to ScrapedProduct/ScrapedVariant.
    throw new AdapterError(
      "NOT_CONFIGURED",
      `DS API call not implemented yet (product ${productId}). See TODOs in aliexpress.ts.`,
    );
  },
};

/** Handles /item/1005001234567890.html and mobile/share URL shapes. */
export function extractProductId(url: string): string | null {
  const m =
    url.match(/\/item\/(\d{6,})\.html/) ??
    url.match(/[?&]productId=(\d{6,})/) ??
    url.match(/\/i\/(\d{6,})/);
  return m?.[1] ?? null;
}
