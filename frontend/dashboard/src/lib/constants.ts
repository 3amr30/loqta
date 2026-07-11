/**
 * Poll intervals (ms), centralized on purpose: swapping to Supabase
 * Realtime later touches ONLY this file and the hooks that consume it.
 */
export const POLL_INTERVALS = {
  imports: 3_000,
  notifications: 30_000,
} as const;

export const API_URL = import.meta.env.VITE_API_URL ?? "";
