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
  /** approved-review aggregate; absent or count 0 => no aggregateRating emitted */
  rating?: { value: number; count: number } | null;
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
      ...(listing.rating && listing.rating.count > 0
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: Math.round(listing.rating.value * 10) / 10,
              reviewCount: listing.rating.count,
            },
          }
        : {}),
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

// ------------------------------------------------------------ ad pixels

/** Validated at PATCH time AND re-checked here — defense in depth. Only ids
 *  matching these exact shapes are ever interpolated into the constant
 *  snippets below, so merchant settings can never smuggle markup in. */
export const FB_PIXEL_RE = /^\d{5,20}$/;
export const TIKTOK_PIXEL_RE = /^[A-Z0-9]{10,30}$/;

export interface PixelIds {
  fbPixelId?: string | null;
  tiktokPixelId?: string | null;
}

/** Standard FB/TikTok base snippets before </head>. PageView fires from the
 *  base code; SPA events come from the storefront's lib/track.ts wrappers. */
export function injectPixels(html: string, ids: PixelIds): string {
  const parts: string[] = [];

  if (ids.fbPixelId && FB_PIXEL_RE.test(ids.fbPixelId)) {
    const id = ids.fbPixelId;
    parts.push(
      `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
        `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
        `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
        `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,` +
        `document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
        `fbq('init','${id}');fbq('track','PageView');</script>` +
        `<noscript><img height="1" width="1" style="display:none" ` +
        `src="https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1"/></noscript>`,
    );
  }

  if (ids.tiktokPixelId && TIKTOK_PIXEL_RE.test(ids.tiktokPixelId)) {
    const id = ids.tiktokPixelId;
    parts.push(
      `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
        `ttq.methods=["page","track","identify","instances","debug","on","off","once",` +
        `"ready","alias","group","enableCookie","disableCookie"];` +
        `ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(` +
        `Array.prototype.slice.call(arguments,0)))}};` +
        `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
        `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)` +
        `ttq.setAndDefer(e,ttq.methods[n]);return e};` +
        `ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";` +
        `ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,` +
        `ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");` +
        `o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;` +
        `var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};` +
        `ttq.load('${id}');ttq.page();}(window,document,'ttq');</script>`,
    );
  }

  if (parts.length === 0) return html;
  return html.replace("</head>", `<!--loqta-pixels-->${parts.join("")}<!--/loqta-pixels--></head>`);
}
