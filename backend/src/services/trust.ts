/**
 * Per-store customer trust decisions (P8). Pure functions over the
 * customer_order_history aggregate (counts scoped to store_id + phone).
 * No cross-store data — the merchant already owns everything here.
 */

export interface TrustHistory {
  total: number;
  confirmed: number;
  cancelled: number;
  returned: number;
}

export const EMPTY_HISTORY: TrustHistory = { total: 0, confirmed: 0, cancelled: 0, returned: 0 };

/**
 * Conditional OTP: skip it only for a phone that has genuinely bought before
 * with NO cancellations at this store. First-timers and any phone with a
 * prior cancellation must verify. Keeps friction off proven customers.
 */
export function needsOtp(h: TrustHistory): boolean {
  return h.confirmed === 0 || h.cancelled > 0;
}

/**
 * Blacklist-by-threshold (the merchant's practical block list, no parallel
 * table). `threshold` is stores.settings.block_after_cancellations: unset /
 * null / <=0 means the feature is OFF. Block once cancellations reach it.
 */
export function shouldBlock(h: TrustHistory, threshold: number | null | undefined): boolean {
  if (threshold == null || threshold <= 0) return false;
  return h.cancelled >= threshold;
}

/** Short Arabic trust note for the order detail page (merchant-facing). */
export function trustSummaryAr(h: TrustHistory): string | null {
  if (h.total === 0) return "أول طلب من الرقم ده معاك.";
  const parts: string[] = [`${h.total} طلب`];
  if (h.confirmed > 0) parts.push(`${h.confirmed} مؤكد`);
  if (h.cancelled > 0) parts.push(`${h.cancelled} ملغي`);
  if (h.returned > 0) parts.push(`${h.returned} مرتجع`);
  return parts.join(" · ");
}
