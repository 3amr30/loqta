import { queryOne } from "../../lib/db";
import { Sentry } from "../../lib/sentry";

/** Rates older than this are suspect - EGP moves, imports must not silently
 *  price real products off the seeded placeholder. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface FxInfo {
  rate: number;
  /** true when the pair's fetched_at is older than 7 days */
  stale: boolean;
  fetchedAt: Date | null;
}

export function isFxStale(fetchedAt: Date | string, now: number = Date.now()): boolean {
  return now - new Date(fetchedAt).getTime() > STALE_MS;
}

/**
 * FX from the fx_rates table (seeded by migration, refreshed by a future
 * fx job). Returns rate 1 for same-currency. Throws when a needed pair is
 * missing — better to fail an import than to price with an unknown rate.
 * Stale pairs still return a rate but warn + Sentry (tag fx_stale) and the
 * caller must surface the staleness in its merchant notification.
 */
export async function getFxRate(from: string, to: string): Promise<FxInfo> {
  if (from.toUpperCase() === to.toUpperCase()) {
    return { rate: 1, stale: false, fetchedAt: null };
  }
  const row = await queryOne<{ rate: string; fetched_at: string }>(
    `select rate, fetched_at from fx_rates where base = $1 and quote = $2`,
    [from.toUpperCase(), to.toUpperCase()],
  );
  if (!row) {
    throw new Error(
      `Missing FX rate ${from}->${to}. Seed fx_rates or add the fx refresh job.`,
    );
  }
  const stale = isFxStale(row.fetched_at);
  if (stale) {
    console.warn(`[fx] STALE rate ${from}->${to}, fetched_at=${row.fetched_at}`);
    Sentry.captureMessage(`Stale FX rate ${from}->${to}`, {
      level: "warning",
      tags: { fx_stale: "true", pair: `${from}->${to}` },
    });
  }
  return { rate: Number(row.rate), stale, fetchedAt: new Date(row.fetched_at) };
}

/** Arabic staleness warning appended to import/pricing notifications. */
export const FX_STALE_NOTE = " ⚠️ تنبيه: سعر الصرف المستخدم قديم (أكثر من ٧ أيام) — راجع السعر.";
