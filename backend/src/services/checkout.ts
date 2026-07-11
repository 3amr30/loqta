import { z } from "zod";
import { EGYPT_GOVERNORATES } from "@loqta/core";
import { getPool, notify, query } from "../lib/db";
import { AppError } from "../lib/errors";

/**
 * COD checkout. THE invariant lives here: every price is recomputed from
 * DB rows; the request schema cannot even carry a price (strictObject).
 * Client-side prices are display-only.
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
  shipping_fee: number;
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
      shipping_fee: number;
      total: number;
      total_cost: number;
    }
  | { ok: false; code: "LISTING_UNAVAILABLE" | "OUT_OF_STOCK"; message: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: request items + DB rows -> priced order or typed rejection. */
export function computeOrder(
  input: CheckoutInput,
  ctx: { listings: ListingRow[]; variants: VariantRow[]; store: StoreCtx },
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
  const shipping_fee = round2(ctx.store.shipping_fee);
  const total = round2(subtotal + shipping_fee);
  const total_cost = round2(items.reduce((s, i) => s + i.unit_cost_snapshot * i.qty, 0));
  return { ok: true, items, subtotal, shipping_fee, total, total_cost };
}

/** Load rows, compute, insert order + items in one transaction, notify. */
export async function executeCheckout(
  storeSlug: string,
  input: CheckoutInput,
): Promise<{ orderNumber: string; total: number; shipping_fee: number; currency: string }> {
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

  const result = computeOrder(input, {
    listings,
    variants,
    store: { id: store.id, currency: store.currency, shipping_fee: Number(store.shipping_fee) },
  });
  if (!result.ok) throw new AppError(result.code, 422, result.message);

  const client = await getPool().connect();
  let orderNumber: string;
  try {
    await client.query("begin");
    const orderRes = await client.query<{ id: string; order_number: string }>(
      `insert into orders (store_id, customer_name, customer_phone, governorate,
                           shipping_address, currency, subtotal, shipping_fee, total,
                           total_cost, notes, order_number)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '')
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
    currency: store.currency,
  };
}
