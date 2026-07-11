/**
 * Per-URL meta injection for storefront HTML (pure — no I/O).
 *
 * WhatsApp/Facebook link unfurls are the primary sales channel in Egypt;
 * a bare SPA shell fails them. Every storefront HTML response gets
 * <title>, OpenGraph (+ product price tags), and JSON-LD Product injected
 * before </head>.
 */

export interface StoreMeta {
  name: string;
  slug: string;
  logo_url?: string | null;
  currency: string;
}

export interface ListingMeta {
  title: string;
  description?: string | null;
  image?: string | null;
  price: number;
  currency: string;
  available: boolean;
  url: string; // absolute canonical URL of the product page
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const tag = (property: string, content: string | null | undefined) =>
  content ? `<meta property="${property}" content="${escapeHtml(content)}"/>` : "";

export function injectStorefrontMeta(
  html: string,
  store: StoreMeta,
  listing?: ListingMeta,
): string {
  const title = listing ? `${listing.title} — ${store.name}` : store.name;
  const description = listing?.description?.slice(0, 200) ?? `تسوّق من ${store.name}`;
  const image = listing?.image ?? store.logo_url ?? undefined;

  const parts: string[] = [
    tag("og:site_name", store.name),
    tag("og:title", title),
    tag("og:description", description),
    tag("og:type", listing ? "product" : "website"),
    tag("og:image", image),
  ];

  if (listing) {
    parts.push(
      tag("og:url", listing.url),
      tag("product:price:amount", String(listing.price)),
      tag("product:price:currency", listing.currency),
    );
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: listing.title,
      ...(listing.description ? { description: listing.description.slice(0, 500) } : {}),
      ...(listing.image ? { image: [listing.image] } : {}),
      offers: {
        "@type": "Offer",
        price: listing.price,
        priceCurrency: listing.currency,
        availability: listing.available
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        url: listing.url,
      },
    };
    // "</script" inside JSON would close the tag early — escape it.
    const safeJson = JSON.stringify(jsonLd).replace(/<\//g, "<\\/");
    parts.push(`<script type="application/ld+json">${safeJson}</script>`);
  }

  const block = `<!--loqta-seo-->${parts.filter(Boolean).join("")}<!--/loqta-seo-->`;

  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace("</head>", `${block}</head>`);
}
