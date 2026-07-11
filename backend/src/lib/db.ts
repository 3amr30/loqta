import pg from "pg";
import type { QueryResultRow } from "pg";
import "dotenv/config";

let _pool: pg.Pool | null = null;

/**
 * One lazily-created Pool for all backend data access (api + worker).
 * Lazy so unit tests can import query helpers without DATABASE_URL.
 * The backend connects with the database role directly (service-level
 * access, bypasses RLS by design) — it is the only component allowed
 * to write to the shared source catalog.
 */
export function getPool(): pg.Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is required (direct Supabase connection, port 5432)");
    }
    _pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export async function endPool() {
  await _pool?.end().catch(() => {});
  _pool = null;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function notify(
  storeId: string,
  type: string,
  title: string,
  body: string | null,
  data: Record<string, unknown> = {},
) {
  const row = await queryOne<{ id: string }>(
    `insert into notifications (store_id, type, title, body, data)
     values ($1, $2::notification_type, $3, $4, $5)
     returning id`,
    [storeId, type, title, body, JSON.stringify(data)],
  );
  // Mirror to email/WhatsApp via the worker (PLAN-GROWTH §1.2). The row above
  // is the source of truth — a dispatch-enqueue failure must never break
  // checkout or sync, so it only warns. Dynamic imports keep pg-boss out of
  // unit tests that import this module.
  try {
    if (row) {
      const { getBoss } = await import("./queue");
      const { Q } = await import("../worker/queues");
      await (await getBoss()).send(Q.notifyDispatch, { notificationId: row.id });
    }
  } catch (err) {
    console.warn("[notify] dispatch enqueue failed:", err);
  }
}
