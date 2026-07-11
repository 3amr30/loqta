import { describe, expect, it } from "vitest";
import { ordersToCsv, type OrderCsvRow } from "./orders-csv";
import { canTransition, nextStatuses } from "./order-status";

const row: OrderCsvRow = {
  order_number: "LQ-000001",
  created_at: "2026-07-11T10:30:00Z",
  customer_name: "أحمد محمد",
  customer_phone: "01234567890",
  governorate: "القاهرة",
  items: '2x ساعة ذكية (أحمر, XL)',
  subtotal: 798,
  shipping_fee: 45,
  total: 843,
  total_cost: 420,
  status: "pending",
  tracking_number: null,
};

describe("ordersToCsv", () => {
  it("starts with a UTF-8 BOM (Excel Arabic requirement)", () => {
    expect(ordersToCsv([row]).charCodeAt(0)).toBe(0xfeff);
  });

  it("keeps Arabic intact and computes the profit column from snapshots", () => {
    const csv = ordersToCsv([row]);
    expect(csv).toContain("أحمد محمد");
    expect(csv).toContain("القاهرة");
    expect(csv).toContain("423"); // 843 - 420
  });

  it("escapes commas and quotes per RFC 4180", () => {
    const csv = ordersToCsv([
      { ...row, customer_name: 'شركة "النور", فرع مصر', items: "a,b" },
    ]);
    expect(csv).toContain('"شركة ""النور"", فرع مصر"');
    expect(csv).toContain('"a,b"');
  });

  it("emits CRLF rows with the header line first", () => {
    const lines = ordersToCsv([row]).split("\r\n");
    expect(lines[0]).toContain("رقم الطلب");
    expect(lines[1]).toContain("LQ-000001");
  });
});

describe("order status transitions", () => {
  it("allows the forward COD flow", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "fulfilled")).toBe(true);
    expect(canTransition("fulfilled", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
  });

  it("allows cancel only early, return only after delivery", () => {
    expect(canTransition("pending", "cancelled")).toBe(true);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("shipped", "cancelled")).toBe(false);
    expect(canTransition("delivered", "returned")).toBe(true);
    expect(canTransition("pending", "returned")).toBe(false);
  });

  it("blocks skips and backwards moves; terminal states are terminal", () => {
    expect(canTransition("pending", "shipped")).toBe(false);
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(nextStatuses("returned")).toEqual([]);
  });
});
