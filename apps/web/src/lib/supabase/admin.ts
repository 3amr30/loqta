import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE client — bypasses RLS. Server-side ONLY, never import from a
 * client component. Used exclusively where RLS must be bypassed by design:
 * the checkout server action (orders have no public INSERT policy — prices
 * are re-validated against the DB here, never trusted from the client).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
