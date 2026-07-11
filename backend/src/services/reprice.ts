import { computeRetail, parsePricingSteps } from "@loqta/core";
import { getFxRate } from "../worker/lib/fx";
import { query, queryOne } from "../lib/db";

export interface RepriceResult {
  retail: number;
  effectiveCost: number;
  fxRate: number;
  fxStale: boolean;
  currency: string;
}

/**
 * THE single repricing path. Sync `auto_apply` and price-change approval
 * both call this, so the approval queue can never drift from the auto path.
 * Recomputes retail from the listing's rule (or the store default) for the
 * given supplier cost. `dryRun` computes without writing (used for the
 * proposed_retail preview on pending_price_changes).
 */
export async function repriceListing(
  listingId: string,
  newCost: number,
  costCurrency: string,
  opts: { dryRun?: boolean } = {},
): Promise<RepriceResult | null> {
  const l = await queryOne<{
    id: string;
    currency: string;
    steps: unknown | null;
  }>(
    `select l.id, l.currency, pr.steps
     from listings l
     left join pricing_rules pr
       on pr.id = coalesce(l.pricing_rule_id,
            (select id from pricing_rules where store_id = l.store_id and is_default limit 1))
     where l.id = $1`,
    [listingId],
  );
  if (!l) return null;

  const fx = await getFxRate(costCurrency, l.currency);
  const pricing = computeRetail({
    cost: newCost,
    fxRate: fx.rate,
    steps: parsePricingSteps(l.steps ?? []),
  });

  if (!opts.dryRun) {
    await query(
      `update listings
       set retail_price = $2, cost_snapshot = $3, fx_rate_snapshot = $4
       where id = $1`,
      [listingId, pricing.retail, pricing.effectiveCost, fx.rate],
    );
  }

  return {
    retail: pricing.retail,
    effectiveCost: pricing.effectiveCost,
    fxRate: fx.rate,
    fxStale: fx.stale,
    currency: l.currency,
  };
}
