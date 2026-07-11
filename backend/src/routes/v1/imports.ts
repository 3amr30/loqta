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
    const where = [`ij.store_id = $1`];
    const params: unknown[] = [req.store!.id];
    if (q.status) {
      params.push(q.status);
      where.push(`ij.status = $${params.length}::job_status`);
    }
    const whereSql = where.join(" and ");

    const total = await queryOne<{ count: string }>(
      `select count(*) from import_jobs ij where ${whereSql}`,
      params,
    );
    // duplicate: the listing predates this job -> the URL was already in the
    // store (worker reused the existing row instead of creating a copy).
    const data = await query(
      `select ij.id, ij.url, ij.status, ij.error, ij.listing_id, ij.created_at, ij.processed_at,
              coalesce(l.created_at < ij.created_at, false) as duplicate
       from import_jobs ij
       left join listings l on l.id = ij.listing_id
       where ${whereSql}
       order by ij.created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return {
      data,
      meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) },
    };
  });
}
