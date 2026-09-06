import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";

/**
 * Customers = deterministic per-store aggregate over orders (same basis as the
 * P8 customer_order_history view, plus name / last activity / COD lifetime).
 * Owner-scoped by requireStore. No probabilistic score — just counts the
 * merchant already owns.
 */

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().trim().max(40).optional(), // phone fragment
});

const PAGE_SIZE = 30;

export function customersRoutes(app: FastifyInstance) {
  app.get("/v1/customers", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuery.parse(req.query);
    const where = [`store_id = $1`];
    const params: unknown[] = [req.store!.id];
    if (q.search) {
      params.push(`%${q.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`customer_phone ilike $${params.length}`);
    }
    const whereSql = where.join(" and ");

    const total = await queryOne<{ count: string }>(
      `select count(distinct customer_phone) from orders where ${whereSql}`,
      params,
    );
    const data = await query(
      `select customer_phone as phone,
              (array_agg(customer_name order by created_at desc))[1] as name,
              count(*)::int as total,
              count(*) filter (where status in ('confirmed','fulfilled','shipped','delivered'))::int as confirmed,
              count(*) filter (where status = 'cancelled')::int as cancelled,
              count(*) filter (where status = 'returned')::int as returned,
              max(created_at) as last_order_at,
              coalesce(sum(total) filter (where status in ('delivered')), 0)::float8 as delivered_value
       from orders where ${whereSql}
       group by customer_phone
       order by max(created_at) desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return {
      data,
      meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) },
    };
  });
}
