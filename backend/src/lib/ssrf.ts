import { AppError } from "./errors";

/**
 * SSRF guard for merchant-supplied import URLs (spec §8): the worker will
 * fetch whatever lands in import_jobs, so block internal targets here AND
 * keep the worker network-isolated (defense in depth).
 * Also enforces platform policy: no Amazon (ToS), AliExpress only through
 * the DS API adapter (which refuses to scrape).
 */

const PRIVATE_PATTERNS: RegExp[] = [
  /^localhost$/,
  /\.localhost$/,
  /\.local$/,
  /\.internal$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
];

/** amazon.* in any TLD, plus their shorteners. */
const AMAZON_PATTERN = /(^|\.)(amazon\.[a-z.]{2,10}|amzn\.to|amzn\.eu|a\.co)$/;

export function checkImportUrl(raw: string): { ok: true; url: URL } | { ok: false; code: string; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: "UNSAFE_URL", message: "Not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "UNSAFE_URL", message: "Only http/https URLs are allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (PRIVATE_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, code: "UNSAFE_URL", message: "URL resolves to a private/internal host" };
  }
  if (AMAZON_PATTERN.test(host)) {
    return { ok: false, code: "UNSUPPORTED_URL", message: "Amazon products cannot be imported" };
  }
  return { ok: true, url };
}

/** Throwing variant for route handlers. */
export function assertSafeImportUrl(raw: string): URL {
  const res = checkImportUrl(raw);
  if (!res.ok) throw new AppError(res.code, 400, res.message);
  return res.url;
}
