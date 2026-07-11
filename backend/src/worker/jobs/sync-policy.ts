/**
 * Pure sync-policy decisions (spec §3 invariants, in one place):
 *  - retail prices are NEVER changed silently: every price change notifies
 *  - auto_apply only ever reprices rule-priced listings (manual = merchant's)
 *  - out-of-stock pauses the listing under EVERY policy (the one failsafe)
 *  - back-in-stock NEVER auto-reactivates — merchant decides
 */

export type SyncPolicy = "pause_only" | "auto_apply" | "require_approval";
export type PriceMode = "rule" | "manual";

export interface SyncListingCtx {
  policy: SyncPolicy;
  priceMode: PriceMode;
}

export interface SyncChange {
  priceChanged: boolean;
  wentOutOfStock: boolean;
  backInStock: boolean;
}

export type SyncNotification = "price_changed" | "out_of_stock" | "back_in_stock";

export interface SyncActions {
  /** recompute retail from the pricing rule + update snapshots */
  reprice: boolean;
  /** create a pending_price_changes row for the merchant to approve/reject */
  queueApproval: boolean;
  /** set listing to paused */
  pause: boolean;
  /** never reactivate automatically - always false, kept explicit */
  reactivate: false;
  notifications: SyncNotification[];
}

export function decideSyncActions(ctx: SyncListingCtx, change: SyncChange): SyncActions {
  const notifications: SyncNotification[] = [];
  let reprice = false;
  let queueApproval = false;
  let pause = false;

  if (change.priceChanged) {
    notifications.push("price_changed"); // always - never silent
    if (ctx.priceMode === "rule") {
      if (ctx.policy === "auto_apply") reprice = true;
      // require_approval: nothing on the listing moves until the merchant
      // approves; the queue row is what the approval UI acts on.
      if (ctx.policy === "require_approval") queueApproval = true;
    }
  }
  if (change.wentOutOfStock) {
    pause = true; // every policy - selling unavailable stock is worse than pausing
    notifications.push("out_of_stock");
  }
  if (change.backInStock) {
    notifications.push("back_in_stock"); // notify only; price may have moved too
  }

  return { reprice, queueApproval, pause, reactivate: false, notifications };
}
