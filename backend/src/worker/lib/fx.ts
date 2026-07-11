import { queryOne } from "./db";

/**
 * FX from the fx_rates table (seeded by migration, refreshed by a future
 * fx job). Returns 1 for same-currency. Throws when a needed pair is missing
 * — better to fail an import than to price with a stale/unknown rate.
 */
export async function getFxRate(from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const row = await queryOne<{ rate: string }>(
    `select rate from fx_rates where base = $1 and quote = $2`,
    [from.toUpperCase(), to.toUpperCase()],
  );
  if (!row) {
    throw new Error(
      `Missing FX rate ${from}->${to}. Seed fx_rates or add the fx refresh job.`,
    );
  }
  return Number(row.rate);
}
