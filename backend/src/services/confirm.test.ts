import { describe, expect, it } from "vitest";
import { parseConfirmReply } from "./confirm";

describe("parseConfirmReply", () => {
  it("maps quick-reply button ids", () => {
    expect(parseConfirmReply("confirm_yes")).toBe("confirm");
    expect(parseConfirmReply("confirm_no")).toBe("decline");
  });

  it("confirms Egyptian-Arabic yes variants", () => {
    for (const t of ["نعم", "اه", "ايوه", "تمام", "تأكيد", "اكيد", "ماشي", "أيوة ✅"]) {
      expect(parseConfirmReply(t), t).toBe("confirm");
    }
  });

  it("declines Arabic + english no variants", () => {
    for (const t of ["لا", "لأ", "إلغاء", "الغاء", "رفض", "no", "cancel", "❌ لا"]) {
      expect(parseConfirmReply(t), t).toBe("decline");
    }
  });

  it("confirms english yes/ok/1", () => {
    for (const t of ["yes", "YES", "ok", "confirm", "1"]) {
      expect(parseConfirmReply(t), t).toBe("confirm");
    }
  });

  it("returns unknown for ambiguous or unrelated text", () => {
    expect(parseConfirmReply("مش عارف")).toBe("unknown");
    expect(parseConfirmReply("اه بس لا")).toBe("unknown"); // both signals
    expect(parseConfirmReply("")).toBe("unknown");
    expect(parseConfirmReply("متى يصل الطلب؟")).toBe("unknown");
  });

  it("handles a confirm word inside a short sentence", () => {
    expect(parseConfirmReply("اه تمام اكد الطلب")).toBe("confirm");
    expect(parseConfirmReply("لا مش عايز")).toBe("decline");
  });

  it("is robust to tatweel and diacritics", () => {
    expect(parseConfirmReply("نـعـم")).toBe("confirm");
    expect(parseConfirmReply("نَعَم")).toBe("confirm");
  });
});
