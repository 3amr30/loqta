/**
 * PII scrubbing shared by ALL Sentry inits (dashboard, storefront, backend
 * api + worker). In a COD business the customer phone IS the identity -
 * none of it may reach Sentry. Pure TS, no runtime deps (package contract).
 */

/** Egyptian mobiles: 01xxxxxxxxx, 201xxxxxxxxx, +201xxxxxxxxx, with optional spacing. */
const EG_PHONE = /\+?\s?2?\s?01[0-9][\s-]?[0-9]{4}[\s-]?[0-9]{4}/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Keys whose values are dropped wholesale wherever they appear in an event. */
const PII_KEYS = new Set([
  "customer_name",
  "customer_phone",
  "customer_email",
  "shipping_address",
  "governorate",
  "phone",
  "email",
  "address",
]);

export function scrubPii(text: string): string {
  return text.replace(EG_PHONE, "[phone]").replace(EMAIL, "[email]");
}

/**
 * Recursively scrub a Sentry event (or any plain data): PII keys are
 * redacted, every string value is pattern-scrubbed. Same shape out.
 */
export function scrubSentryEvent<T>(event: T): T {
  return walk(event, 0) as T;
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 12) return undefined; // events are shallow; guard cycles/abuse
  if (typeof value === "string") return scrubPii(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k.toLowerCase()) ? "[redacted]" : walk(v, depth + 1);
    }
    return out;
  }
  return value;
}
