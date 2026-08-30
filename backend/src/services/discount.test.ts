import { describe, expect, it } from "vitest";
import { computeDiscount, orderTotal, type DiscountRow } from "./discount";

const base: DiscountRow = {
  code: "SAVE",
  type: "percent",
  value: 10,
  min_subtotal: null,
  max_uses: null,
  used_count: 0,
  expires_at: null,
  active: true,
};

describe("computeDiscount", () => {
  it("computes a percent discount, rounded", () => {
    const r = computeDiscount({ ...base, type: "percent", value: 10 }, 1399);
    expect(r).toEqual({ ok: true, amount: 139.9 });
  });

  it("computes a fixed discount", () => {
    const r = computeDiscount({ ...base, type: "fixed", value: 50 }, 1399);
    expect(r).toEqual({ ok: true, amount: 50 });
  });

  it("caps a fixed discount at the subtotal (never negative total)", () => {
    const r = computeDiscount({ ...base, type: "fixed", value: 5000 }, 1399);
    expect(r).toEqual({ ok: true, amount: 1399 });
  });

  it("rejects an inactive code", () => {
    const r = computeDiscount({ ...base, active: false }, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DISCOUNT_INACTIVE");
  });

  it("rejects an expired code", () => {
    const now = Date.parse("2026-08-31T00:00:00Z");
    const r = computeDiscount({ ...base, expires_at: "2026-08-30T00:00:00Z" }, 1000, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DISCOUNT_EXPIRED");
  });

  it("accepts a code that has not yet expired", () => {
    const now = Date.parse("2026-08-31T00:00:00Z");
    const r = computeDiscount({ ...base, expires_at: "2026-09-30T00:00:00Z" }, 1000, now);
    expect(r.ok).toBe(true);
  });

  it("rejects an exhausted code", () => {
    const r = computeDiscount({ ...base, max_uses: 100, used_count: 100 }, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DISCOUNT_EXHAUSTED");
  });

  it("rejects below the minimum subtotal", () => {
    const r = computeDiscount({ ...base, min_subtotal: 500 }, 499);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DISCOUNT_MIN_SUBTOTAL");
  });

  it("accepts at exactly the minimum subtotal", () => {
    const r = computeDiscount({ ...base, min_subtotal: 500, type: "fixed", value: 50 }, 500);
    expect(r).toEqual({ ok: true, amount: 50 });
  });
});

describe("orderTotal", () => {
  it("subtracts discount then adds shipping", () => {
    expect(orderTotal(1399, 139.9, 45)).toBe(1304.1);
  });
  it("never goes below the shipping fee (discount clamps at subtotal)", () => {
    expect(orderTotal(100, 100, 45)).toBe(45);
  });
});
