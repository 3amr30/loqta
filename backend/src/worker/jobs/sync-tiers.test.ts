import { describe, expect, it } from "vitest";
import { TIER_DEMOTE_SQL, TIER_PROMOTE_SQL, TIER_WINDOW_DAYS } from "./sync-tiers";

/**
 * The rotation logic lives in SQL; these tests pin its invariants so a
 * careless edit can't silently widen or break them. Behavior is verified
 * live in the P6 phase report.
 */
describe("sync tier rotation SQL", () => {
  it("uses the 14-day activity window in both directions", () => {
    expect(TIER_WINDOW_DAYS).toBe(14);
    expect(TIER_PROMOTE_SQL).toContain(`interval '${TIER_WINDOW_DAYS} days'`);
    expect(TIER_DEMOTE_SQL).toContain(`interval '${TIER_WINDOW_DAYS} days'`);
  });

  it("cancelled/returned orders never count as activity", () => {
    expect(TIER_PROMOTE_SQL).toContain("not in ('cancelled','returned')");
    expect(TIER_DEMOTE_SQL).toContain("not in ('cancelled','returned')");
  });

  it("promotes only non-removed products, demotes only tier 1", () => {
    expect(TIER_PROMOTE_SQL).toContain("status <> 'removed'");
    expect(TIER_PROMOTE_SQL).toContain("sync_tier <> 1");
    expect(TIER_DEMOTE_SQL).toContain("sync_tier = 1");
    expect(TIER_DEMOTE_SQL).toContain("set sync_tier = 2");
  });
});
