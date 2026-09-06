import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";

/**
 * Discount-code management (P9). Validation + amount happen at checkout
 * (services/discount); this is the merchant CRUD. Codes are normalized
 * upper-case; uniqueness is per store.
 */

const CODE_RE = /^[A-Za-z0-9_-]{2,40}$/;

const CreateSchema = z.strictObject({
  code: z.string().trim().regex(CODE_RE, "حروف وأرقام فقط، 2–40"),
  type: z.enum(["percent", "fixed"]),
  value: z.number().positive().max(1000000),
  min_subtotal: z.number().min(0).max(1000000).nullable().optional(),
  max_uses: z.number().int().min(1).max(1000000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

const PatchSchema = z
  .strictObject({
    active: z.boolean().optional(),
    expires_at: z.string().datetime().nullable().optional(),
    max_uses: z.number().int().min(1).max(1000000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "لا يوجد تغيير" });

// A percent code above 100 is almost always a mistake — reject it.
function validatePercent(type: string, value: number) {
  if (type === "percent" && value > 100) {
    throw new AppError("VALIDATION_ERROR", 400, "نسبة الخصم لا يمكن أن تتجاوز 100%");
  }
}

const COLS = `id, code, type, value::float8 as value,
  min_subtotal::float8 as min_subtotal, max_uses, used_count,
  expires_at, active, created_at`;

export function discountsRoutes(app: FastifyInstance) {
  app.get("/v1/discounts", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const data = await query(
      `select ${COLS} from discount_codes where store_id = $1 order by created_at desc`,
      [req.store!.id],
    );
    return { data };
  });

  app.post("/v1/discounts", { preHandler: (req) => app.requireStore(req) }, async (req, reply) => {
    const body = CreateSchema.parse(req.body);
    validatePercent(body.type, body.value);
    const code = body.code.toUpperCase();
    try {
      const discount = await queryOne(
        `insert into discount_codes
           (store_id, code, type, value, min_subtotal, max_uses, expires_at, active)
         values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, true))
         returning ${COLS}`,
        [
          req.store!.id,
          code,
          body.type,
          body.value,
          body.min_subtotal ?? null,
          body.max_uses ?? null,
          body.expires_at ?? null,
          body.active ?? null,
        ],
      );
      return reply.status(201).send({ discount });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new AppError("CODE_TAKEN", 409, "الكود ده مستخدم بالفعل.");
      }
      throw err;
    }
  });

  app.patch("/v1/discounts/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = PatchSchema.parse(req.body);
    const discount = await queryOne(
      `update discount_codes set
         active = coalesce($3, active),
         expires_at = case when $4 then $5 else expires_at end,
         max_uses = case when $6 then $7 else max_uses end
       where id = $1 and store_id = $2
       returning ${COLS}`,
      [
        id,
        req.store!.id,
        body.active ?? null,
        "expires_at" in body,
        body.expires_at ?? null,
        "max_uses" in body,
        body.max_uses ?? null,
      ],
    );
    if (!discount) throw new AppError("NOT_FOUND", 404, "Discount not found");
    return { discount };
  });
}
