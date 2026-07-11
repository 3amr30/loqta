import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";

/** Mirrors the DB check constraint on stores.slug exactly. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const CreateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_RE, "3-40 chars, a-z 0-9 and hyphens, no leading/trailing hyphen"),
  })
  .strict();

export const UpdateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    logo_url: z.string().url().nullable().optional(),
    sync_policy: z.enum(["pause_only", "auto_apply", "require_approval"]).optional(),
    settings: z.object({ shipping_fee: z.number().min(0).optional() }).strict().optional(),
  })
  .strict();

const STORE_COLS = `id, name, slug, currency, logo_url, settings, sync_policy, created_at`;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

export function storesRoutes(app: FastifyInstance) {
  app.post("/v1/stores", { preHandler: (req) => app.requireAuth(req) }, async (req, reply) => {
    const body = CreateStoreSchema.parse(req.body);

    // MVP: one store per merchant (plans.max_stores enforcement comes with billing).
    const existing = await queryOne(`select id from stores where merchant_id = $1`, [
      req.merchantId,
    ]);
    if (existing) throw new AppError("STORE_EXISTS", 409, "Merchant already has a store");

    try {
      const store = await queryOne(
        `insert into stores (merchant_id, name, slug)
         values ($1, $2, $3) returning ${STORE_COLS}`,
        [req.merchantId, body.name, body.slug],
      );
      return reply.status(201).send({ store });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError("SLUG_TAKEN", 409, "Slug already in use");
      throw err;
    }
  });

  app.patch("/v1/stores", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const body = UpdateStoreSchema.parse(req.body);
    const store = await queryOne(
      `update stores set
         name        = coalesce($2, name),
         logo_url    = case when $5 then $3 else logo_url end,
         sync_policy = coalesce($4::sync_policy, sync_policy),
         settings    = settings || $6::jsonb
       where id = $1
       returning ${STORE_COLS}`,
      [
        req.store!.id,
        body.name ?? null,
        body.logo_url ?? null,
        body.sync_policy ?? null,
        "logo_url" in body, // allows explicit null to clear the logo
        JSON.stringify(body.settings ?? {}),
      ],
    );
    return { store };
  });
}
