import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";

/** Merchant review moderation. Public reads only ever see status='approved'. */

const ListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
});
const PatchSchema = z.object({ status: z.enum(["approved", "rejected"]) }).strict();

const PAGE_SIZE = 20;

const COLS = `
  r.id, r.listing_id, r.rating, r.comment, r.buyer_name, r.status, r.created_at,
  l.title_ar as listing_title`;

export function reviewsRoutes(app: FastifyInstance) {
  app.get("/v1/reviews", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuery.parse(req.query);
    const total = await queryOne<{ count: string }>(
      `select count(*) from product_reviews r where r.store_id = $1 and r.status = $2`,
      [req.store!.id, q.status],
    );
    const data = await query(
      `select ${COLS}
       from product_reviews r
       join listings l on l.id = r.listing_id
       where r.store_id = $1 and r.status = $2
       order by r.created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      [req.store!.id, q.status],
    );
    return { data, meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) } };
  });

  app.patch("/v1/reviews/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = PatchSchema.parse(req.body);
    const review = await queryOne(
      `update product_reviews r set status = $3
       where r.id = $1 and r.store_id = $2
       returning r.id, r.listing_id, r.rating, r.comment, r.buyer_name, r.status, r.created_at`,
      [id, req.store!.id, body.status],
    );
    if (!review) throw new AppError("NOT_FOUND", 404, "Review not found");
    return { review };
  });
}
