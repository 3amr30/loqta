/**
 * Arabic-first, user-friendly labels for order-adjacent enums. Raw enum
 * values (sent/no_response/…) never reach the merchant.
 */

export type ConfirmationStatus = "sent" | "confirmed" | "declined" | "no_response" | null;

export interface ConfirmationMeta {
  label: string;
  cls: string;
}

const CONFIRMATION: Record<string, ConfirmationMeta> = {
  sent: { label: "بانتظار رد العميل", cls: "bg-amber-50 text-amber-700" },
  confirmed: { label: "أكد العميل ✅", cls: "bg-emerald-50 text-emerald-700" },
  declined: { label: "رفض العميل ❌", cls: "bg-red-50 text-red-700" },
  no_response: { label: "لم يرد على التأكيد ⏰", cls: "bg-red-50 text-red-700" },
};

/** Meta for a WhatsApp confirmation status, or null when there is nothing to show. */
export function confirmationMeta(status: ConfirmationStatus): ConfirmationMeta | null {
  if (!status) return null;
  return CONFIRMATION[status] ?? null;
}

/** An order needs manual review when the customer declined or never replied. */
export function needsReview(status: ConfirmationStatus): boolean {
  return status === "declined" || status === "no_response";
}

export interface TrustHistory {
  total: number;
  confirmed: number;
  cancelled: number;
  returned: number;
}

/** Merchant-facing tone: risky (any cancellation) vs neutral vs first-time. */
export function trustTone(h: TrustHistory | null | undefined): "risky" | "trusted" | "new" | "neutral" {
  if (!h || h.total === 0) return "new";
  if (h.cancelled > 0 || h.returned > 0) return "risky";
  if (h.confirmed > 0) return "trusted";
  return "neutral";
}
