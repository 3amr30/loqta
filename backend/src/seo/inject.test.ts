import { describe, expect, it } from "vitest";
import { injectPixels, injectStorefrontMeta, type ListingMeta, type StoreMeta } from "./inject";

const HTML = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"/><title>لقطة</title></head><body><div id="root"></div></body></html>`;

const store: StoreMeta = { name: "متجر أحمد", slug: "ahmed", logo_url: null, currency: "EGP" };

const listing: ListingMeta = {
  title: "ساعة ذكية <حصرية> \"مميزة\"",
  description: "أفضل ساعة في مصر",
  image: "https://cdn.example.com/w.jpg",
  price: 1399,
  currency: "EGP",
  available: true,
  url: "https://ahmed.loqta.shop/p/smart-watch",
};

describe("injectStorefrontMeta", () => {
  it("injects product OG tags + price for product pages", () => {
    const out = injectStorefrontMeta(HTML, store, listing);
    expect(out).toContain('property="og:type" content="product"');
    expect(out).toContain('property="product:price:amount" content="1399"');
    expect(out).toContain('property="product:price:currency" content="EGP"');
    expect(out).toContain('property="og:image" content="https://cdn.example.com/w.jpg"');
    expect(out).toContain("</head>");
  });

  it("emits valid JSON-LD Product with availability", () => {
    const out = injectStorefrontMeta(HTML, store, listing);
    const m = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(out)!;
    const ld = JSON.parse(m[1]!.split("<\\/").join("</"));
    expect(ld["@type"]).toBe("Product");
    expect(ld.offers.price).toBe(1399);
    expect(ld.offers.availability).toContain("InStock");
  });

  it("escapes HTML special chars in Arabic titles", () => {
    const out = injectStorefrontMeta(HTML, store, listing);
    expect(out).toContain("&lt;حصرية&gt;");
    expect(out).toContain("&quot;مميزة&quot;");
    expect(/content="[^"]*<حصرية/.test(out)).toBe(false); // raw < never inside a meta attribute
  });

  it("replaces the <title> with listing + store name", () => {
    const out = injectStorefrontMeta(HTML, store, listing);
    expect(out).toMatch(/<title>ساعة ذكية &lt;حصرية&gt; &quot;مميزة&quot; — متجر أحمد<\/title>/);
  });

  it("falls back to store-level website tags without a listing", () => {
    const out = injectStorefrontMeta(HTML, store);
    expect(out).toContain('property="og:type" content="website"');
    expect(out).toContain("<title>متجر أحمد</title>");
    expect(out).not.toContain("product:price");
    expect(out).not.toContain("ld+json");
  });

  it("marks out-of-stock products correctly in JSON-LD", () => {
    const out = injectStorefrontMeta(HTML, store, { ...listing, available: false });
    expect(out).toContain("OutOfStock");
  });

  it("adds aggregateRating to JSON-LD only when approved reviews exist", () => {
    const withRating = injectStorefrontMeta(HTML, store, {
      ...listing,
      rating: { value: 4.5, count: 12 },
    });
    const m = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(withRating)!;
    const ld = JSON.parse(m[1]!.split("<\\/").join("</"));
    expect(ld.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 12,
    });
    // count 0 => no aggregateRating
    const noRating = injectStorefrontMeta(HTML, store, {
      ...listing,
      rating: { value: 0, count: 0 },
    });
    expect(noRating).not.toContain("aggregateRating");
  });
});

describe("injectPixels", () => {
  const HTML = `<!doctype html><html><head><title>x</title></head><body></body></html>`;

  it("injects both FB + TikTok base code with the configured ids", () => {
    const out = injectPixels(HTML, { fbPixelId: "123456789012345", tiktokPixelId: "ABCDEF1234567890" });
    expect(out).toContain("fbq('init','123456789012345')");
    expect(out).toContain("fbq('track','PageView')");
    expect(out).toContain("ttq.load('ABCDEF1234567890')");
    expect(out).toContain("</head>");
  });

  it("injects only the pixel that is present", () => {
    const out = injectPixels(HTML, { fbPixelId: "123456789012345", tiktokPixelId: null });
    expect(out).toContain("fbq('init'");
    expect(out).not.toContain("ttq.load");
  });

  it("returns the html untouched when no valid pixel is present", () => {
    expect(injectPixels(HTML, {})).toBe(HTML);
    expect(injectPixels(HTML, { fbPixelId: null, tiktokPixelId: null })).toBe(HTML);
  });

  it("drops ids that fail the strict shape (no markup smuggling)", () => {
    const out = injectPixels(HTML, {
      fbPixelId: "12345\"/><script>alert(1)</script>",
      tiktokPixelId: "abc",
    });
    expect(out).toBe(HTML);
    expect(out).not.toContain("alert(1)");
  });
});
