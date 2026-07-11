import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notify, query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { repriceListing } from "../../services/reprice";
import { FX_STALE_NOTE } from "../../worker/lib/fx";

/**
 * require_approval queue. Rows are created by the sync worker; the merchant
 * approves or rejects here. Approve runs the SAME repricing path auto_apply
 * uses (services/reprice) — the two can never drift.
 */

const ListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "superseded"]).default("pending"),
  page: z.coerce.number().int().min(1).default(1),
});
const IdParams = z.object({ id: z.string().uuid() });

const PAGE_SIZE = 20;

const COLS = `
  pc.id, pc.listing_id, pc.status,
  pc.old_cost::float8 as old_cost, pc.new_cost::float8 as new_cost, pc.cost_currency,
  pc.old_retail::float8 as old_retail, pc.proposed_retail::float8 as proposed_retail,
  pc.created_at, pc.decided_at,
  l.title_ar, l.retail_price::float8 as current_retail, l.price_mode`;

export function priceChangesRoutes(app: FastifyInstance) {
  app.get("/v1/price-changes", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuery.parse(req.query);
    const total = await queryOne<{ count: string }>(
      `select count(*) from pending_price_changes pc where pc.store_id = $1 and pc.status = $2`,
      [req.store!.id, q.status],
    );
    const data = await query(
      `select ${COLS}
       from pending_price_changes pc
       join listings l on l.id = pc.listing_id
       where pc.store_id = $1 and pc.status = $2
       order by pc.created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      [req.store!.id, q.status],
    );
    return { data, meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) } };
  });

  app.post(
    "/v1/price-changes/:id/approve",
    { preHandler: (req) => app.requireStore(req) },
    async (req) => {
      const { id } = IdParams.parse(req.params);

      // Atomic claim: only a still-pending row can be approved (a newer
      // supplier change marks older rows superseded).
      const pc = await queryOne<{
        listing_id: string;
        new_cost: number;
        cost_currency: string;
      }>(
        `update pending_price_changes
         set status = 'approved', decided_at = now()
         where id = $1 and store_id = $2 and status = 'pending'
         returning listing_id, new_cost::float8 as new_cost, cost_currency`,
        [id, req.store!.id],
      );
      if (!pc) {
        const row = await queryOne<{ status: string }>(
          `select status from pending_price_changes where id = $1 and store_id = $2`,
          [id, req.store!.id],
        );
        if (!row) throw new AppError("NOT_FOUND", 404, "Price change not found");
        throw new AppError("SUPERSEDED", 409, `Change is already ${row.status}`, {
          status: row.status,
        });
      }

      const r = await repriceListing(pc.listing_id, pc.new_cost, pc.cost_currency);
      if (!r) throw new AppError("NOT_FOUND", 404, "Listing no longer exists");

      const listing = await queryOne(
        `select id, title_ar, status, price_mode, currency,
                retail_price::float8 as retail_price,
                cost_snapshot::float8 as cost_snapshot
         from listings where id = $1`,
        [pc.listing_id],
      );
      await notify(
        req.store!.id,
        "price_changed",
        "تم تطبيق السعر الجديد",
        `سعر البيع الجديد: ${r.retail} ${r.currency}${r.fxStale ? FX_STALE_NOTE : ""}`,
        { listingId: pc.listing_id },
      );
      return { listing };
    },
  );

  app.post(
    "/v1/price-changes/:id/reject",
    { preHandler: (req) => app.requireStore(req) },
    async (req) => {
      const { id } = IdParams.parse(req.params);
      const row = await queryOne<{ id: string }>(
        `update pending_price_changes
         set status = 'rejected', decided_at = now()
         where id = $1 and store_id = $2 and status = 'pending'
         returning id`,
        [id, req.store!.id],
      );
      if (!row) throw new AppError("NOT_FOUND", 404, "No pending change to reject");
      return { ok: true };
    },
  );
}
