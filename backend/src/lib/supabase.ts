import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Service-role Supabase client — Storage uploads ONLY. All Postgres access
 * goes through lib/db (pg pool); this client must never become a second
 * data path.
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Storage uploads");
    }
    _client = createClient(url, key, { auth: { persistSession: false } });
  }
  return _client;
}
