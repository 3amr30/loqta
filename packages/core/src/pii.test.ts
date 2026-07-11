import { describe, expect, it } from "vitest";
import { scrubPii, scrubSentryEvent } from "./pii";

describe("scrubPii", () => {
  it("masks local Egyptian mobile numbers (01xxxxxxxxx)", () => {
    const out = scrubPii("اتصل على 01234567890 اليوم");
    expect(out).not.toContain("01234567890");
    expect(out).toContain("[phone]");
  });

  it("masks +20 international format", () => {
    expect(scrubPii("call +201112223334 now")).not.toContain("201112223334");
  });

  it("masks 20-prefixed format without plus", () => {
    expect(scrubPii("ship to 201098765432")).not.toContain("01098765432");
  });

  it("masks spaced variants", () => {
    expect(scrubPii("+2 01055556666")).not.toContain("01055556666");
  });

  it("masks emails", () => {
    expect(scrubPii("buyer buyer@example.com here")).not.toContain("buyer@example.com");
  });

  it("leaves normal Arabic text and prices alone", () => {
    expect(scrubPii("السعر 299 جنيه")).toBe("السعر 299 جنيه");
  });
});

describe("scrubSentryEvent", () => {
  it("redacts customer keys anywhere in the event", () => {
    const event = {
      extra: { customer_phone: "01234567890", customer_name: "Ahmed", orderId: "x1" },
      contexts: { order: { shipping_address: { line: "12 street" }, total: 500 } },
    };
    const out = scrubSentryEvent(event);
    expect(out.extra.customer_phone).toBe("[redacted]");
    expect(out.extra.customer_name).toBe("[redacted]");
    expect(out.extra.orderId).toBe("x1");
    expect(out.contexts.order.shipping_address).toBe("[redacted]");
    expect(out.contexts.order.total).toBe(500);
  });

  it("pattern-scrubs strings in messages and breadcrumbs", () => {
    const event = {
      message: "checkout failed for 01055556666",
      breadcrumbs: [{ message: "user typed a@b.com" }],
    };
    const out = scrubSentryEvent(event);
    expect(out.message).not.toContain("01055556666");
    expect(out.breadcrumbs[0]!.message).not.toContain("a@b.com");
  });

  it("passes through primitives and null", () => {
    expect(scrubSentryEvent(null)).toBeNull();
    expect(scrubSentryEvent(42)).toBe(42);
  });
});
