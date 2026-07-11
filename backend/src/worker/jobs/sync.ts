import type PgBoss from "pg-boss";
import {
  AdapterError,
  computeRetail,
  contentFingerprint,
  parsePricingSteps,
} from "@loqta/core";
import { resolveAdapter } from "../adapters";
import { getFxRate } from "../lib/fx";
import { notify, query, queryOne } from "../lib/db";
import { Q, type SyncProductPayload } from "../queues";

/**
 * Runs every 15 min (pg-boss schedule). Tiered frequency keeps scraping
 * cost sane: tier 1 = hourly (selling products), tier 2 = every 6h,
 * tier 3 = daily (dead listings). singletonKey dedupes overlapping ticks.
 */
export async function handleSyncTick(boss: PgBoss) {
  const batch = Number(process.env.SYNC_BATCH_SIZE ?? 25);
  const due = await query<{ id: string }>(
    `select id from source_products
     where status <> 'removed'
       and (
         (sync_tier = 1 and (last_synced_at is null or last_synced_at < now() - interval '1 hour')) or
         (sync_tier = 2 and (last_synced_at is null or last_synced_at < now() - interval '6 hours')) or
         (sync_tier = 3 and (last_synced_at is null or last_synced_at < now() - interval '24 hours'))
       )
     order by last_synced_at asc nulls first
     limit $1`,
    [batch],
  );

  for (const row of due) {
    await boss.send(Q.syncProduct, { sourceProductId: row.id } satisfies SyncProductPayload, {
      singletonKey: row.id,
      retryLimit: 3,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 300,
    });
  }
  if (due.length) console.log(`[sync.tick] queued ${due.length} products`);
}

export async function handleSyncProduct(payload: SyncProductPayload) {
  const sp = await queryOne<{
    id: string;
    source_url: string;
    price: string;
    currency: string;
    stock_status: string;
    content_hash: string | null;
  }>(
    `select id, source_url, price, currency, stock_status, content_hash
     from source_products where id = $1`,
    [payload.sourceProductId],
  );
  if (!sp) return;

  let fresh;
  try {
    fresh = await resolveAdapter(sp.source_url).fetchProduct(sp.source_url);
  } catch (err) {
    if (err instanceof AdapterError && err.code === "NOT_CONFIGURED") {
      // e.g. AliExpress before DS API approval — skip quietly, try again next tick.
      await query(`update source_products set last_synced_at = now() where id = $1`, [sp.id]);
      return;
    }
    if (err instanceof AdapterError && err.code === "NOT_FOUND") {
      await query(
        `update source_products set status = 'removed', last_synced_at = now() where id = $1`,
        [sp.id],
      );
      await recordEvent(sp.id, "error", { status: sp.stock_status }, { status: "removed" });
      await pauseListings(sp.id, "المنتج اتشال من عند المورد");
      return;
    }
    await recordEvent(sp.id, "error", null, { message: String(err).slice(0, 500) });
    throw err; // transient (BLOCKED/network) -> pg-boss retries with backoff
  }

  const newHash = contentFingerprint(fresh);
  if (newHash === sp.content_hash) {
    await query(`update source_products set last_synced_at = now() where id = $1`, [sp.id]);
    return;
  }

  const oldPrice = Number(sp.price);
  const priceChanged = Math.abs(fresh.price - oldPrice) > 0.009;
  const wentOutOfStock = sp.stock_status === "active" && fresh.stock === "out_of_stock";
  const backInStock = sp.stock_status === "out_of_stock" && fresh.stock === "active";

  await query(
    `update source_products set
       title = $2, price = $3, currency = $4, stock_status = $5::source_status,
       images = $6, content_hash = $7, status = 'active', last_synced_at = now()
     where id = $1`,
    [sp.id, fresh.title, fresh.price, fresh.currency, fresh.stock,
     JSON.stringify(fresh.images), newHash],
  );

  if (priceChanged) {
    await recordEvent(sp.id, "price_change",
      { price: oldPrice, currency: sp.currency },
      { price: fresh.price, currency: fresh.currency });
    await applyPricePolicies(sp.id, fresh.price, fresh.currency, oldPrice);
  }
  if (wentOutOfStock) {
    await recordEvent(sp.id, "stock_change", { stock: "active" }, { stock: "out_of_stock" });
    await pauseListings(sp.id, "خلص من عند المورد");
  }
  if (backInStock) {
    await recordEvent(sp.id, "stock_change", { stock: "out_of_stock" }, { stock: "active" });
    // Never auto-reactivate — the merchant decides (price may have moved too).
    await notifyAffectedStores(sp.id, "back_in_stock", "المنتج رجع متوفر عند المورد",
      "راجع السعر وفعّل المنتج من اللوحة لو حابب.");
  }
}

