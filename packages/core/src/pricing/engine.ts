/**
 * Loqta pricing engine — a pure, ordered pipeline of pricing steps.
 *
 * Steps run IN ORDER on top of the FX-converted supplier cost. Recommended
 * order: fx_buffer -> margin_pct -> add_fixed -> min_profit -> round_to_ending
 * (min_profit before rounding, so rounding never drops profit below the floor
 * by more than one rounding block).
 *
 * Used by:
 *  - worker  -> initial pricing at import + repricing on cost sync (auto_apply)
 *  - web     -> live "expected profit per sale" preview in the dashboard
 */

export type PricingStep =
  | { type: "fx_buffer"; pct: number }        // pad cost against EGP volatility, e.g. 5
  | { type: "margin_pct"; pct: number }       // +30 => cost * 1.30
  | { type: "add_fixed"; amount: number }     // +20 EGP flat
  | { type: "min_profit"; amount: number }    // raise price until profit >= amount
  | { type: "round_to_ending"; ending: number }; // 99 => 249, 299, 1099 ...

export interface PricingInput {
  /** Supplier cost in the supplier's currency. */
  cost: number;
  /** Supplier currency -> store currency rate. 1 when currencies match. */
  fxRate?: number;
  steps: PricingStep[];
}

export interface PricingResult {
  /** Final storefront price (store currency). */
  retail: number;
  /** Cost converted to store currency, including fx_buffer. */
  effectiveCost: number;
  /** retail - effectiveCost */
  profit: number;
  /** Human-readable trace of each step, for the dashboard preview. */
  trace: string[];
}

/** Round UP to the next price ending with `ending` (99 => 249, 299...). */
export function roundToEnding(price: number, ending: number): number {
  if (!Number.isFinite(ending) || ending < 0) return round2(price);
  const block = 10 ** String(Math.trunc(ending)).length; // 99 -> 100, 9 -> 10
  const candidate = Math.floor(price / block) * block + ending;
  return candidate >= price ? candidate : candidate + block;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeRetail(input: PricingInput): PricingResult {
  const fx = input.fxRate && input.fxRate > 0 ? input.fxRate : 1;
  let effectiveCost = input.cost * fx;
  let price = effectiveCost;
  const trace: string[] = [`cost ${round2(input.cost)} × fx ${fx} = ${round2(effectiveCost)}`];

  for (const step of input.steps) {
    switch (step.type) {
      case "fx_buffer":
        effectiveCost = effectiveCost * (1 + step.pct / 100);
        price = Math.max(price, effectiveCost);
        trace.push(`fx_buffer +${step.pct}% → cost ${round2(effectiveCost)}`);
        break;
      case "margin_pct":
        price = effectiveCost * (1 + step.pct / 100);
        trace.push(`margin +${step.pct}% → ${round2(price)}`);
        break;
      case "add_fixed":
        price += step.amount;
        trace.push(`+${step.amount} fixed → ${round2(price)}`);
        break;
      case "min_profit":
        if (price - effectiveCost < step.amount) {
          price = effectiveCost + step.amount;
          trace.push(`min_profit ${step.amount} → ${round2(price)}`);
        }
        break;
      case "round_to_ending":
        price = roundToEnding(price, step.ending);
        trace.push(`round to *${step.ending} → ${price}`);
        break;
    }
  }

  const retail = round2(price);
  return {
    retail,
    effectiveCost: round2(effectiveCost),
    profit: round2(retail - effectiveCost),
    trace,
  };
}

/** Validate steps coming from jsonb before trusting them. */
export function parsePricingSteps(raw: unknown): PricingStep[] {
  if (!Array.isArray(raw)) return [];
  const out: PricingStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const step = s as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    switch (step.type) {
      case "fx_buffer": {
        const pct = num(step.pct);
        if (pct !== null) out.push({ type: "fx_buffer", pct });
        break;
      }
      case "margin_pct": {
        const pct = num(step.pct);
        if (pct !== null) out.push({ type: "margin_pct", pct });
        break;
      }
      case "add_fixed": {
        const amount = num(step.amount);
        if (amount !== null) out.push({ type: "add_fixed", amount });
        break;
      }
      case "min_profit": {
        const amount = num(step.amount);
        if (amount !== null) out.push({ type: "min_profit", amount });
        break;
      }
      case "round_to_ending": {
        const ending = num(step.ending);
        if (ending !== null) out.push({ type: "round_to_ending", ending });
        break;
      }
    }
  }
  return out;
}
