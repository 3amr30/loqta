import { describe, expect, it } from "vitest";
import { decideDispatch } from "./dispatch-notification";

describe("decideDispatch", () => {
  it("email defaults ON for new_order (the costly-to-miss case)", () => {
    expect(decideDispatch("new_order", {})).toEqual({ email: true, whatsapp: false });
  });

  it("email defaults OFF for every other type", () => {
    for (const type of ["price_approval", "import_done", "out_of_stock", "content_ready"]) {
      expect(decideDispatch(type, {}).email, type).toBe(false);
    }
  });

  it("explicit false overrides the new_order email default", () => {
    expect(decideDispatch("new_order", { email_new_order: false }).email).toBe(false);
  });

  it("whatsapp is strictly opt-in, per type", () => {
    expect(decideDispatch("new_order", {}).whatsapp).toBe(false);
    expect(decideDispatch("new_order", { whatsapp_new_order: true }).whatsapp).toBe(true);
    expect(decideDispatch("import_done", { whatsapp_new_order: true }).whatsapp).toBe(false);
  });

  it("non-boolean junk in prefs falls back to the default", () => {
    expect(decideDispatch("new_order", { email_new_order: "no" }).email).toBe(true);
    expect(decideDispatch("new_order", { whatsapp_new_order: 1 }).whatsapp).toBe(false);
  });
});
