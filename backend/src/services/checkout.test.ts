import { describe, expect, it } from "vitest";
import {
  CheckoutSchema,
  computeOrder,
  type CheckoutInput,
  type ListingRow,
  type VariantRow,
} from "./checkout";

const LID = "11111111-1111-4111-8111-111111111111";
const LID2 = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";

const listing = (over: Partial<ListingRow> = {}): ListingRow => ({
  id: LID,
  status: "active",
  title_ar: "ساعة ذكية",
  retail_price: 399,
  cost_snapshot: 210,
  fx_rate_snapshot: 50,
  source_product_id: "sp1",
  source_stock: "active",
  source_status: "active",
  supplier_id: "sup1",
  ...over,
});

const variant = (over: Partial<VariantRow> = {}): VariantRow => ({
  id: VID,
  listing_id: LID,
  price: 449,
  enabled: true,
  stock: "active",
  title: "أحمر / XL",
  source_variant_id: "sv1",
  ...over,
});

const input = (items: CheckoutInput["items"]): CheckoutInput => ({
  customer: {
    name: "أحمد محمد",
    phone: "01234567890",
    governorate: "القاهرة",
    address: "١٢ شارع التحرير، الدقي",
  },
  items,
});

const store = { id: "st1", currency: "EGP", shipping_fee: 45 };

describe("CheckoutSchema (client prices are display-only)", () => {
  it("REJECTS any client-sent price field (strict objects)", () => {
    const body = {
      customer: input([]).customer,
      items: [{ listingId: LID, qty: 1, unit_price: 1 }],
    };
    expect(() => CheckoutSchema.parse(body)).toThrow();
    expect(() => CheckoutSchema.parse({ ...body, items: [{ listingId: LID, qty: 1 }], total: 1 })).toThrow();
  });

  it("rejects bad Egyptian phone numbers and qty out of bounds", () => {
    const good = { ...input([{ listingId: LID, qty: 1 }]) };
    expect(() =>
      CheckoutSchema.parse({ ...good, customer: { ...good.customer, phone: "0123456789" } }),
    ).toThrow(); // 10 digits
    expect(() => CheckoutSchema.parse(input([{ listingId: LID, qty: 0 }]))).toThrow();
    expect(() => CheckoutSchema.parse(input([{ listingId: LID, qty: 21 }]))).toThrow();
  });

  it("accepts a valid COD payload", () => {
    expect(CheckoutSchema.parse(input([{ listingId: LID, qty: 2 }])).items[0]!.qty).toBe(2);
  });
});

describe("computeOrder (server-side recomputation)", () => {
  it("prices from DB rows and adds the store shipping fee", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 2 }]), {
      listings: [listing()],
      variants: [],
      store,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotal).toBe(798);
    expect(r.shipping_fee).toBe(45);
    expect(r.total).toBe(843);
    expect(r.total_cost).toBe(420);
    expect(r.items[0]).toMatchObject({ unit_price: 399, unit_cost_snapshot: 210, fx_rate_snapshot: 50 });
  });

  it("uses the variant price when a variant is chosen", () => {
    const r = computeOrder(input([{ listingId: LID, variantId: VID, qty: 1 }]), {
      listings: [listing()],
      variants: [variant()],
      store,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items[0]!.unit_price).toBe(449);
    expect(r.items[0]!.variant_snapshot).toBe("أحمر / XL");
    expect(r.items[0]!.source_variant_id).toBe("sv1");
  });

  it("rejects paused listings", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 1 }]), {
      listings: [listing({ status: "paused" })],
      variants: [],
      store,
    });
    expect(r).toMatchObject({ ok: false, code: "LISTING_UNAVAILABLE" });
  });

  it("rejects out-of-stock source products", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 1 }]), {
      listings: [listing({ source_stock: "out_of_stock" })],
      variants: [],
      store,
    });
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
  });

  it("rejects out-of-stock variants even when the product is active", () => {
    const r = computeOrder(input([{ listingId: LID, variantId: VID, qty: 1 }]), {
      listings: [listing()],
      variants: [variant({ stock: "out_of_stock" })],
      store,
    });
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
  });

  it("rejects disabled variants and variants of other listings", () => {
    expect(
      computeOrder(input([{ listingId: LID, variantId: VID, qty: 1 }]), {
        listings: [listing()],
        variants: [variant({ enabled: false })],
        store,
      }),
    ).toMatchObject({ ok: false, code: "LISTING_UNAVAILABLE" });
    expect(
      computeOrder(input([{ listingId: LID, variantId: VID, qty: 1 }]), {
        listings: [listing()],
        variants: [variant({ listing_id: LID2 })],
        store,
      }),
    ).toMatchObject({ ok: false, code: "LISTING_UNAVAILABLE" });
  });

  it("rejects unknown listings (not in this store)", () => {
    const r = computeOrder(input([{ listingId: LID2, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
    });
    expect(r).toMatchObject({ ok: false, code: "LISTING_UNAVAILABLE" });
  });

  it("handles mixed variant/no-variant carts", () => {
    const r = computeOrder(
      input([
        { listingId: LID, qty: 1 },
        { listingId: LID, variantId: VID, qty: 2 },
      ]),
      { listings: [listing()], variants: [variant()], store },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotal).toBe(399 + 449 * 2);
    expect(r.total_cost).toBe(210 * 3);
  });

  it("removed source product is unavailable even if stock says active", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 1 }]), {
      listings: [listing({ source_status: "removed" })],
      variants: [],
      store,
    });
    expect(r).toMatchObject({ ok: false, code: "LISTING_UNAVAILABLE" });
  });
});

