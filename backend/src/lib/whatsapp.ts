import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";

/**
 * Twilio WhatsApp — the ONE messaging integration (PLAN-GROWTH §1.1).
 * Consumers: merchant alerts (P6), order confirmation (P8), cart nudges (P9),
 * AI chatbot (P10). Senders are no-ops (null) when env is unset — features
 * flag off by presence, builds/tests never need live credentials.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_WHATSAPP_NUMBER,
  );
}

/**
 * Twilio request-signature validation (X-Twilio-Signature): HMAC-SHA1 over
 * the full URL + every POST param appended as key+value in key-sorted order,
 * base64. Pure — unit-tested. An unverified webhook would be a spoofable
 * order-confirmation endpoint, so the route rejects on false.
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  const expected = createHmac("sha1", authToken).update(data, "utf-8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** "whatsapp:+201012345678" -> "+201012345678" */
export function normalizeWaPhone(from: string): string {
  return from.replace(/^whatsapp:/, "").trim();
}

const waAddr = (phone: string) => (phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`);

interface SendResult {
  sid: string;
}

async function twilioSend(form: URLSearchParams): Promise<SendResult | null> {
  if (!isWhatsAppConfigured()) return null;
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`${TWILIO_API}/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization:
        "Basic " +
        Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`twilio send failed ${res.status}: ${text.slice(0, 300)}`); // pg-boss retries
  }
  const json = (await res.json()) as { sid: string };
  return { sid: json.sid };
}

/** Approved template message — the only kind deliverable outside Meta's 24h window. */
export async function sendTemplate(
  to: string,
  contentSid: string,
  variables: Record<string, string>,
): Promise<SendResult | null> {
  return twilioSend(
    new URLSearchParams({
      To: waAddr(to),
      From: waAddr(process.env.TWILIO_WHATSAPP_NUMBER ?? ""),
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(variables),
    }),
  );
}

/**
 * Freeform session message — valid ONLY within 24h of the customer's last
 * inbound message. Callers must check the whatsapp_messages log first.
 */
export async function sendSession(to: string, text: string): Promise<SendResult | null> {
  return twilioSend(
    new URLSearchParams({
      To: waAddr(to),
      From: waAddr(process.env.TWILIO_WHATSAPP_NUMBER ?? ""),
      Body: text,
    }),
  );
}

export interface WaLogEntry {
  storeId?: string | null;
  direction: "in" | "out";
  phone: string;
  body?: string | null;
  contentSid?: string | null;
  twilioSid?: string | null;
  orderId?: string | null;
  listingId?: string | null;
}

/** Every message in/out lands here — audit trail, 24h-session tracker, router context. */
export async function logWaMessage(e: WaLogEntry) {
  await query(
    `insert into whatsapp_messages
       (store_id, direction, phone, body, content_sid, twilio_sid, order_id, listing_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.storeId ?? null,
      e.direction,
      e.phone,
      e.body ?? null,
      e.contentSid ?? null,
      e.twilioSid ?? null,
      e.orderId ?? null,
      e.listingId ?? null,
    ],
  );
}
