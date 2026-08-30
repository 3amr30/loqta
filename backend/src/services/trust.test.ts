import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, needsOtp, shouldBlock, trustSummaryAr } from "./trust";

const h = (p: Partial<{ total: number; confirmed: number; cancelled: number; returned: number }>) => ({
  total: 0,
  confirmed: 0,
  cancelled: 0,
  returned: 0,
  ...p,
});

describe("needsOtp", () => {
  it("requires OTP for a first-time phone", () => {
    expect(needsOtp(EMPTY_HISTORY)).toBe(true);
  });
  it("skips OTP for a proven buyer with no cancellations", () => {
    expect(needsOtp(h({ total: 2, confirmed: 2 }))).toBe(false);
  });
  it("requires OTP if there is ANY cancellation, even with confirmed orders", () => {
    expect(needsOtp(h({ total: 3, confirmed: 2, cancelled: 1 }))).toBe(true);
  });
  it("requires OTP for orders that exist but none confirmed yet", () => {
    expect(needsOtp(h({ total: 1, confirmed: 0 }))).toBe(true);
  });
});

describe("shouldBlock", () => {
  it("is OFF when threshold is unset / null / <= 0", () => {
    expect(shouldBlock(h({ cancelled: 9 }), null)).toBe(false);
    expect(shouldBlock(h({ cancelled: 9 }), undefined)).toBe(false);
    expect(shouldBlock(h({ cancelled: 9 }), 0)).toBe(false);
  });
  it("blocks once cancellations reach the threshold", () => {
    expect(shouldBlock(h({ cancelled: 2 }), 3)).toBe(false);
    expect(shouldBlock(h({ cancelled: 3 }), 3)).toBe(true);
    expect(shouldBlock(h({ cancelled: 5 }), 3)).toBe(true);
  });
});

describe("trustSummaryAr", () => {
  it("flags a brand-new number", () => {
    expect(trustSummaryAr(EMPTY_HISTORY)).toContain("أول طلب");
  });
  it("summarizes counts", () => {
    const s = trustSummaryAr(h({ total: 3, confirmed: 1, cancelled: 2 }))!;
    expect(s).toContain("3 طلب");
    expect(s).toContain("2 ملغي");
  });
});