// ------------------------------------------------------------ policies

/**
 * Price changed at the supplier. Per store sync_policy:
 *   auto_apply       -> recompute retail from the pricing rule + notify
 *   require_approval -> notify only (nothing on the listing moves)
 *   pause_only       -> notify only
 * Silent retail changes can break a merchant's running ad campaigns, so
 * "notify" is always part of the deal.
 */
async function applyPricePolicies(
  sourceProductId: string,
  newCost: number,
  costCurrency: string,
  oldCost: number,
) {
  const listings = await query<{
    id: string; store_id: string; currency: string; retail_price: string;
    price_mode: string; sync_policy: string; steps: unknown | null;
  }>(
    `select l.id, l.store_id, l.currency, l.retail_price, l.price_mode,
            s.sync_policy, pr.steps
     from listings l
     join stores s on s.id = l.store_id
     left join pricing_rules pr
       on pr.id = coalesce(l.pricing_rule_id,
            (select id from pricing_rules where store_id = l.store_id and is_default limit 1))
     where l.source_product_id = $1 and l.status <> 'archived'`,
    [sourceProductId],
  );

  for (const l of listings) {
    const direction = newCost > oldCost ? "زاد" : "قل";
    const body = `سعر المورد ${direction}: ${oldCost} → ${newCost} ${costCurrency}`;

    if (l.sync_policy === "auto_apply" && l.price_mode === "rule") {
      const fxRate = await getFxRate(costCurrency, l.currency);
      const pricing = computeRetail({
        cost: newCost,
        fxRate,
        steps: parsePricingSteps(l.steps ?? []),
      });
      await query(
        `update listings
         set retail_price = $2, cost_snapshot = $3, fx_rate_snapshot = $4
         where id = $1`,
        [l.id, pricing.retail, pricing.effectiveCost, fxRate],
      );
      await notify(l.store_id, "price_changed", "تم تحديث سعر المنتج تلقائيًا",
        `${body} — سعر البيع الجديد: ${pricing.retail} ${l.currency}`, { listingId: l.id });
    } else {
      await notify(l.store_id, "price_changed", "سعر المورد اتغير", body, { listingId: l.id });
    }
  }
}

/** Out-of-stock is the one failsafe applied for EVERY policy. */
async function pauseListings(sourceProductId: string, reason: string) {
  const paused = await query<{ id: string; store_id: string; title_ar: string }>(
    `update listings set status = 'paused', paused_reason = $2
     where source_product_id = $1 and status = 'active'
     returning id, store_id, title_ar`,
    [sourceProductId, reason],
  );
  for (const l of paused) {
    await notify(l.store_id, "out_of_stock", "تم إيقاف منتج مؤقتًا", `${l.title_ar} — ${reason}`, {
      listingId: l.id,
    });
  }
}

async function notifyAffectedStores(
  sourceProductId: string, type: string, title: string, body: string,
) {
  const stores = await query<{ store_id: string; id: string }>(
    `select distinct store_id, id from listings where source_product_id = $1`,
    [sourceProductId],
  );
  for (const s of stores) await notify(s.store_id, type, title, body, { listingId: s.id });
}

async function recordEvent(
  sourceProductId: string, type: string, oldValue: unknown, newValue: unknown,
) {
  await query(
    `insert into sync_events (source_product_id, event_type, old_value, new_value)
     values ($1, $2::sync_event_type, $3, $4)`,
    [sourceProductId, type,
     oldValue == null ? null : JSON.stringify(oldValue),
     newValue == null ? null : JSON.stringify(newValue)],
  );
}
