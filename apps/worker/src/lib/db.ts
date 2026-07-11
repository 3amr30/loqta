import pg from "pg";
import type { QueryResultRow } from "pg";
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required (direct Supabase connection, port 5432)");
}

/**
 * One Pool for all worker data access. The worker connects with the database
 * role directly (service-level access, bypasses RLS by design) — it is the
 * only component allowed to write to the shared source catalog.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? undefined
    : { rejectUnauthorized: false },
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
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
  await query(
    `insert into notifications (store_id, type, title, body, data)
     values ($1, $2::notification_type, $3, $4, $5)`,
    [storeId, type, title, body, JSON.stringify(data)],
  );
}
