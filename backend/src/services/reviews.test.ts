import { describe, expect, it } from "vitest";
import { checkReviewEligibility, ReviewSubmitSchema } from "./reviews";

describe("checkReviewEligibility", () => {
  it("accepts a matched order that contains the listing", () => {
    const r = checkReviewEligibility({ order_id: "o1", status: "delivered", has_listing: true });
    expect(r).toEqual({ ok: true, orderId: "o1" });
  });

  it("rejects when no order matched (null)", () => {
    const r = checkReviewEligibility(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_A_BUYER");
  });

  it("rejects when the order does not contain the listing", () => {
    const r = checkReviewEligibility({ order_id: "o1", status: "confirmed", has_listing: false });
    expect(r.ok).toBe(false);
  });

  it("rejects a cancelled order even if it contained the listing", () => {
    const r = checkReviewEligibility({ order_id: "o1", status: "cancelled", has_listing: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_A_BUYER");
  });

  it("allows pending/confirmed/delivered/returned buyers", () => {
    for (const status of ["pending", "confirmed", "fulfilled", "shipped", "delivered", "returned"]) {
      expect(checkReviewEligibility({ order_id: "o1", status, has_listing: true }).ok, status).toBe(true);
    }
  });
});

describe("ReviewSubmitSchema", () => {
  const base = {
    listingSlug: "dark-roast",
    order_number: "LQ-000001",
    phone: "01012345678",
    rating: 5,
    name: "أحمد",
  };
  it("accepts a valid submission", () => {
    expect(ReviewSubmitSchema.safeParse(base).success).toBe(true);
  });
  it("rejects a bad order number shape", () => {
    expect(ReviewSubmitSchema.safeParse({ ...base, order_number: "000001" }).success).toBe(false);
  });
  it("rejects rating out of 1..5", () => {
    expect(ReviewSubmitSchema.safeParse({ ...base, rating: 6 }).success).toBe(false);
    expect(ReviewSubmitSchema.safeParse({ ...base, rating: 0 }).success).toBe(false);
  });
  it("rejects unknown keys (no status injection)", () => {
    expect(ReviewSubmitSchema.safeParse({ ...base, status: "approved" }).success).toBe(false);
  });
  it("rejects a non-Egyptian phone", () => {
    expect(ReviewSubmitSchema.safeParse({ ...base, phone: "12345" }).success).toBe(false);
  });
});