describe("computeOrder P9 — discounts + per-governorate shipping", () => {
  const withCode = (code: string, items: CheckoutInput["items"]): CheckoutInput => ({
    ...input(items),
    discount_code: code,
  });
  const discount = (over: Partial<import("./discount").DiscountRow> = {}) => ({
    code: "SAVE10",
    type: "percent" as const,
    value: 10,
    min_subtotal: null,
    max_uses: null,
    used_count: 0,
    expires_at: null,
    active: true,
    ...over,
  });

  it("applies a percent discount: total = subtotal − discount + shipping", () => {
    const r = computeOrder(withCode("SAVE10", [{ listingId: LID, qty: 2 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: discount(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotal).toBe(798);
    expect(r.discount_amount).toBe(79.8);
    expect(r.discount_code).toBe("SAVE10");
    expect(r.total).toBe(798 - 79.8 + 45); // 763.2
  });

  it("applies a fixed discount and never goes below the shipping fee", () => {
    const r = computeOrder(withCode("BIG", [{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: discount({ type: "fixed", value: 5000 }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.discount_amount).toBe(399); // capped at subtotal
    expect(r.total).toBe(45); // just the shipping fee
  });

  it("rejects a supplied code that does not exist (never silently ignored)", () => {
    const r = computeOrder(withCode("GHOST", [{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: null,
    });
    expect(r).toMatchObject({ ok: false, code: "DISCOUNT_INVALID" });
  });

  it("propagates discount validity failures (expired / min-subtotal)", () => {
    const expired = computeOrder(withCode("OLD", [{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: discount({ expires_at: "2000-01-01T00:00:00Z" }),
    });
    expect(expired).toMatchObject({ ok: false, code: "DISCOUNT_EXPIRED" });

    const min = computeOrder(withCode("MIN", [{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: discount({ min_subtotal: 1000 }),
    });
    expect(min).toMatchObject({ ok: false, code: "DISCOUNT_MIN_SUBTOTAL" });
  });

  it("no code => no discount, unchanged legacy total", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store,
      discount: discount(), // present but not requested via a code
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.discount_amount).toBe(0);
    expect(r.discount_code).toBeNull();
    expect(r.total).toBe(399 + 45);
  });

  it("uses the resolved per-governorate shipping fee passed by the caller", () => {
    const r = computeOrder(input([{ listingId: LID, qty: 1 }]), {
      listings: [listing()],
      variants: [],
      store: { ...store, shipping_fee: 90 }, // e.g. أسوان
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shipping_fee).toBe(90);
    expect(r.total).toBe(399 + 90);
  });

  it("still rejects any client-sent discount_amount (strict schema)", () => {
    const body = {
      ...input([{ listingId: LID, qty: 1 }]),
      discount_amount: 500,
    };
    expect(() => CheckoutSchema.parse(body)).toThrow();
  });

  it("accepts a discount_code on the wire (a code, never an amount)", () => {
    const parsed = CheckoutSchema.parse(withCode("SAVE10", [{ listingId: LID, qty: 1 }]));
    expect(parsed.discount_code).toBe("SAVE10");
  });
});
