import { describe, expect, it } from "vitest";
import { getPolicyPage, POLICY_TYPES } from "./policies";

describe("getPolicyPage", () => {
  it("returns non-empty AR defaults for every type when settings are unset", () => {
    for (const t of POLICY_TYPES) {
      const p = getPolicyPage(null, t);
      expect(p.title.length, t).toBeGreaterThan(0);
      expect(p.body.length, t).toBeGreaterThan(30);
    }
  });

  it("prefers the merchant AR override", () => {
    const p = getPolicyPage({ refund_ar: "سياستي الخاصة" }, "refund");
    expect(p.body).toBe("سياستي الخاصة");
  });

  it("ignores blank overrides and falls back to default", () => {
    const def = getPolicyPage(null, "shipping").body;
    expect(getPolicyPage({ shipping_ar: "   " }, "shipping").body).toBe(def);
  });

  it("uses _en override in en mode, AR fallback otherwise", () => {
    const s = { refund_ar: "عربي", refund_en: "English refund" };
    expect(getPolicyPage(s, "refund", "en").body).toBe("English refund");
    expect(getPolicyPage(s, "refund", "ar").body).toBe("عربي");
    // en requested but only AR present -> AR
    expect(getPolicyPage({ refund_ar: "عربي" }, "refund", "en").body).toBe("عربي");
  });
});
