import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";
import { assertSafeImportUrl } from "../../lib/ssrf";

const CreateImportSchema = z.object({ url: z.string().max(2000) }).strict();

const ListImportsSchema = z.object({
  status: z.enum(["queued", "processing", "done", "failed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const PAGE_SIZE = 20;

export function importsRoutes(app: FastifyInstance) {
  app.post("/v1/imports", { preHandler: (req) => app.requireStore(req) }, async (req, reply) => {
    const body = CreateImportSchema.parse(req.body);
    const url = assertSafeImportUrl(body.url);

    const importJob = await queryOne(
      `insert into import_jobs (store_id, requested_by, url)
       values ($1, $2, $3)
       returning id, url, status, error, listing_id, created_at, processed_at`,
      [req.store!.id, req.merchantId, url.toString()],
    );
    return reply.status(202).send({ importJob });
  });

  app.get("/v1/imports", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListImportsSchema.parse(req.query);
    const where = [`store_id = $1`];
    const params: unknown[] = [req.store!.id];
    if (q.status) {
      params.push(q.status);
      where.push(`status = $${params.length}::job_status`);
    }
    const whereSql = where.join(" and ");

    const total = await queryOne<{ count: string }>(
      `select count(*) from import_jobs where ${whereSql}`,
      params,
    );
    const data = await query(
      `select id, url, status, error, listing_id, created_at, processed_at
       from import_jobs where ${whereSql}
       order by created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return {
      data,
      meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) },
    };
  });
}
