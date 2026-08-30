/**
 * Per-governorate shipping resolution (P9). Pure — checkout resolves the
 * rate rows from shipping_rates (+ the store-wide settings.shipping_fee
 * fallback) and calls this. The fee stays server-side and tamper-proof,
 * exactly like every other price component in computeOrder.
 */

export interface ShippingRate {
  governorate: string;
  fee: number;
  delivery_days: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fee for a governorate: an explicit per-governorate rate wins; otherwise the
 * store-wide default. Never negative.
 */
export function resolveShippingFee(
  governorate: string,
  rates: ShippingRate[],
  defaultFee: number,
): number {
  const match = rates.find((r) => r.governorate === governorate);
  const fee = match ? match.fee : defaultFee;
  return round2(Math.max(0, fee));
}

/** Delivery-days estimate for a governorate, or null when unset. */
export function deliveryEstimate(governorate: string, rates: ShippingRate[]): number | null {
  const match = rates.find((r) => r.governorate === governorate);
  return match && match.delivery_days != null ? match.delivery_days : null;
}
