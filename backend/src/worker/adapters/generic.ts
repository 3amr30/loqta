import * as cheerio from "cheerio";
import {
  AdapterError,
  type ScrapedProduct,
  type ScrapedVariant,
  type SourceAdapter,
  type StockStatus,
} from "@loqta/core";
import { getHtml } from "../lib/browser";

/**
 * Generic URL adapter — the workhorse for local Egyptian suppliers.
 *
 * Extraction order:
 *  1. schema.org Product JSON-LD  (WooCommerce, Shopify, Salla, Zid, most
 *     modern store builders emit this — highest fidelity)
 *  2. OpenGraph / meta tags        (og:title, product:price:amount, ...)
 *
 * Deliberately NO per-site CSS selectors here: those rot within weeks. If a
 * specific supplier matters enough, give it its own adapter.
 */
export const genericAdapter: SourceAdapter = {
  id: "generic",

  canHandle(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  },

  async fetchProduct(url: string): Promise<ScrapedProduct> {
    const html = await getHtml(url);
    const product = parseProductHtml(html, url);
    if (!product) {
      throw new AdapterError(
        "PARSE_FAILED",
        `No Product JSON-LD or OpenGraph product data found at ${url}`,
      );
    }
    return product;
  },
};

/**
 * Pure extraction core (no network) — unit-tested against saved HTML
 * fixtures in backend/tests/fixtures/.
 */
export function parseProductHtml(html: string, url: string): ScrapedProduct | null {
  const $ = cheerio.load(html);
  return extractJsonLd($, url) ?? extractOpenGraph($, url);
}

// ---------------------------------------------------------------- JSON-LD

function extractJsonLd($: cheerio.CheerioAPI, url: string): ScrapedProduct | null {
  const nodes: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text();
    if (!text.trim()) return;
    try {
      const parsed = JSON.parse(text);
      // Payload can be an object, an array, or wrapped in @graph.
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          if (Array.isArray((item as any)["@graph"])) nodes.push(...(item as any)["@graph"]);
          else nodes.push(item);
        }
      }
    } catch {
      /* malformed JSON-LD is common; skip */
    }
  });

  const product = nodes.find((n) => {
    const t = (n as any)?.["@type"];
    return t === "Product" || (Array.isArray(t) && t.includes("Product"));
  }) as any;
  if (!product) return null;

  const offers = normalizeOffers(product.offers);
  const first = offers[0];
  if (!first || first.price == null) return null;

  const variants: ScrapedVariant[] =
    offers.length > 1
      ? offers.map((o, i) => ({
          externalId: o.sku ?? String(i),
          title: o.name ?? o.sku ?? `Variant ${i + 1}`,
          options: {},
          price: o.price ?? undefined,
          stock: o.stock,
        }))
      : [];

  return {
    sourceUrl: url,
    externalId: product.sku ?? product.productID ?? undefined,
    title: String(product.name ?? "").trim() || "Untitled product",
    description: cleanText(product.description),
    images: toImageList(product.image),
    price: first.price,
    currency: (first.currency ?? "EGP").toUpperCase(),
    stock: first.stock,
    variants,
    raw: { jsonLd: product },
  };
}

function normalizeOffers(offers: unknown): Array<{
  price: number | null;
  currency?: string;
  stock: StockStatus;
  sku?: string;
  name?: string;
}> {
  if (!offers) return [];
  const list = Array.isArray(offers)
    ? offers
    : (offers as any)["@type"] === "AggregateOffer" && Array.isArray((offers as any).offers)
      ? (offers as any).offers
      : [offers];

  return list.map((o: any) => ({
    price: parsePrice(o?.price ?? o?.lowPrice),
    currency: o?.priceCurrency,
    stock: availabilityToStock(o?.availability),
    sku: o?.sku,
    name: o?.name,
  }));
}

function availabilityToStock(a: unknown): StockStatus {
  const s = String(a ?? "").toLowerCase();
  if (!s) return "active";
  if (s.includes("outofstock") || s.includes("soldout") || s.includes("discontinued")) {
    return "out_of_stock";
  }
  return "active";
}

// ------------------------------------------------------------- OpenGraph

function extractOpenGraph($: cheerio.CheerioAPI, url: string): ScrapedProduct | null {
  const meta = (prop: string) =>
    $(`meta[property="${prop}"]`).attr("content") ??
    $(`meta[name="${prop}"]`).attr("content");

  const title = meta("og:title") ?? $("title").first().text().trim();
  const priceRaw = meta("product:price:amount") ?? meta("og:price:amount");
  const price = parsePrice(priceRaw);
  if (!title || price == null) return null;

  return {
    sourceUrl: url,
    title,
    description: cleanText(meta("og:description") ?? meta("description")),
    images: $('meta[property="og:image"]')
      .map((_, el) => $(el).attr("content"))
      .get()
      .filter(Boolean) as string[],
    price,
    currency: (meta("product:price:currency") ?? meta("og:price:currency") ?? "EGP").toUpperCase(),
    stock: "active",
    variants: [],
    raw: { via: "opengraph" },
  };
}

// ---------------------------------------------------------------- utils

export function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function toImageList(image: unknown): string[] {
  if (!image) return [];
  if (typeof image === "string") return [image];
  if (Array.isArray(image)) {
    return image
      .map((i) => (typeof i === "string" ? i : (i as any)?.url))
      .filter((u): u is string => typeof u === "string");
  }
  const url = (image as any)?.url;
  return typeof url === "string" ? [url] : [];
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t || undefined;
}
