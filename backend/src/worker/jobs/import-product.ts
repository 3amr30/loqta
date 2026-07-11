import type PgBoss from "pg-boss";
import {
  AdapterError,
  computeRetail,
  contentFingerprint,
  parsePricingSteps,
  type ScrapedProduct,
} from "@loqta/core";
import { resolveAdapter } from "../adapters";
import { FX_STALE_NOTE, getFxRate } from "../lib/fx";
import { notify, query, queryOne } from "../../lib/db";
import { Q, type ImportProductPayload, type ProcessImagePayload } from "../queues";
import { imageStoragePath } from "./process-image";

/**
 * Sweep the import_jobs intake table (filled by the dashboard via RLS) and
 * hand each row to pg-boss, which owns retries/backoff/concurrency.
 * FOR UPDATE SKIP LOCKED makes this safe to run from multiple workers.
 */
export async function sweepImportJobs(boss: PgBoss) {
  const claimed = await query<{ id: string }>(
    `update import_jobs set status = 'processing'
     where id in (
       select id from import_jobs
       where status = 'queued'
       order by created_at
       limit 10
       for update skip locked
     )
     returning id`,
  );

  for (const row of claimed) {
    await boss.send(Q.importProduct, { importJobId: row.id } satisfies ImportProductPayload, {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
    });
  }
}

export async function handleImportProduct(payload: ImportProductPayload, boss: PgBoss) {
  const job = await queryOne<{
    id: string;
    store_id: string;
    url: string;
    supplier_id: string | null;
  }>(`select id, store_id, url, supplier_id from import_jobs where id = $1`, [
    payload.importJobId,
  ]);
  if (!job) return;

  try {
    const adapter = resolveAdapter(job.url);
    const product = await adapter.fetchProduct(job.url);

    const supplierId = job.supplier_id ?? (await ensureSupplier(adapter.id, job.url));
    const sourceProductId = await upsertSourceProduct(supplierId, product);
    const { id: listingId, fxStale, existed } = await createListing(
      job.store_id,
      sourceProductId,
      product,
    );

    await query(
      `update import_jobs
       set status = 'done', source_product_id = $2, listing_id = $3, processed_at = now()
       where id = $1`,
      [job.id, sourceProductId, listingId],
    );

    // New listings get their supplier images mirrored to Storage (stop hotlinking).
    if (!existed) {
      for (const imageUrl of product.images.slice(0, 6)) {
        await boss.send(Q.processImage, { listingId, imageUrl } satisfies ProcessImagePayload, {
          singletonKey: imageStoragePath(listingId, imageUrl),
          retryLimit: 2,
          retryDelay: 30,
          retryBackoff: true,
        });
      }
    }

    await notify(
      job.store_id,
      "import_done",
      existed ? "المنتج موجود بالفعل" : "تم استيراد المنتج",
      existed
        ? `${product.title} — المنتج ده موجود في متجرك من قبل، ما اتعملتش نسخة جديدة.`
        : product.title + (fxStale ? FX_STALE_NOTE : ""),
      { listingId, duplicate: existed },
    );
  } catch (err) {
    const message =
      err instanceof AdapterError ? `${err.code}: ${err.message}` : String(err);
    // status guard: pg-boss retries re-run this handler - the merchant gets
    // exactly ONE failure notification (first transition to 'failed').
    const marked = await queryOne<{ id: string }>(
      `update import_jobs set status = 'failed', error = $2, processed_at = now()
       where id = $1 and status <> 'failed' returning id`,
      [job.id, message.slice(0, 1000)],
    );
    if (marked) {
      await notify(job.store_id, "import_failed", "فشل استيراد المنتج", message.slice(0, 300), {
        url: job.url,
      });
    }
    throw err; // let pg-boss retry transient failures
  }
}

/** Find or create a platform supplier keyed by the URL's hostname. */
async function ensureSupplier(adapterId: string, url: string): Promise<string> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const type = adapterId === "aliexpress" ? "aliexpress" : "generic";

  const existing = await queryOne<{ id: string }>(
    `select id from suppliers where type = $1::supplier_type and website_url = $2`,
    [type, host],
  );
  if (existing) return existing.id;

  const created = await queryOne<{ id: string }>(
    `insert into suppliers (name, type, visibility, website_url)
     values ($1, $2::supplier_type, 'platform', $3)
     returning id`,
    [host, type, host],
  );
  return created!.id;
}

