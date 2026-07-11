import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { computeRetail, parsePricingSteps } from "@loqta/core";
import { query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { getFxRate } from "../../worker/lib/fx";

const ListQuerySchema = z.object({
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const UpdateListingSchema = z
  .object({
    status: z.enum(["active", "paused"]).optional(),
    title_ar: z.string().trim().min(1).max(200).optional(),
    title_en: z.string().trim().min(1).max(200).nullable().optional(),
    description_ar: z.string().max(5000).nullable().optional(),
    description_en: z.string().max(5000).nullable().optional(),
    images: z.array(z.string().url()).max(20).optional(),
    retail_price: z.number().positive().finite().optional(),
    price_mode: z.literal("rule").optional(),
  })
  .strict()
  .refine((b) => !(b.retail_price !== undefined && b.price_mode !== undefined), {
    message: "retail_price sets manual mode; it cannot be combined with price_mode: rule",
  });

const PAGE_SIZE = 20;

const LISTING_COLS = `
  l.id, l.slug, l.title_ar, l.title_en, l.description_ar, l.description_en,
  l.images, l.currency, l.retail_price::float8 as retail_price,
  l.cost_snapshot::float8 as cost_snapshot,
  (l.retail_price - l.cost_snapshot)::float8 as profit,
  l.fx_rate_snapshot::float8 as fx_rate_snapshot,
  l.price_mode, l.pricing_rule_id, l.status, l.paused_reason, l.ai_generated,
  l.created_at, l.updated_at`;

export function listingsRoutes(app: FastifyInstance) {
  app.get("/v1/listings", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuerySchema.parse(req.query);
    const where = [`l.store_id = $1`];
    const params: unknown[] = [req.store!.id];
    if (q.status) {
      params.push(q.status);
      where.push(`l.status = $${params.length}::listing_status`);
    }
    if (q.search) {
      params.push(`%${q.search}%`);
      where.push(`(l.title_ar ilike $${params.length} or l.title_en ilike $${params.length})`);
    }
    const whereSql = where.join(" and ");

    const total = await queryOne<{ count: string }>(
      `select count(*) from listings l where ${whereSql}`,
      params,
    );
    const data = await query(
      `select ${LISTING_COLS}, sp.stock_status
       from listings l join source_products sp on sp.id = l.source_product_id
       where ${whereSql}
       order by l.created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return { data, meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) } };
  });

  app.get("/v1/listings/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const listing = await queryOne(
      `select ${LISTING_COLS}
       from listings l where l.id = $1 and l.store_id = $2`,
      [id, req.store!.id],
    );
    if (!listing) throw new AppError("NOT_FOUND", 404, "Listing not found");

    const variants = await query(
      `select lv.id, lv.retail_price::float8 as retail_price, lv.is_enabled,
              sv.title, sv.options, sv.price::float8 as source_price,
              sv.stock_status, sv.image_url
       from listing_variants lv
       join source_variants sv on sv.id = lv.source_variant_id
       where lv.listing_id = $1`,
      [id],
    );
    const sourceProduct = await queryOne(
      `select sp.price::float8 as price, sp.currency, sp.stock_status, sp.last_synced_at,
              sp.source_url
       from source_products sp join listings l on l.source_product_id = sp.id
       where l.id = $1`,
      [id],
    );
    return { listing, variants, sourceProduct };
  });

  app.patch("/v1/listings/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = UpdateListingSchema.parse(req.body);

    const current = await queryOne<{ id: string; source_product_id: string; pricing_rule_id: string | null }>(
      `select id, source_product_id, pricing_rule_id from listings
       where id = $1 and store_id = $2`,
      [id, req.store!.id],
    );
    if (!current) throw new AppError("NOT_FOUND", 404, "Listing not found");

    const sets: string[] = [];
    const params: unknown[] = [id];
    const set = (sql: string, value: unknown) => {
      params.push(value);
      sets.push(sql.replace("?", `$${params.length}`));
    };

    if (body.title_ar !== undefined) set(`title_ar = ?`, body.title_ar);
    if (body.title_en !== undefined) set(`title_en = ?`, body.title_en);
    if (body.description_ar !== undefined) set(`description_ar = ?`, body.description_ar);
    if (body.description_en !== undefined) set(`description_en = ?`, body.description_en);
    if (body.images !== undefined) set(`images = ?::jsonb`, JSON.stringify(body.images));
    if (body.status !== undefined) {
      set(`status = ?::listing_status`, body.status);
      if (body.status === "active") sets.push(`paused_reason = null`);
    }
    if (body.retail_price !== undefined) {
      set(`retail_price = ?`, body.retail_price);
      sets.push(`price_mode = 'manual'`);
    }
    if (body.price_mode === "rule") {
      // Reprice from the rule against the CURRENT source cost.
      const sp = await queryOne<{ price: string; currency: string }>(
        `select price, currency from source_products where id = $1`,
        [current.source_product_id],
      );
      const rule = await queryOne<{ steps: unknown }>(
        `select steps from pricing_rules
         where id = coalesce($1::uuid, (select id from pricing_rules where store_id = $2 and is_default limit 1))`,
        [current.pricing_rule_id, req.store!.id],
      );
      const fx = await getFxRate(sp!.currency, req.store!.currency);
      const pricing = computeRetail({
        cost: Number(sp!.price),
        fxRate: fx.rate,
        steps: parsePricingSteps(rule?.steps ?? []),
      });
      set(`retail_price = ?`, pricing.retail);
      set(`cost_snapshot = ?`, pricing.effectiveCost);
      set(`fx_rate_snapshot = ?`, fx.rate);
      sets.push(`price_mode = 'rule'`);
    }

    if (sets.length === 0) throw new AppError("VALIDATION_ERROR", 400, "Nothing to update");

    const listing = await queryOne(
      `update listings l set ${sets.join(", ")} where l.id = $1 returning ${LISTING_COLS}`,
      params,
    );
    return { listing };
  });
}
