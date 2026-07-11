import { describe, expect, it } from "vitest";
import { decideSyncActions, type SyncPolicy } from "./sync-policy";

const NO_CHANGE = { priceChanged: false, wentOutOfStock: false, backInStock: false };
const POLICIES: SyncPolicy[] = ["pause_only", "auto_apply", "require_approval"];

describe("decideSyncActions", () => {
  it("price changes ALWAYS notify, under every policy (never silent)", () => {
    for (const policy of POLICIES) {
      const a = decideSyncActions({ policy, priceMode: "rule" }, { ...NO_CHANGE, priceChanged: true });
      expect(a.notifications, policy).toContain("price_changed");
    }
  });

  it("only auto_apply + rule mode reprices", () => {
    const change = { ...NO_CHANGE, priceChanged: true };
    expect(decideSyncActions({ policy: "auto_apply", priceMode: "rule" }, change).reprice).toBe(true);
    expect(decideSyncActions({ policy: "pause_only", priceMode: "rule" }, change).reprice).toBe(false);
    expect(decideSyncActions({ policy: "require_approval", priceMode: "rule" }, change).reprice).toBe(false);
  });

  it("manual price mode is NEVER auto-repriced, even under auto_apply", () => {
    const a = decideSyncActions(
      { policy: "auto_apply", priceMode: "manual" },
      { ...NO_CHANGE, priceChanged: true },
    );
    expect(a.reprice).toBe(false);
    expect(a.notifications).toContain("price_changed"); // merchant still told
  });

  it("out-of-stock pauses under EVERY policy (the one failsafe)", () => {
    for (const policy of POLICIES) {
      const a = decideSyncActions({ policy, priceMode: "rule" }, { ...NO_CHANGE, wentOutOfStock: true });
      expect(a.pause, policy).toBe(true);
      expect(a.notifications, policy).toContain("out_of_stock");
    }
  });

  it("back-in-stock notifies but NEVER reactivates", () => {
    for (const policy of POLICIES) {
      const a = decideSyncActions({ policy, priceMode: "rule" }, { ...NO_CHANGE, backInStock: true });
      expect(a.reactivate, policy).toBe(false);
      expect(a.pause, policy).toBe(false);
      expect(a.notifications, policy).toContain("back_in_stock");
    }
  });

  it("no change means no actions", () => {
    const a = decideSyncActions({ policy: "auto_apply", priceMode: "rule" }, NO_CHANGE);
    expect(a).toEqual({ reprice: false, pause: false, reactivate: false, notifications: [] });
  });

  it("combined price-up + OOS: reprices AND pauses AND notifies both", () => {
    const a = decideSyncActions(
      { policy: "auto_apply", priceMode: "rule" },
      { priceChanged: true, wentOutOfStock: true, backInStock: false },
    );
    expect(a.reprice).toBe(true);
    expect(a.pause).toBe(true);
    expect(a.notifications).toEqual(["price_changed", "out_of_stock"]);
  });
});