/** One canonical row per URL — 50 merchants importing it share this record. */
async function upsertSourceProduct(
  supplierId: string,
  p: ScrapedProduct,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `insert into source_products
       (supplier_id, source_url, external_id, title, description, images,
        price, currency, stock_status, stock_qty, raw_data, content_hash, last_synced_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::source_status, $10, $11, $12, now())
     on conflict (source_url_hash) do update set
       title = excluded.title,
       description = coalesce(excluded.description, source_products.description),
       images = excluded.images,
       price = excluded.price,
       currency = excluded.currency,
       stock_status = excluded.stock_status,
       stock_qty = excluded.stock_qty,
       raw_data = excluded.raw_data,
       content_hash = excluded.content_hash,
       last_synced_at = now(),
       status = 'active'
     returning id`,
    [
      supplierId,
      p.sourceUrl,
      p.externalId ?? null,
      p.title,
      p.description ?? null,
      JSON.stringify(p.images),
      p.price,
      p.currency,
      p.stock,
      p.stockQty ?? null,
      JSON.stringify(p.raw ?? {}),
      contentFingerprint(p),
    ],
  );
  const id = row!.id;

  // MVP variant strategy: replace. (Refine to a keyed upsert in Phase 2.)
  await query(`delete from source_variants where source_product_id = $1`, [id]);
  for (const v of p.variants) {
    await query(
      `insert into source_variants
         (source_product_id, external_id, title, options, price, stock_status, image_url)
       values ($1, $2, $3, $4, $5, $6::source_status, $7)
       on conflict (source_product_id, external_id) do nothing`,
      [id, v.externalId ?? null, v.title, JSON.stringify(v.options), v.price ?? null, v.stock, v.imageUrl ?? null],
    );
  }
  return id;
}

/** Draft listing for the requesting store, priced by its default rule. */
async function createListing(
  storeId: string,
  sourceProductId: string,
  p: ScrapedProduct,
): Promise<{ id: string; fxStale: boolean; existed: boolean }> {
  const existing = await queryOne<{ id: string }>(
    `select id from listings where store_id = $1 and source_product_id = $2`,
    [storeId, sourceProductId],
  );
  // Duplicate import: unique(store_id, source_product_id) row already exists —
  // reuse it and tell the merchant instead of pretending it's new.
  if (existing) return { id: existing.id, fxStale: false, existed: true };

  const store = await queryOne<{ currency: string }>(
    `select currency from stores where id = $1`,
    [storeId],
  );
  const rule = await queryOne<{ id: string; steps: unknown }>(
    `select id, steps from pricing_rules where store_id = $1 and is_default limit 1`,
    [storeId],
  );

  const fx = await getFxRate(p.currency, store?.currency ?? "EGP");
  const pricing = computeRetail({
    cost: p.price,
    fxRate: fx.rate,
    steps: parsePricingSteps(rule?.steps ?? []),
  });

  const slug = makeSlug(p.title);
  const row = await queryOne<{ id: string }>(
    `insert into listings
       (store_id, source_product_id, slug, title_ar, description_ar, images,
        currency, retail_price, cost_snapshot, fx_rate_snapshot,
        price_mode, pricing_rule_id, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'rule', $11, 'draft')
     returning id`,
    [
      storeId,
      sourceProductId,
      slug,
      p.title,
      p.description ?? null,
      JSON.stringify(p.images),
      store?.currency ?? "EGP",
      pricing.retail,
      pricing.effectiveCost,
      fx.rate,
      rule?.id ?? null,
    ],
  );
  return { id: row!.id, fxStale: fx.stale, existed: false };
}

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-") // keeps Arabic letters — fine in URLs
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const suffix = Math.random().toString(16).slice(2, 6);
  return base ? `${base}-${suffix}` : `product-${suffix}`;
}
