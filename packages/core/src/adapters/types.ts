/**
 * Source adapter contract.
 *
 * Every product source (AliExpress DS API, generic JSON-LD scraper, a curated
 * local supplier's site, a future Salla/Shopify adapter...) implements this
 * interface. The import & sync jobs only ever talk to the interface, so a
 * broken source never takes the others down.
 */

export type StockStatus = "active" | "out_of_stock" | "removed" | "error";

export interface ScrapedVariant {
  externalId?: string;
  /** Display title, e.g. "أحمر / XL". */
  title: string;
  /** Normalized options, e.g. { "Color": "Red", "Size": "XL" }. */
  options: Record<string, string>;
  /** Variant price in `ScrapedProduct.currency`; undefined => product price. */
  price?: number;
  stock: StockStatus;
  imageUrl?: string;
}

export interface ScrapedProduct {
  sourceUrl: string;
  externalId?: string;
  title: string;
  description?: string;
  images: string[];
  /** Supplier price (cost) in `currency`. */
  price: number;
  /** ISO currency code, e.g. "USD", "EGP". */
  currency: string;
  stock: StockStatus;
  stockQty?: number;
  variants: ScrapedVariant[];
  /** Full raw payload for debugging / re-parsing. */
  raw?: unknown;
}

export interface SourceAdapter {
  /** Stable id stored on suppliers.type: 'aliexpress' | 'generic' | 'local'. */
  id: string;
  /** Quick URL test — first adapter that matches wins. */
  canHandle(url: string): boolean;
  /** Fetch + normalize one product. Throw AdapterError on failure. */
  fetchProduct(url: string): Promise<ScrapedProduct>;
}

export class AdapterError extends Error {
  constructor(
    public code:
      | "NOT_CONFIGURED"
      | "BLOCKED"
      | "NOT_FOUND"
      | "PARSE_FAILED"
      | "UNSUPPORTED_URL",
    message: string,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/** Cheap change-detection fingerprint (stored in source_products.content_hash). */
export function contentFingerprint(p: ScrapedProduct): string {
  const basis = JSON.stringify({
    t: p.title,
    p: p.price,
    c: p.currency,
    s: p.stock,
    v: p.variants.map((v) => [v.title, v.price ?? null, v.stock]),
  });
  // djb2 — no crypto dependency needed for a change fingerprint.
  let h = 5381;
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
