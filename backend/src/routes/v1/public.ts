import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { escapeLike, notify, query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { CheckoutSchema, executeCheckout } from "../../services/checkout";
import { checkReviewEligibility, ReviewSubmitSchema, type EligibilityRow } from "../../services/reviews";
import { getPolicyPage, POLICY_TYPES, type PolicyType } from "../../services/policies";
import { evaluateCheckoutGate } from "../../services/checkout-gate";
import { getCustomerHistory } from "../../services/trust";
import { signOtpToken, verifyOtpToken } from "../../services/otp-token";
import { checkVerification, isOtpConfigured, startVerification } from "../../services/otp";

/**
 * Public storefront API. INVARIANT: reads go through the storefront_*
 * views only — never base tables — so cost_snapshot can never leak.
 * Rate-limited per IP (checkout + review submit much tighter than reads).
 */

const READ_LIMIT = { max: 60, timeWindow: "1 minute" };
const CHECKOUT_LIMIT = { max: 5, timeWindow: "1 minute" };
const REVIEW_LIMIT = { max: 5, timeWindow: "1 minute" };

const SlugParams = z.object({ slug: z.string().min(1).max(63) });
const ListingParams = SlugParams.extend({ listingSlug: z.string().min(1).max(120) });
const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  search: z.string().trim().max(80).optional(),
});
const RELATED_LIMIT = 4;
const REVIEWS_SHOWN = 10;

async function storeBySlug(slug: string) {
  const store = await queryOne<{
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    currency: string;
    theme: unknown;
    shipping_fee: string;
    low_stock_threshold: number;
    whatsapp_phone: string | null;
  }>(
    `select id, name, slug, logo_url, currency, theme,
            shipping_fee::float8 as shipping_fee, low_stock_threshold, whatsapp_phone
     from storefront_stores where slug = $1`,
    [slug],
  );
  if (!store) throw new AppError("STORE_NOT_FOUND", 404, "Store not found");
  return store;
}

