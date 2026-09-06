/**
 * WhatsApp order-confirmation reply parsing (P8). Pure — the webhook router
 * feeds it the inbound Body (or a quick-reply button id) and acts on the
 * verdict. Egyptian-Arabic colloquial variants included; anything ambiguous
 * is 'unknown' (the worker re-prompts / leaves the order pending, never
 * guesses a cancellation).
 */

export type ConfirmVerdict = "confirm" | "decline" | "unknown";

// Quick-reply button ids from the loqta_order_confirm template.
const BUTTON_CONFIRM = "confirm_yes";
const BUTTON_DECLINE = "confirm_no";

const CONFIRM_WORDS = new Set([
  "نعم", "اه", "أه", "ايوه", "أيوه", "ايوة", "أيوة", "تمام", "تأكيد", "تاكيد",
  "اكيد", "أكيد", "موافق", "ماشي", "اوك", "أوكي",
  "yes", "y", "ok", "okay", "confirm", "confirmed", "1",
]);
const DECLINE_WORDS = new Set([
  "لا", "لأ", "لاء", "الغاء", "إلغاء", "الغي", "إلغي", "رفض", "مرفوض", "كنسل",
  "no", "n", "cancel", "cancelled", "decline", "2",
]);

/** Normalize: strip tatweel, diacritics, punctuation/emoji; collapse spaces. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ـ]/g, "") // tatweel
    .replace(/[ً-ْ]/g, "") // Arabic diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // drop emoji/punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function parseConfirmReply(raw: string): ConfirmVerdict {
  const text = (raw ?? "").trim();
  if (text === BUTTON_CONFIRM) return "confirm";
  if (text === BUTTON_DECLINE) return "decline";

  const norm = normalize(text);
  if (!norm) return "unknown";

  // Whole-message exact match first (a bare "لا" / "yes").
  if (CONFIRM_WORDS.has(norm)) return "confirm";
  if (DECLINE_WORDS.has(norm)) return "decline";

  // Otherwise look at tokens — but a message containing BOTH signals is
  // ambiguous ("مش لا مش اه") and must not be auto-acted.
  const tokens = norm.split(" ");
  const hasConfirm = tokens.some((t) => CONFIRM_WORDS.has(t));
  const hasDecline = tokens.some((t) => DECLINE_WORDS.has(t));
  if (hasConfirm && !hasDecline) return "confirm";
  if (hasDecline && !hasConfirm) return "decline";
  return "unknown";
}

export type ConfirmAction = { kind: "confirm" } | { kind: "decline" } | { kind: "noop" };

/**
 * Idempotent webhook decision. We only ever act on an order still AWAITING a
 * reply (whatsapp_confirmation_status = 'sent'); anything else — already
 * confirmed/declined/no_response, or an ambiguous reply — is a no-op. This is
 * the first line against duplicate webhook delivery (the DB UPDATE guards on
 * the same 'sent' status as the second line).
 */
export function decideConfirmAction(
  verdict: ConfirmVerdict,
  confirmationStatus: string | null,
): ConfirmAction {
  if (confirmationStatus !== "sent") return { kind: "noop" };
  if (verdict === "confirm") return { kind: "confirm" };
  if (verdict === "decline") return { kind: "decline" };
  return { kind: "noop" };
}
