import { describe, expect, it } from "vitest";
import { computeRetail, parsePricingSteps, roundToEnding, type PricingStep } from "./engine";

describe("roundToEnding", () => {
  it("rounds up to the next 99 ending", () => {
    expect(roundToEnding(130, 99)).toBe(199);
    expect(roundToEnding(200, 99)).toBe(299);
    expect(roundToEnding(1001, 99)).toBe(1099);
  });

  it("keeps a price already on the ending", () => {
    expect(roundToEnding(199, 99)).toBe(199);
  });

  it("handles single-digit endings", () => {
    expect(roundToEnding(132, 9)).toBe(139);
  });

  it("falls back to 2-decimal rounding on invalid endings", () => {
    expect(roundToEnding(123.456, -1)).toBe(123.46);
  });
});

describe("computeRetail", () => {
  it("applies percentage margin", () => {
    const r = computeRetail({ cost: 100, steps: [{ type: "margin_pct", pct: 30 }] });
    expect(r.retail).toBe(130);
    expect(r.profit).toBe(30);
  });

  it("converts with fxRate before pricing", () => {
    const r = computeRetail({ cost: 10, fxRate: 50, steps: [{ type: "margin_pct", pct: 30 }] });
    expect(r.effectiveCost).toBe(500);
    expect(r.retail).toBe(650);
  });

  it("fx_buffer raises the cost base so profit is measured against it", () => {
    const r = computeRetail({
      cost: 100,
      steps: [
        { type: "fx_buffer", pct: 5 },
        { type: "margin_pct", pct: 30 },
      ],
    });
    expect(r.effectiveCost).toBe(105);
    expect(r.retail).toBe(136.5);
    expect(r.profit).toBe(31.5);
  });

  it("min_profit lifts the price to the floor", () => {
    const r = computeRetail({
      cost: 100,
      steps: [
        { type: "margin_pct", pct: 10 },
        { type: "min_profit", amount: 50 },
      ],
    });
    expect(r.retail).toBe(150);
    expect(r.profit).toBe(50);
  });

  it("min_profit is a no-op when profit already clears the floor", () => {
    const r = computeRetail({
      cost: 100,
      steps: [
        { type: "margin_pct", pct: 100 },
        { type: "min_profit", amount: 50 },
      ],
    });
    expect(r.retail).toBe(200);
  });

  it("runs the full documented pipeline in order", () => {
    // 4 USD -> fx 50 = 200 EGP; +5% buffer = 210; +30% margin = 273;
    // +20 fixed = 293; min_profit 100 -> 310; round to *99 -> 399
    const steps: PricingStep[] = [
      { type: "fx_buffer", pct: 5 },
      { type: "margin_pct", pct: 30 },
      { type: "add_fixed", amount: 20 },
      { type: "min_profit", amount: 100 },
      { type: "round_to_ending", ending: 99 },
    ];
    const r = computeRetail({ cost: 4, fxRate: 50, steps });
    expect(r.effectiveCost).toBe(210);
    expect(r.retail).toBe(399);
    expect(r.profit).toBe(189);
    expect(r.trace.length).toBe(6); // cost line + 5 steps
  });

  it("treats zero/negative fxRate as 1", () => {
    const r = computeRetail({ cost: 100, fxRate: 0, steps: [] });
    expect(r.effectiveCost).toBe(100);
  });
});

describe("parsePricingSteps (malformed jsonb must never be trusted)", () => {
  it("keeps valid steps in order", () => {
    const steps = parsePricingSteps([
      { type: "fx_buffer", pct: 5 },
      { type: "round_to_ending", ending: 99 },
    ]);
    expect(steps).toEqual([
      { type: "fx_buffer", pct: 5 },
      { type: "round_to_ending", ending: 99 },
    ]);
  });

  it("drops steps with missing or non-numeric params", () => {
    expect(
      parsePricingSteps([{ type: "margin_pct" }, { type: "margin_pct", pct: "30" }]),
    ).toEqual([]);
  });

  it("drops NaN and Infinity", () => {
    expect(
      parsePricingSteps([
        { type: "add_fixed", amount: NaN },
        { type: "min_profit", amount: Infinity },
      ]),
    ).toEqual([]);
  });

  it("drops unknown step types and junk values", () => {
    expect(parsePricingSteps([{ type: "steal_data" }, null, "margin", 7])).toEqual([]);
  });

  it("returns [] for non-array input", () => {
    expect(parsePricingSteps({ type: "margin_pct", pct: 30 })).toEqual([]);
    expect(parsePricingSteps(null)).toEqual([]);
  });
});
