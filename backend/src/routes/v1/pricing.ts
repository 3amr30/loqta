import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { computeRetail, parsePricingSteps } from "@loqta/core";
import { query, queryOne } from "../../lib/db";
import { getFxRate } from "../../worker/lib/fx";

/** API-side validation of pricing steps - malformed jsonb is additionally
 *  filtered in core (parsePricingSteps), defense in depth. */
export const PricingStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fx_buffer"), pct: z.number().finite().min(0).max(100) }).strict(),
  z.object({ type: z.literal("margin_pct"), pct: z.number().finite().min(-100).max(1000) }).strict(),
  z.object({ type: z.literal("add_fixed"), amount: z.number().finite() }).strict(),
  z.object({ type: z.literal("min_profit"), amount: z.number().finite().min(0) }).strict(),
  z.object({ type: z.literal("round_to_ending"), ending: z.number().int().min(0).max(999) }).strict(),
]);

export const PutRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    steps: z.array(PricingStepSchema).min(0).max(10),
  })
  .strict();

export const PreviewSchema = z
  .object({
    cost: z.number().positive().finite(),
    currency: z.string().trim().toUpperCase().length(3),
  })
  .strict();

export function pricingRoutes(app: FastifyInstance) {
  app.get("/v1/pricing-rules", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const rules = await query(
      `select id, name, is_default, steps, created_at
       from pricing_rules where store_id = $1 order by is_default desc, created_at`,
      [req.store!.id],
    );
    return { rules };
  });

  app.put("/v1/pricing-rules", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const body = PutRuleSchema.parse(req.body);
    const rule = await queryOne(
      `insert into pricing_rules (store_id, name, is_default, steps)
       values ($1, coalesce($2, 'القاعدة الافتراضية'), true, $3::jsonb)
       on conflict (store_id) where is_default do update set
         name = coalesce($2, pricing_rules.name),
         steps = excluded.steps
       returning id, name, is_default, steps, created_at`,
      [req.store!.id, body.name ?? null, JSON.stringify(body.steps)],
    );
    return { rule };
  });

  app.post("/v1/pricing/preview", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const body = PreviewSchema.parse(req.body);
    const rule = await queryOne<{ steps: unknown }>(
      `select steps from pricing_rules where store_id = $1 and is_default limit 1`,
      [req.store!.id],
    );
    const fx = await getFxRate(body.currency, req.store!.currency);
    const pricing = computeRetail({
      cost: body.cost,
      fxRate: fx.rate,
      steps: parsePricingSteps(rule?.steps ?? []),
    });
    return { ...pricing, fxRate: fx.rate, fxStale: fx.stale };
  });
}
