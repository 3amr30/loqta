import { describe, expect, it } from "vitest";
import { injectStorefrontMeta, type ListingMeta, type StoreMeta } from "./inject";

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
});
