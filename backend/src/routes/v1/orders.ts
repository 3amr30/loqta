import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query, queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { ordersToCsv, type OrderCsvRow } from "../../services/orders-csv";
import { canTransition, nextStatuses, type OrderStatus } from "../../services/order-status";
import { getCustomerHistory, trustSummaryAr } from "../../services/trust";

const STATUS = z.enum([
  "pending", "confirmed", "fulfilled", "shipped", "delivered", "cancelled", "returned",
]);

const ListQuery = z.object({
  status: STATUS.optional(),
  page: z.coerce.number().int().min(1).default(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const PatchSchema = z
  .object({
    status: STATUS.optional(),
    tracking_number: z.string().trim().max(100).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .strict();

const PAGE_SIZE = 20;

const ORDER_COLS = `
  o.id, o.order_number, o.customer_name, o.customer_phone, o.governorate,
  o.shipping_address, o.status, o.currency,
  o.subtotal::float8 as subtotal, o.shipping_fee::float8 as shipping_fee,
  o.total::float8 as total, o.total_cost::float8 as total_cost,
  (o.total - o.total_cost)::float8 as profit,
  o.notes, o.tracking_number, o.whatsapp_confirmation_status, o.whatsapp_confirmed_at,
  o.created_at, o.updated_at`;

function buildFilters(storeId: string, q: z.infer<typeof ListQuery>) {
  const where = [`o.store_id = $1`];
  const params: unknown[] = [storeId];
  if (q.status) {
    params.push(q.status);
    where.push(`o.status = $${params.length}::order_status`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`o.created_at >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`o.created_at <= $${params.length}`);
  }
  return { whereSql: where.join(" and "), params };
}

export function ordersRoutes(app: FastifyInstance) {
  // NOTE: registered before /v1/orders/:id so "export.csv" is not read as an id.
  app.get(
    "/v1/orders/export.csv",
    { preHandler: (req) => app.requireStore(req) },
    async (req, reply) => {
      const q = ListQuery.parse(req.query);
      const { whereSql, params } = buildFilters(req.store!.id, q);

      const rows = await query<OrderCsvRow>(
        `select o.order_number, o.created_at, o.customer_name, o.customer_phone,
                o.governorate, o.status, o.tracking_number,
                o.subtotal::float8 as subtotal, o.shipping_fee::float8 as shipping_fee,
                o.total::float8 as total, o.total_cost::float8 as total_cost,
                coalesce((
                  select string_agg(oi.qty || 'x ' || oi.title_snapshot ||
                    coalesce(' (' || oi.variant_snapshot || ')', ''), ' + ')
                  from order_items oi where oi.order_id = o.id
                ), '') as items
         from orders o where ${whereSql}
         order by o.created_at desc
         limit 5000`,
        params,
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="loqta-orders.csv"`)
        .send(ordersToCsv(rows));
    },
  );

  app.get("/v1/orders", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const q = ListQuery.parse(req.query);
    const { whereSql, params } = buildFilters(req.store!.id, q);

    const total = await queryOne<{ count: string }>(
      `select count(*) from orders o where ${whereSql}`,
      params,
    );
    const data = await query(
      `select ${ORDER_COLS},
              (select count(*) from order_items oi where oi.order_id = o.id) as item_count
       from orders o where ${whereSql}
       order by o.created_at desc
       limit ${PAGE_SIZE} offset ${(q.page - 1) * PAGE_SIZE}`,
      params,
    );
    return { data, meta: { page: q.page, pageSize: PAGE_SIZE, total: Number(total?.count ?? 0) } };
  });

  app.get("/v1/orders/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await queryOne<{ status: OrderStatus; customer_phone: string }>(
      `select ${ORDER_COLS} from orders o where o.id = $1 and o.store_id = $2`,
      [id, req.store!.id],
    );
    if (!order) throw new AppError("NOT_FOUND", 404, "Order not found");

    const items = await query(
      `select oi.id, oi.title_snapshot, oi.variant_snapshot, oi.qty,
              oi.unit_price::float8 as unit_price,
              oi.unit_cost_snapshot::float8 as unit_cost_snapshot,
              s.name as supplier_name, s.whatsapp_phone as supplier_whatsapp
       from order_items oi
       left join suppliers s on s.id = oi.supplier_id
       where oi.order_id = $1`,
      [id],
    );

    // P8 trust signal: this phone's per-store history (this order excluded is
    // fine — the view counts all; the merchant reads it as "with you before").
    const history = await getCustomerHistory(req.store!.id, order.customer_phone);
    return {
      order,
      items,
      nextStatuses: nextStatuses(order.status),
      customerHistory: history,
      trustNote: trustSummaryAr(history),
    };
  });

  app.patch("/v1/orders/:id", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = PatchSchema.parse(req.body);

    const current = await queryOne<{ status: OrderStatus }>(
      `select status from orders where id = $1 and store_id = $2`,
      [id, req.store!.id],
    );
    if (!current) throw new AppError("NOT_FOUND", 404, "Order not found");
    if (body.status && !canTransition(current.status, body.status)) {
      throw new AppError(
        "INVALID_TRANSITION",
        422,
        `Cannot move ${current.status} -> ${body.status}`,
        { allowed: nextStatuses(current.status) },
      );
    }

    const order = await queryOne<{ status: OrderStatus }>(
      `update orders o set
         status = coalesce($3::order_status, status),
         tracking_number = case when $4 then $5 else tracking_number end,
         notes = case when $6 then $7 else notes end
       where o.id = $1 and o.store_id = $2
       returning ${ORDER_COLS}`,
      [
        id,
        req.store!.id,
        body.status ?? null,
        "tracking_number" in body,
        body.tracking_number ?? null,
        "notes" in body,
        body.notes ?? null,
      ],
    );
    return { order, nextStatuses: nextStatuses(order!.status) };
  });
}
