import { query } from "../../lib/db";

/**
 * Order-velocity tier rotation, run at the start of every sync.tick.
 * A source product with real order activity in the window syncs hourly
 * (tier 1); when the activity dries up it drops back to tier 2. Safe to
 * demote unconditionally today because nothing else sets tiers manually
 * (fixed at import default 2). Cancelled/returned orders are not activity.
 */
export const TIER_WINDOW_DAYS = 14;

const ACTIVITY_EXISTS = `exists (
  select 1 from order_items oi
  join orders o on o.id = oi.order_id
  where oi.source_product_id = sp.id
    and o.created_at > now() - interval '${TIER_WINDOW_DAYS} days'
    and o.status not in ('cancelled','returned')
)`;

export const TIER_PROMOTE_SQL = `
  update source_products sp set sync_tier = 1
  where sp.sync_tier <> 1
    and sp.status <> 'removed'
    and ${ACTIVITY_EXISTS}
  returning sp.id`;

export const TIER_DEMOTE_SQL = `
  update source_products sp set sync_tier = 2
  where sp.sync_tier = 1
    and not ${ACTIVITY_EXISTS}
  returning sp.id`;

export async function rotateSyncTiers(): Promise<{ promoted: number; demoted: number }> {
  const promoted = await query<{ id: string }>(TIER_PROMOTE_SQL);
  const demoted = await query<{ id: string }>(TIER_DEMOTE_SQL);
  if (promoted.length || demoted.length) {
    console.log(`[sync.tiers] promoted=${promoted.length} demoted=${demoted.length}`);
  }
  return { promoted: promoted.length, demoted: demoted.length };
}
