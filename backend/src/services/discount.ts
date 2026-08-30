/**
 * Discount-code validation + amount (P9). Pure. The client sends only a CODE,
 * never an amount — the amount is computed here from the DB row, as
 * untrustable as a client-supplied price already is in computeOrder. The
 * race-safe used_count increment happens in the checkout transaction; this
 * function decides validity and the money.
 */

export type DiscountType = "percent" | "fixed";

export interface DiscountRow {
  code: string;
  type: DiscountType;
  value: number;
  min_subtotal: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null; // ISO timestamp
  active: boolean;
}

export type DiscountResult =
  | { ok: true; amount: number }
  | {
      ok: false;
      code:
        | "DISCOUNT_INACTIVE"
        | "DISCOUNT_EXPIRED"
        | "DISCOUNT_EXHAUSTED"
        | "DISCOUNT_MIN_SUBTOTAL";
      message: string;
    };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Validate a discount against the current subtotal and compute the amount.
 * Order of checks is deliberate: existence/active → expiry → uses → minimum.
 * The amount can never exceed the subtotal (a fixed code bigger than the cart
 * zeroes it, never goes negative).
 */
export function computeDiscount(
  row: DiscountRow,
  subtotal: number,
  now: number = Date.now(),
): DiscountResult {
  if (!row.active) {
    return { ok: false, code: "DISCOUNT_INACTIVE", message: "كود الخصم مش مفعّل." };
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) {
    return { ok: false, code: "DISCOUNT_EXPIRED", message: "كود الخصم انتهت صلاحيته." };
  }
  if (row.max_uses != null && row.used_count >= row.max_uses) {
    return { ok: false, code: "DISCOUNT_EXHAUSTED", message: "كود الخصم خلص عدد استخداماته." };
  }
  if (row.min_subtotal != null && subtotal < row.min_subtotal) {
    return {
      ok: false,
      code: "DISCOUNT_MIN_SUBTOTAL",
      message: `الكود ده للطلبات من ${row.min_subtotal} جنيه فأكثر.`,
    };
  }

  const raw = row.type === "percent" ? (row.value / 100) * subtotal : row.value;
  const amount = round2(Math.min(Math.max(0, raw), subtotal));
  return { ok: true, amount };
}

/** Final order total after discount. total = subtotal − discount + shipping. */
export function orderTotal(subtotal: number, discountAmount: number, shippingFee: number): number {
  return round2(Math.max(0, subtotal - discountAmount) + shippingFee);
}
