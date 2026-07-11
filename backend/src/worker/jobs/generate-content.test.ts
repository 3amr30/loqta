import { describe, expect, it } from "vitest";
import { GeminiContentSchema } from "./generate-content";
import { clampDays } from "../../services/stats";

describe("GeminiContentSchema (model output is never blindly trusted)", () => {
  it("accepts a well-formed rewrite", () => {
    const out = GeminiContentSchema.parse({
      title_ar: "ساعة ذكية رياضية بشاشة لمس",
      title_en: "Sport Smart Watch",
      description_ar: "وصف عربي مقنع للمنتج بجملة كاملة.",
      seo: { meta_title: "ساعة ذكية", keywords: ["ساعة", "رياضة"] },
    });
    expect(out.title_ar).toContain("ساعة");
  });

  it("rejects output with neither Arabic title nor description", () => {
    expect(() =>
      GeminiContentSchema.parse({ title_en: "English only", seo: {} }),
    ).toThrow();
  });

  it("rejects drifted shapes (wrong types, oversized fields)", () => {
    expect(() => GeminiContentSchema.parse({ title_ar: 42 })).toThrow();
    expect(() =>
      GeminiContentSchema.parse({ title_ar: "ع".repeat(500) }),
    ).toThrow();
    expect(() =>
      GeminiContentSchema.parse({ title_ar: "عنوان جيد", seo: { keywords: "not-an-array" } }),
    ).toThrow();
  });
});

describe("clampDays", () => {
  it("clamps into [1, 90] with 30 default for junk", () => {
    expect(clampDays(30)).toBe(30);
    expect(clampDays(0)).toBe(1);
    expect(clampDays(365)).toBe(90);
    expect(clampDays(NaN)).toBe(30);
    expect(clampDays(7.9)).toBe(7);
  });
});
