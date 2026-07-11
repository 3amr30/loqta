import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePrice, parseProductHtml } from "./generic";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/${name}`, import.meta.url), "utf8");

const URL_ = "https://supplier.eg/p/test";

describe("parseProductHtml - JSON-LD", () => {
  it("parses a simple Product with a single Offer", () => {
    const p = parseProductHtml(fixture("jsonld-simple.html"), URL_)!;
    expect(p.title).toBe("ساعة ذكية رياضية");
    expect(p.externalId).toBe("SW-100");
    expect(p.price).toBe(450);
    expect(p.currency).toBe("EGP");
    expect(p.stock).toBe("active");
    expect(p.images).toEqual([
      "https://cdn.supplier.eg/sw100-1.jpg",
      "https://cdn.supplier.eg/sw100-2.jpg",
    ]);
    expect(p.description).toContain("مقاومة للماء"); // html tags stripped
    expect(p.description).not.toContain("<b>");
    expect(p.variants).toEqual([]);
  });

  it("finds the Product inside an @graph wrapper (array @type, object image)", () => {
    const p = parseProductHtml(fixture("jsonld-graph.html"), URL_)!;
    expect(p.title).toBe("Wireless Earbuds Pro");
    expect(p.price).toBe(899);
    expect(p.currency).toBe("EGP"); // lowercased in fixture, normalized
    expect(p.stock).toBe("out_of_stock");
    expect(p.images).toEqual(["https://cdn.supplier.eg/we200.jpg"]);
  });

  it("expands AggregateOffer offers into variants with per-variant stock", () => {
    const p = parseProductHtml(fixture("jsonld-aggregate.html"), URL_)!;
    expect(p.variants).toHaveLength(2);
    expect(p.variants[0]).toMatchObject({
      externalId: "TS-RED-M",
      title: "أحمر / M",
      price: 1299, // "1,299.00" thousands separator handled
      stock: "active",
    });
    expect(p.variants[1]).toMatchObject({ externalId: "TS-BLU-L", stock: "out_of_stock" });
    expect(p.price).toBe(1299); // first offer's price
  });
});

describe("parseProductHtml - OpenGraph fallback", () => {
  it("falls back to og:/product: meta tags", () => {
    const p = parseProductHtml(fixture("og-only.html"), URL_)!;
    expect(p.title).toBe("مقلاة هوائية 5 لتر");
    expect(p.price).toBe(2499);
    expect(p.currency).toBe("EGP");
    expect(p.images).toHaveLength(2);
    expect(p.raw).toEqual({ via: "opengraph" });
  });
});

describe("parseProductHtml - junk", () => {
  it("returns null on non-product pages and skips malformed JSON-LD", () => {
    expect(parseProductHtml(fixture("junk.html"), URL_)).toBeNull();
  });

  it("returns null on empty html", () => {
    expect(parseProductHtml("<html></html>", URL_)).toBeNull();
  });
});

describe("parsePrice", () => {
  it("handles numbers, currency suffixes, and thousands separators", () => {
    expect(parsePrice(450)).toBe(450);
    expect(parsePrice("249.99 EGP")).toBe(249.99);
    expect(parsePrice("1,299.00")).toBe(1299);
    expect(parsePrice("EGP 75")).toBe(75);
  });

  it("rejects junk and non-positive values", () => {
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(0)).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});
