import { z } from "zod";

/**
 * Verified-purchase review gate (PLAN-GROWTH §5). The schema cannot carry a
 * status or store/listing ids — everything sensitive is resolved server-side
 * from (order_number, phone), the two things only a real buyer holds.
 */

export const ReviewSubmitSchema = z.strictObject({
  listingSlug: z.string().min(1).max(120),
  order_number: z.string().trim().regex(/^LQ-\d{6}$/, "رقم الطلب بالشكل LQ-000000"),
  phone: z.string().regex(/^01[0-9]{9}$/, "رقم الموبايل المستخدم في الطلب"),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  name: z.string().trim().min(2).max(80),
});

export type ReviewSubmit = z.infer<typeof ReviewSubmitSchema>;

/** Row produced by the eligibility lookup (order matched by store+number+phone). */
export interface EligibilityRow {
  order_id: string;
  status: string;
  has_listing: boolean;
}

export type Eligibility =
  | { ok: true; orderId: string }
  | { ok: false; code: "NOT_A_BUYER"; message: string };

/**
 * Pure decision over the lookup result. Only a cancelled order is blocked —
 * pending/confirmed/delivered/returned buyers all genuinely bought the item.
 */
export function checkReviewEligibility(row: EligibilityRow | null): Eligibility {
  if (!row || !row.has_listing) {
    return {
      ok: false,
      code: "NOT_A_BUYER",
      message: "مش لاقيين طلب بالرقم ده على المنتج ده — راجع رقم الطلب والموبايل.",
    };
  }
  if (row.status === "cancelled") {
    return {
      ok: false,
      code: "NOT_A_BUYER",
      message: "الطلب ده ملغي — التقييم متاح للطلبات المكتملة.",
    };
  }
  return { ok: true, orderId: row.order_id };
}
