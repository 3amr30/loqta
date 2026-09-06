import { describe, expect, it } from "vitest";
import { CONFIRM_TIMEOUT_SQL } from "./order-confirm";

/**
 * The timeout sweep is SQL; pin its safety invariants so an edit can't turn it
 * into an auto-canceller or make it ignore the per-store window.
 */
describe("CONFIRM_TIMEOUT_SQL", () => {
  it("only touches orders still awaiting a reply and still pending", () => {
    expect(CONFIRM_TIMEOUT_SQL).toContain("whatsapp_confirmation_status = 'sent'");
    expect(CONFIRM_TIMEOUT_SQL).toContain("o.status = 'pending'");
  });

  it("marks no_response — never cancels", () => {
    expect(CONFIRM_TIMEOUT_SQL).toContain("set whatsapp_confirmation_status = 'no_response'");
    expect(CONFIRM_TIMEOUT_SQL).not.toContain("'cancelled'");
  });

  it("uses the per-store timeout with a 6h default", () => {
    expect(CONFIRM_TIMEOUT_SQL).toContain("confirmation_timeout_hours");
    expect(CONFIRM_TIMEOUT_SQL).toContain("6");
  });
});
