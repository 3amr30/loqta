import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";

const ListQuery = z.object({
  unread: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const ReadSchema = z
  .object({
    ids: z.array(z.string().uuid()).max(100).optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => (b.ids && b.ids.length > 0) || b.all, { message: "ids or all required" });

const PAGE_SIZE = 20;

export function notificationsRoutes(app: FastifyInstance) {
  app.get("/v1/notifications", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuery.parse(req.query);
    const where = [`store_id = $1`];
    const params: unknown[] = [req.store!.id];
    if (q.unread) where.push(`read_at is null`);
    const whereSql = where.join(" and ");

    const total = await queryOne<{ count: string }>(
      `select count(*) from notifications where ${whereSql}`,
      params,
    );
    const unread = await queryOne<{ count: string }>(
      `select count(*) from notifications where store_id = $1 and read_at is null`,
      [req.store!.id],
    );
    const data = await query(
      `select id, type, title, body, data, read_at, created_at
       from notifications where ${whereSql}
       order by created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return {
      data,
      meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) },
      unreadCount: Number(unread?.count ?? 0),
    };
  });

  app.post(
    "/v1/notifications/read",
    { preHandler: (req) => app.requireStore(req) },
    async (req) => {
      const body = ReadSchema.parse(req.body);
      const rows = body.all
        ? await query<{ id: string }>(
            `update notifications set read_at = now()
             where store_id = $1 and read_at is null returning id`,
            [req.store!.id],
          )
        : await query<{ id: string }>(
            `update notifications set read_at = now()
             where store_id = $1 and id = any($2::uuid[]) and read_at is null returning id`,
            [req.store!.id, body.ids],
          );
      return { updated: rows.length };
    },
  );
}
