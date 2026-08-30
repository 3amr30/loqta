import { describe, expect, it } from "vitest";
import { deliveryEstimate, resolveShippingFee, type ShippingRate } from "./shipping";

const rates: ShippingRate[] = [
  { governorate: "القاهرة", fee: 45, delivery_days: 2 },
  { governorate: "أسوان", fee: 90, delivery_days: 5 },
  { governorate: "الجيزة", fee: 45, delivery_days: null },
];

describe("resolveShippingFee", () => {
  it("uses the per-governorate rate when present", () => {
    expect(resolveShippingFee("القاهرة", rates, 60)).toBe(45);
    expect(resolveShippingFee("أسوان", rates, 60)).toBe(90);
  });
  it("falls back to the store default for an unlisted governorate", () => {
    expect(resolveShippingFee("مطروح", rates, 60)).toBe(60);
  });
  it("clamps negatives to 0 and rounds", () => {
    expect(resolveShippingFee("مطروح", rates, -5)).toBe(0);
    expect(resolveShippingFee("x", [{ governorate: "x", fee: 12.345, delivery_days: null }], 0)).toBe(12.35);
  });
});

describe("deliveryEstimate", () => {
  it("returns days when set, null otherwise", () => {
    expect(deliveryEstimate("أسوان", rates)).toBe(5);
    expect(deliveryEstimate("الجيزة", rates)).toBeNull(); // present but days null
    expect(deliveryEstimate("مطروح", rates)).toBeNull(); // absent
  });
});
