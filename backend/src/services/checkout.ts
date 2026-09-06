import { z } from "zod";
import { EGYPT_GOVERNORATES } from "@loqta/core";
import { getPool, notify, query } from "../lib/db";
import { AppError } from "../lib/errors";
import { computeDiscount, orderTotal, type DiscountRow } from "./discount";
import { resolveShippingFee, type ShippingRate } from "./shipping";

/**
 * COD checkout. THE invariant lives here: every price is recomputed from
 * DB rows; the request schema cannot even carry a price (strictObject).
 * Client-side prices are display-only. P9: the client may send a discount
 * CODE (never an amount) and the shipping fee is resolved per governorate —
 * both stay server-side and tamper-proof.
 */

export const CheckoutSchema = z.strictObject({
  customer: z.strictObject({
    name: z.string().trim().min(2).max(80),
    phone: z.string().regex(/^01[0-9]{9}$/, "Egyptian mobile: 01xxxxxxxxx"),
    governorate: z.enum(EGYPT_GOVERNORATES),
    address: z.string().trim().min(5).max(300),
    notes: z.string().max(500).optional(),
  }),
  items: z
    .array(
      z.strictObject({
        listingId: z.string().uuid(),
        variantId: z.string().uuid().optional(),
        qty: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(20),
  discount_code: z.string().trim().min(1).max(40).optional(),
  otpToken: z.string().max(400).optional(), // P8: consumed by the route, not here
});

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export interface ListingRow {
  id: string;
  status: string;
  title_ar: string;
  retail_price: number;
  cost_snapshot: number;
  fx_rate_snapshot: number;
  source_product_id: string;
  source_stock: string;
  source_status: string;
  supplier_id: string | null;
}

export interface VariantRow {
  id: string;
  listing_id: string;
  price: number; // effective: variant override or listing retail
  enabled: boolean;
  stock: string;
  title: string;
  source_variant_id: string;
}

export interface StoreCtx {
  id: string;
  currency: string;
  shipping_fee: number; // already resolved for the customer's governorate
}

export interface PricedItem {
  listing_id: string;
  source_product_id: string;
  source_variant_id: string | null;
  supplier_id: string | null;
  title_snapshot: string;
  variant_snapshot: string | null;
  qty: number;
  unit_price: number;
  unit_cost_snapshot: number;
  fx_rate_snapshot: number;
}

export type ComputeResult =
  | {
      ok: true;
      items: PricedItem[];
      subtotal: number;
      discount_code: string | null;
      discount_amount: number;
      shipping_fee: number;
      total: number;
      total_cost: number;
    }
  | {
      ok: false;
      code:
        | "LISTING_UNAVAILABLE"
        | "OUT_OF_STOCK"
        | "DISCOUNT_INVALID"
        | "DISCOUNT_INACTIVE"
        | "DISCOUNT_EXPIRED"
        | "DISCOUNT_EXHAUSTED"
        | "DISCOUNT_MIN_SUBTOTAL";
      message: string;
    };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pure: request items + DB rows -> priced order or typed rejection.
 * `ctx.store.shipping_fee` is the already-resolved per-governorate fee.
 * `ctx.discount` is the DB row for `input.discount_code` (or null when the
 * code doesn't exist) — the amount is computed here, never taken from the client.
 */
export function computeOrder(
  input: CheckoutInput,
  ctx: {
    listings: ListingRow[];
    variants: VariantRow[];
    store: StoreCtx;
    discount?: DiscountRow | null;
  },
): ComputeResult {
  const listingById = new Map(ctx.listings.map((l) => [l.id, l]));
  const variantById = new Map(ctx.variants.map((v) => [v.id, v]));

  const items: PricedItem[] = [];
  for (const req of input.items) {
    const l = listingById.get(req.listingId);
    if (!l || l.status !== "active" || l.source_status === "removed") {
      return { ok: false, code: "LISTING_UNAVAILABLE", message: "منتج غير متاح في المتجر" };
    }
    if (l.source_stock !== "active") {
      return { ok: false, code: "OUT_OF_STOCK", message: `${l.title_ar} نفد من المخزون` };
    }

    let unitPrice = l.retail_price;
    let variantSnapshot: string | null = null;
    let sourceVariantId: string | null = null;
    if (req.variantId) {
      const v = variantById.get(req.variantId);
      if (!v || v.listing_id !== l.id || !v.enabled) {
        return { ok: false, code: "LISTING_UNAVAILABLE", message: "الاختيار غير متاح" };
      }
      if (v.stock !== "active") {
        return { ok: false, code: "OUT_OF_STOCK", message: `${v.title} نفد من المخزون` };
      }
      unitPrice = v.price;
      variantSnapshot = v.title;
      sourceVariantId = v.source_variant_id;
    }

    items.push({
      listing_id: l.id,
      source_product_id: l.source_product_id,
      source_variant_id: sourceVariantId,
      supplier_id: l.supplier_id,
      title_snapshot: l.title_ar,
      variant_snapshot: variantSnapshot,
      qty: req.qty,
      unit_price: unitPrice,
      unit_cost_snapshot: l.cost_snapshot,
      fx_rate_snapshot: l.fx_rate_snapshot,
    });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.unit_price * i.qty, 0));

  // Discount: only when a code was supplied. A supplied-but-unknown code is a
  // hard error (never silently ignored), matching the price-tamper stance.
  let discount_amount = 0;
  let discount_code: string | null = null;
  if (input.discount_code) {
    if (!ctx.discount) {
      return { ok: false, code: "DISCOUNT_INVALID", message: "كود الخصم غير صحيح." };
    }
    const d = computeDiscount(ctx.discount, subtotal);
    if (!d.ok) return { ok: false, code: d.code, message: d.message };
    discount_amount = d.amount;
    discount_code = ctx.discount.code;
  }

  const shipping_fee = round2(ctx.store.shipping_fee);
  const total = orderTotal(subtotal, discount_amount, shipping_fee);
  const total_cost = round2(items.reduce((s, i) => s + i.unit_cost_snapshot * i.qty, 0));
  return { ok: true, items, subtotal, discount_code, discount_amount, shipping_fee, total, total_cost };
}

/** shipping_rates lookup with graceful fallback if the table isn't there yet (pre-010). */
async function resolveShipping(
  storeId: string,
  governorate: string,
  defaultFee: number,
): Promise<number> {
  try {
    const rates = await query<ShippingRate>(
      `select governorate, fee::float8 as fee, delivery_days
       from shipping_rates where store_id = $1`,
      [storeId],
    );
    return resolveShippingFee(governorate, rates, defaultFee);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return defaultFee; // table not migrated yet
    throw err;
  }
}

/** discount_codes lookup with the same graceful fallback. */
async function findDiscount(storeId: string, code: string): Promise<DiscountRow | null> {
  try {
    return await query<DiscountRow>(
      `select code, type, value::float8 as value,
              min_subtotal::float8 as min_subtotal, max_uses, used_count,
              expires_at, active
       from discount_codes where store_id = $1 and lower(code) = lower($2)`,
      [storeId, code],
    ).then((r) => r[0] ?? null);
  } catch (err) {
    if ((err as { code?: string }).code === "42P01") return null;
    throw err;
  }
}

/** Load rows, compute, insert order + items in one transaction, notify. */
export async function executeCheckout(
  storeSlug: string,
  input: CheckoutInput,
): Promise<{
  orderNumber: string;
  total: number;
  shipping_fee: number;
  discount_amount: number;
  currency: string;
}> {
  const store = await query<{ id: string; currency: string; shipping_fee: string }>(
    `select id, currency, coalesce((settings ->> 'shipping_fee')::numeric, 0) as shipping_fee
     from stores where slug = $1`,
    [storeSlug],
  ).then((r) => r[0]);
  if (!store) throw new AppError("NOT_FOUND", 404, "Store not found");

  const listingIds = input.items.map((i) => i.listingId);
  const variantIds = input.items.flatMap((i) => (i.variantId ? [i.variantId] : []));

  const listings = await query<ListingRow>(
    `select l.id, l.status, l.title_ar,
            l.retail_price::float8 as retail_price,
            l.cost_snapshot::float8 as cost_snapshot,
            l.fx_rate_snapshot::float8 as fx_rate_snapshot,
            l.source_product_id, sp.stock_status as source_stock,
            sp.status as source_status, sp.supplier_id
     from listings l join source_products sp on sp.id = l.source_product_id
     where l.store_id = $1 and l.id = any($2::uuid[])`,
    [store.id, listingIds],
  );
  const variants = variantIds.length
    ? await query<VariantRow>(
        `select lv.id, lv.listing_id,
                coalesce(lv.retail_price, l.retail_price)::float8 as price,
                lv.is_enabled as enabled, sv.stock_status as stock, sv.title,
                sv.id as source_variant_id
         from listing_variants lv
         join listings l on l.id = lv.listing_id
         join source_variants sv on sv.id = lv.source_variant_id
         where lv.id = any($1::uuid[])`,
        [variantIds],
      )
    : [];

  const shippingFee = await resolveShipping(
    store.id,
    input.customer.governorate,
    Number(store.shipping_fee),
  );
  const discount = input.discount_code
    ? await findDiscount(store.id, input.discount_code)
    : null;

  const result = computeOrder(input, {
    listings,
    variants,
    store: { id: store.id, currency: store.currency, shipping_fee: shippingFee },
    discount,
  });
  if (!result.ok) throw new AppError(result.code, 422, result.message);

  const client = await getPool().connect();
  let orderNumber: string;
  try {
    await client.query("begin");

    // Race-safe single-use enforcement: claim one use before the order lands.
    if (result.discount_code && discount) {
      const claimed = await client.query<{ id: string }>(
        `update discount_codes set used_count = used_count + 1
         where store_id = $1 and lower(code) = lower($2)
           and (max_uses is null or used_count < max_uses)
         returning id`,
        [store.id, result.discount_code],
      );
      if (claimed.rowCount === 0) {
        await client.query("rollback").catch(() => {});
        throw new AppError("DISCOUNT_EXHAUSTED", 422, "كود الخصم خلص عدد استخداماته.");
      }
    }

    const orderRes = await client.query<{ id: string; order_number: string }>(
      `insert into orders (store_id, customer_name, customer_phone, governorate,
                           shipping_address, currency, subtotal, discount_code,
                           discount_amount, shipping_fee, total, total_cost, notes, order_number)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '')
       returning id, order_number`,
      [
        store.id,
        input.customer.name,
        input.customer.phone,
        input.customer.governorate,
        JSON.stringify({
          line: input.customer.address,
          governorate: input.customer.governorate,
          notes: input.customer.notes ?? null,
        }),
        store.currency,
        result.subtotal,
        result.discount_code,
        result.discount_amount,
        result.shipping_fee,
        result.total,
        result.total_cost,
        input.customer.notes ?? null,
      ],
    );
    const order = orderRes.rows[0]!;
    for (const it of result.items) {
      await client.query(
        `insert into order_items (order_id, listing_id, source_product_id, source_variant_id,
                                  supplier_id, title_snapshot, variant_snapshot, qty,
                                  unit_price, unit_cost_snapshot, fx_rate_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          order.id,
          it.listing_id,
          it.source_product_id,
          it.source_variant_id,
          it.supplier_id,
          it.title_snapshot,
          it.variant_snapshot,
          it.qty,
          it.unit_price,
          it.unit_cost_snapshot,
          it.fx_rate_snapshot,
        ],
      );
    }
    await client.query("commit");
    orderNumber = order.order_number;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await notify(
    store.id,
    "new_order",
    "طلب جديد 🎉",
    `${orderNumber} — ${result.total} ${store.currency} (${input.customer.governorate})`,
    { orderNumber },
  );
  return {
    orderNumber,
    total: result.total,
    shipping_fee: result.shipping_fee,
    discount_amount: result.discount_amount,
    currency: store.currency,
  };
}