export function publicRoutes(app: FastifyInstance) {
  app.get("/v1/public/stores/:slug", { config: { rateLimit: READ_LIMIT } }, async (req) => {
    const { slug } = SlugParams.parse(req.params);
    const store = await storeBySlug(slug);
    return { store };
  });

  app.get(
    "/v1/public/stores/:slug/listings",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug } = SlugParams.parse(req.params);
      const q = PageQuery.parse(req.query);
      const store = await storeBySlug(slug);

      const where = [`store_id = $1`];
      const params: unknown[] = [store.id];
      if (q.search) {
        params.push(`%${escapeLike(q.search)}%`);
        // ILIKE over AR + EN titles; pg_trgm is the upgrade path if catalogs grow.
        where.push(`(title_ar ilike $${params.length} or title_en ilike $${params.length})`);
      }
      const whereSql = where.join(" and ");

      const total = await queryOne<{ count: string }>(
        `select count(*) from storefront_listings where ${whereSql}`,
        params,
      );
      const data = await query(
        `select id, slug, title_ar, title_en, images,
                retail_price::float8 as retail_price, currency, stock_status, stock_qty
         from storefront_listings where ${whereSql}
         order by created_at desc
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
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
                images, retail_price::float8 as retail_price, currency, stock_status, stock_qty
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

      // Related: other active listings in this store, newest first.
      const related = await query(
        `select id, slug, title_ar, title_en, images,
                retail_price::float8 as retail_price, currency, stock_status
         from storefront_listings
         where store_id = $1 and id <> $2
         order by created_at desc
         limit ${RELATED_LIMIT}`,
        [store.id, listing.id],
      );

      // Approved reviews only. Aggregate + latest few, straight from the base
      // table (service pool) — anon never reads product_reviews directly.
      const agg = await queryOne<{ avg: number | null; count: string }>(
        `select avg(rating)::float8 as avg, count(*) as count
         from product_reviews where listing_id = $1 and status = 'approved'`,
        [listing.id],
      );
      const latest = await query(
        `select rating, comment, buyer_name, created_at
         from product_reviews where listing_id = $1 and status = 'approved'
         order by created_at desc limit ${REVIEWS_SHOWN}`,
        [listing.id],
      );

      return {
        listing,
        variants,
        related,
        reviews: {
          avg: agg?.avg ?? null,
          count: Number(agg?.count ?? 0),
          latest,
        },
      };
    },
  );

  app.post(
    "/v1/public/stores/:slug/reviews",
    { config: { rateLimit: REVIEW_LIMIT } },
    async (req, reply) => {
      const { slug } = SlugParams.parse(req.params);
      const body = ReviewSubmitSchema.parse(req.body);
      const store = await storeBySlug(slug);

      const listing = await queryOne<{ id: string }>(
        `select id from storefront_listings where store_id = $1 and slug = $2`,
        [store.id, body.listingSlug],
      );
      if (!listing) throw new AppError("NOT_FOUND", 404, "Listing not found");

      // Verified purchase: match order by store + number + phone, and confirm
      // the order actually contains this listing.
      const elig = await queryOne<EligibilityRow>(
        `select o.id as order_id, o.status,
                exists (select 1 from order_items oi
                        where oi.order_id = o.id and oi.listing_id = $3) as has_listing
         from orders o
         where o.store_id = $1 and o.order_number = $2 and o.customer_phone = $4`,
        [store.id, body.order_number, listing.id, body.phone],
      );
      const decision = checkReviewEligibility(elig);
      if (!decision.ok) throw new AppError(decision.code, 422, decision.message);

      try {
        await query(
          `insert into product_reviews
             (store_id, listing_id, order_id, rating, comment, buyer_name)
           values ($1, $2, $3, $4, $5, $6)`,
          [store.id, listing.id, decision.orderId, body.rating, body.comment ?? null, body.name],
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new AppError("ALREADY_REVIEWED", 409, "قيّمت المنتج ده قبل كده على نفس الطلب.");
        }
        throw err;
      }
      await notify(store.id, "review_pending", "تقييم جديد بانتظار المراجعة",
        `${body.name} قيّم منتجًا (${body.rating}/5) — راجعه من صفحة التقييمات.`, {
          listingId: listing.id,
        });
      return reply.status(201).send({ pending: true });
    },
  );

  app.get(
    "/v1/public/stores/:slug/shipping-rates",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug } = SlugParams.parse(req.params);
      const store = await storeBySlug(slug);
      // shipping_rates may not be migrated yet (pre-010) — degrade to default.
      let rates: unknown[] = [];
      try {
        rates = await query(
          `select governorate, fee::float8 as fee, delivery_days
           from shipping_rates where store_id = $1`,
          [store.id],
        );
      } catch (err) {
        if ((err as { code?: string }).code !== "42P01") throw err;
      }
      return { default_fee: store.shipping_fee, rates };
    },
  );

  app.get(
    "/v1/public/stores/:slug/policies/:type",
    { config: { rateLimit: READ_LIMIT } },
    async (req) => {
      const { slug } = SlugParams.parse(req.params);
      const { type } = z
        .object({ type: z.enum(POLICY_TYPES) })
        .parse(req.params);
      const store = await queryOne<{ policies: Record<string, unknown> | null }>(
        `select settings -> 'policies' as policies from stores where slug = $1`,
        [slug],
      );
      if (!store) throw new AppError("STORE_NOT_FOUND", 404, "Store not found");
      return { policy: getPolicyPage(store.policies, type as PolicyType) };
    },
  );

  // ---- OTP (Twilio Verify, WhatsApp channel) ----
  const PhoneSchema = z.strictObject({
    phone: z.string().regex(/^01[0-9]{9}$/, "رقم موبايل مصري: 01xxxxxxxxx"),
  });
  const OtpCheckSchema = PhoneSchema.extend({ code: z.string().trim().min(3).max(10) });

  app.post(
    "/v1/public/stores/:slug/otp/send",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (req, reply) => {
      SlugParams.parse(req.params);
      const { phone } = PhoneSchema.parse(req.body);
      if (!isOtpConfigured()) {
        return reply
          .status(503)
          .send({ error: { code: "OTP_UNAVAILABLE", message: "التحقق غير متاح حاليًا" } });
      }
      await startVerification(phone); // never logs / returns the code
      return { sent: true };
    },
  );

  app.post(
    "/v1/public/stores/:slug/otp/check",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply) => {
      const { slug } = SlugParams.parse(req.params);
      const { phone, code } = OtpCheckSchema.parse(req.body);
      const secret = process.env.OTP_TOKEN_SECRET;
      if (!isOtpConfigured() || !secret) {
        return reply
          .status(503)
          .send({ error: { code: "OTP_UNAVAILABLE", message: "التحقق غير متاح حاليًا" } });
      }
      const store = await storeBySlug(slug);
      const ok = await checkVerification(phone, code);
      if (!ok) throw new AppError("INVALID_CODE", 422, "الكود غير صحيح أو انتهت صلاحيته.");
      const otpToken = signOtpToken(secret, store.id, phone);
      return { otpToken };
    },
  );

  app.post(
    "/v1/public/stores/:slug/checkout",
    { config: { rateLimit: CHECKOUT_LIMIT } },
    async (req, reply) => {
      const { slug } = SlugParams.parse(req.params);
      const input = CheckoutSchema.parse(req.body);

      // P8 gate: block over the cancellation threshold; require OTP for
      // unproven phones when the store enabled it. Store settings + history
      // are per (store, phone) — service pool, tenant-scoped by slug.
      const store = await queryOne<{ id: string; settings: Record<string, unknown> | null }>(
        `select id, settings from stores where slug = $1`,
        [slug],
      );
      if (!store) throw new AppError("STORE_NOT_FOUND", 404, "Store not found");
      const settings = store.settings ?? {};
      const secret = process.env.OTP_TOKEN_SECRET;
      const hasValidOtpToken = Boolean(
        input.otpToken &&
          secret &&
          verifyOtpToken(secret, input.otpToken, store.id, input.customer.phone),
      );
      const history = await getCustomerHistory(store.id, input.customer.phone);
      const gate = evaluateCheckoutGate({
        otpEnabled: Boolean((settings as { otp_enabled?: boolean }).otp_enabled),
        blockThreshold: (settings as { block_after_cancellations?: number }).block_after_cancellations ?? null,
        history,
        hasValidOtpToken,
      });
      if (gate.action === "blocked") {
        throw new AppError("ORDER_BLOCKED", 422, "معلش، مش قادرين نكمل الطلب ده. تواصل مع المتجر.");
      }
      if (gate.action === "otp_required") {
        return reply.status(202).send({ otpRequired: true });
      }

      const result = await executeCheckout(slug, input);
      return reply.status(201).send(result);
    },
  );
}
