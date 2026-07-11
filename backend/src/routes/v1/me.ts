import type { FastifyInstance } from "fastify";
import { queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";

export function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", { preHandler: (req) => app.requireAuth(req) }, async (req) => {
    const profile = await queryOne(
      `select id, full_name, phone, role, created_at from profiles where id = $1`,
      [req.merchantId],
    );
    if (!profile) throw new AppError("NO_PROFILE", 404, "Profile not found");

    const store = await queryOne(
      `select id, name, slug, currency, logo_url, settings, sync_policy, created_at
       from stores where merchant_id = $1 order by created_at limit 1`,
      [req.merchantId],
    );

    const plan =
      (await queryOne(
        `select p.id, p.name_ar, p.name_en, p.price_egp, p.max_stores, p.max_listings,
                p.sync_interval_hours
         from plans p
         join subscriptions s on s.plan_id = p.id
         where s.merchant_id = $1 and s.status = 'active'`,
        [req.merchantId],
      )) ??
      (await queryOne(
        `select id, name_ar, name_en, price_egp, max_stores, max_listings,
                sync_interval_hours
         from plans where id = 'free'`,
      ));

    return { profile, store, plan };
  });
}
