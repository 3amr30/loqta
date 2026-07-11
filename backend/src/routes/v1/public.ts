import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { CheckoutSchema, executeCheckout } from "../../services/checkout";

/**
 * Public storefront API. INVARIANT: reads go through the storefront_*
 * views only — never base tables — so cost_snapshot can never leak.
 * Rate-limited per IP (checkout much tighter than reads).
 */

const READ_LIMIT = { max: 60, timeWindow: "1 minute" };
const CHECKOUT_LIMIT = { max: 5, timeWindow: "1 minute" };

const SlugParams = z.object({ slug: z.string().min(1).max(63) });
const ListingParams = SlugParams.extend({ listingSlug: z.string().min(1).max(120) });
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

async function storeBySlug(slug: string) {
  const store = await queryOne<{
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    currency: string;
    theme: unknown;
    shipping_fee: string;
  }>(
    `select id, name, slug, logo_url, currency, theme, shipping_fee::float8 as shipping_fee
     from storefront_stores where slug = $1`,
    [slug],
  );
  if (!store) throw new AppError("STORE_NOT_FOUND", 404, "Store not found");
  return store;
}

export function publicRoutes(app: FastifyInstance) {
  app.get(
    "/v1/public/stores/:slug",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug } = SlugParams.parse(req.params);
      const store = await storeBySlug(slug);
      return { store };
    },
  );

  app.get(
    "/v1/public/stores/:slug/listings",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug } = SlugParams.parse(req.params);
      const q = PageQuery.parse(req.query);
      const store = await storeBySlug(slug);

      const total = await queryOne<{ count: string }>(
        `select count(*) from storefront_listings where store_id = $1`,
        [store.id],
      );
      const data = await query(
        `select id, slug, title_ar, title_en, images,
                retail_price::float8 as retail_price, currency, stock_status
         from storefront_listings where store_id = $1
         order by created_at desc
         limit $2 offset $3`,
        [store.id, q.pageSize, (q.page - 1) * q.pageSize],
      );
      return {
        data,
        meta: { page: q.page, pageSize: q.pageSize, total: Number(total?.count ?? 0) },
      };
    },
  );

  app.get(
    "/v1/public/stores/:slug/listings/:listingSlug",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug, listingSlug } = ListingParams.parse(req.params);
      const store = await storeBySlug(slug);

      const listing = await queryOne<{ id: string }>(
        `select id, slug, title_ar, title_en, description_ar, description_en,
                images, retail_price::float8 as retail_price, currency, stock_status
         from storefront_listings where store_id = $1 and slug = $2`,
        [store.id, listingSlug],
      );
      if (!listing) throw new AppError("NOT_FOUND", 404, "Listing not found");

      const variants = await query(
        `select id, retail_price::float8 as retail_price, title, options,
                image_url, stock_status
         from storefront_listing_variants where listing_id = $1`,
        [listing.id],
      );
      return { listing, variants };
    },
  );

  app.post(
    "/v1/public/stores/:slug/checkout",
    { config: { rateLimit: CHECKOUT_LIMIT } },
    async (req, reply) => {
      const { slug } = SlugParams.parse(req.params);
      const input = CheckoutSchema.parse(req.body);
      const result = await executeCheckout(slug, input);
      return reply.status(201).send(result);
    },
  );
}
