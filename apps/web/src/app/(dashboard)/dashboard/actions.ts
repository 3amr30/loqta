"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** slug rules mirror the DB check constraint on stores.slug */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export async function createStore(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();

  if (!name || !SLUG_RE.test(slug)) {
    redirect("/dashboard?error=invalid_store");
  }

  const { error } = await supabase
    .from("stores")
    .insert({ merchant_id: user.id, name, slug });

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.code ?? "store_failed")}`);
  }
  revalidatePath("/dashboard");
}

export async function requestImport(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const raw = String(formData.get("url") ?? "").trim();
  if (!isSafePublicUrl(raw)) {
    redirect("/dashboard?error=invalid_url");
  }

  const { data: store } = await supabase
    .from("stores")
    .select("id")
    .eq("merchant_id", user.id)
    .limit(1)
    .single();
  if (!store) redirect("/dashboard?error=no_store");

  // RLS double-checks ownership; worker sweeps this row within seconds.
  const { error } = await supabase.from("import_jobs").insert({
    store_id: store.id,
    requested_by: user.id,
    url: raw,
  });

  if (error) {
    redirect(`/dashboard?error=${encodeURIComponent(error.code ?? "import_failed")}`);
  }
  revalidatePath("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Basic SSRF guard: the worker will fetch whatever URL lands in import_jobs,
 * so block obvious internal targets here. (The worker environment should ALSO
 * be network-isolated from anything sensitive — defense in depth.)
 */
function isSafePublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "0.0.0.0" ||
    host === "[::1]"
  ) {
    return false;
  }
  return true;
}
