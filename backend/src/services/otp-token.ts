import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Post-Verify checkout token (P8). After Twilio Verify confirms an OTP for a
 * phone, the backend issues this short-lived HMAC token bound to phone+store.
 * The checkout request carries it; the server re-derives and compares. No DB
 * row needed — the token is self-verifying. Pure + unit-tested.
 */

const b64url = (b: Buffer) => b.toString("base64url");

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export const OTP_TOKEN_TTL_SEC = 15 * 60;

/** payload = "<storeId>:<phone>:<expEpochSec>"; token = b64url(payload).b64url(sig) */
export function signOtpToken(
  secret: string,
  storeId: string,
  phone: string,
  opts: { ttlSec?: number; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const exp = Math.floor(now / 1000) + (opts.ttlSec ?? OTP_TOKEN_TTL_SEC);
  const payload = `${storeId}:${phone}:${exp}`;
  return `${b64url(Buffer.from(payload))}.${sign(secret, payload)}`;
}

/**
 * True only when the token is well-formed, signed with `secret`, bound to the
 * SAME store+phone, and not expired. Constant-time signature compare.
 */
export function verifyOtpToken(
  secret: string,
  token: string,
  storeId: string,
  phone: string,
  now: number = Date.now(),
): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  let payload: string;
  try {
    payload = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return false;
  }
  const givenSig = token.slice(dot + 1);
  const expectSig = sign(secret, payload);
  const a = Buffer.from(givenSig);
  const b = Buffer.from(expectSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const parts = payload.split(":");
  if (parts.length !== 3) return false;
  const [tokStore, tokPhone, expStr] = parts;
  if (tokStore !== storeId || tokPhone !== phone) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return false;
  return exp * 1000 > now;
}
