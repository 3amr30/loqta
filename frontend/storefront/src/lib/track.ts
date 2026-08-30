/**
 * Thin, guarded wrappers over the FB/TikTok pixels. The base snippets +
 * PageView are injected server-side into the HTML <head> (seo/inject.ts);
 * these fire the SPA funnel events only when a pixel is actually present.
 * No pixel id lives in the bundle — we just call the globals if they exist.
 */

type Fbq = (...args: unknown[]) => void;
type Ttq = { track: (event: string, params?: Record<string, unknown>) => void };

declare global {
  interface Window {
    fbq?: Fbq;
    ttq?: Ttq;
  }
}

function fire(event: string, tiktokEvent: string, params: Record<string, unknown>) {
  try {
    window.fbq?.("track", event, params);
  } catch {
    /* pixel errors never break the store */
  }
  try {
    window.ttq?.track(tiktokEvent, params);
  } catch {
    /* ignore */
  }
}

export function trackViewContent(p: { id: string; name: string; value: number; currency: string }) {
  fire("ViewContent", "ViewContent", {
    content_ids: [p.id],
    content_name: p.name,
    value: p.value,
    currency: p.currency,
  });
}

export function trackAddToCart(p: { id: string; name: string; value: number; currency: string }) {
  fire("AddToCart", "AddToCart", {
    content_ids: [p.id],
    content_name: p.name,
    value: p.value,
    currency: p.currency,
  });
}

export function trackInitiateCheckout(p: { value: number; currency: string; numItems: number }) {
  fire("InitiateCheckout", "InitiateCheckout", {
    value: p.value,
    currency: p.currency,
    num_items: p.numItems,
  });
}

/** Purchase fires ONLY on the success page — the order already exists server-side. */
export function trackPurchase(p: { orderNumber: string; value: number; currency: string }) {
  fire("Purchase", "CompletePayment", {
    content_type: "product",
    value: p.value,
    currency: p.currency,
    order_id: p.orderNumber,
  });
}
