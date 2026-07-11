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
  /** set listing to paused */
  pause: boolean;
  /** never reactivate automatically - always false, kept explicit */
  reactivate: false;
  notifications: SyncNotification[];
}

export function decideSyncActions(ctx: SyncListingCtx, change: SyncChange): SyncActions {
  const notifications: SyncNotification[] = [];
  let reprice = false;
  let pause = false;

  if (change.priceChanged) {
    notifications.push("price_changed"); // always - never silent
    if (ctx.policy === "auto_apply" && ctx.priceMode === "rule") {
      reprice = true;
    }
  }
  if (change.wentOutOfStock) {
    pause = true; // every policy - selling unavailable stock is worse than pausing
    notifications.push("out_of_stock");
  }
  if (change.backInStock) {
    notifications.push("back_in_stock"); // notify only; price may have moved too
  }

  return { reprice, pause, reactivate: false, notifications };
}
