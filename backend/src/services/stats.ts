import { query, queryOne } from "../lib/db";

export function clampDays(raw: number): number {
  if (!Number.isFinite(raw)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(raw)));
}

/** Revenue/cost/profit come from ORDER-TIME SNAPSHOTS, never live prices. */
export async function statsOverview(storeId: string, days: number) {
  const interval = `${clampDays(days)} days`;
  const active = `status not in ('cancelled', 'returned')`;

  const totals = await queryOne<{
    orders: string;
    revenue: string;
    cost: string;
  }>(
    `select count(*) as orders,
            coalesce(sum(total), 0)::float8 as revenue,
            coalesce(sum(total_cost), 0)::float8 as cost
     from orders
     where store_id = $1 and created_at >= now() - $2::interval and ${active}`,
    [storeId, interval],
  );

  const daily = await query(
    `select created_at::date as date,
            count(*) as orders,
            coalesce(sum(total), 0)::float8 as revenue,
            coalesce(sum(total - total_cost), 0)::float8 as profit
     from orders
     where store_id = $1 and created_at >= now() - $2::interval and ${active}
     group by 1 order by 1`,
    [storeId, interval],
  );

  const topProducts = await query(
    `select oi.listing_id, oi.title_snapshot as title,
            sum(oi.qty)::int as qty,
            sum(oi.unit_price * oi.qty)::float8 as revenue
     from order_items oi
     join orders o on o.id = oi.order_id
     where o.store_id = $1 and o.created_at >= now() - $2::interval
       and o.${active}
     group by 1, 2 order by revenue desc limit 5`,
    [storeId, interval],
  );

  const revenue = Number(totals?.revenue ?? 0);
  const cost = Number(totals?.cost ?? 0);
  return {
    totals: {
      orders: Number(totals?.orders ?? 0),
      revenue,
      cost,
      profit: Math.round((revenue - cost) * 100) / 100,
    },
    daily,
    topProducts,
  };
}
