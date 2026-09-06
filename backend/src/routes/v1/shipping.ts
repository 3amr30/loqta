import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EGYPT_GOVERNORATES } from "@loqta/core";
import { getPool, query } from "../../lib/db";

/**
 * Per-governorate shipping rates (P9). Replace-all semantics: the merchant
 * PUTs the full set, we swap it in one transaction. Checkout resolves fees
 * from these rows (services/shipping) with the store-wide default fallback.
 */

const RateSchema = z.strictObject({
  governorate: z.enum(EGYPT_GOVERNORATES),
  fee: z.number().min(0).max(100000),
  delivery_days: z.number().int().min(0).max(60).nullable().optional(),
});

const PutSchema = z.strictObject({
  rates: z.array(RateSchema).max(EGYPT_GOVERNORATES.length),
});

export function shippingRoutes(app: FastifyInstance) {
  app.get("/v1/shipping-rates", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const rates = await query(
      `select governorate, fee::float8 as fee, delivery_days
       from shipping_rates where store_id = $1 order by governorate`,
      [req.store!.id],
    );
    const defaultFee = Number(
      (req.store!.settings as { shipping_fee?: number } | null)?.shipping_fee ?? 0,
    );
    return { default_fee: defaultFee, rates };
  });

  app.put("/v1/shipping-rates", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const body = PutSchema.parse(req.body);
    const storeId = req.store!.id;
    const client = await getPool().connect();
    try {
      await client.query("begin");
      await client.query(`delete from shipping_rates where store_id = $1`, [storeId]);
      for (const r of body.rates) {
        await client.query(
          `insert into shipping_rates (store_id, governorate, fee, delivery_days)
           values ($1, $2, $3, $4)`,
          [storeId, r.governorate, r.fee, r.delivery_days ?? null],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    const rates = await query(
      `select governorate, fee::float8 as fee, delivery_days
       from shipping_rates where store_id = $1 order by governorate`,
      [storeId],
    );
    return { rates };
  });
}
