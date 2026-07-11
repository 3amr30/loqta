import Image from "next/image";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 60; // ISR: fast storefront, fresh enough prices

/**
 * Public storefront — {slug}.loqta.shop lands here via the middleware rewrite.
 * SECURITY: reads ONLY storefront_stores / storefront_listings views, which
 * never expose cost_snapshot or any merchant-private column.
 */
export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ store: string }>;
}) {
  const { store: slug } = await params;
  const supabase = await createClient();

  const { data: store } = await supabase
    .from("storefront_stores")
    .select("id, name, slug, logo_url, currency")
    .eq("slug", slug)
    .maybeSingle();
  if (!store) notFound();

  const { data: listings } = await supabase
    .from("storefront_listings")
    .select("id, slug, title_ar, images, retail_price, currency, stock_status")
    .eq("store_id", store.id)
    .order("created_at", { ascending: false })
    .limit(48);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center gap-3">
        {store.logo_url && (
          <Image
            src={store.logo_url}
            alt={store.name}
            width={44}
            height={44}
            className="rounded-full border border-[var(--line)]"
          />
        )}
        <h1 className="text-2xl font-bold">{store.name}</h1>
      </header>

      {listings?.length ? (
        <div className="mt-10 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {listings.map((l) => {
            const img = Array.isArray(l.images) ? (l.images[0] as string) : null;
            return (
              <a
                key={l.id}
                href={`/s/${store.slug}/p/${l.slug}`} /* product page: Phase 1 */
                className="group overflow-hidden rounded-xl border border-[var(--line)] bg-white transition hover:shadow-md"
              >
                <div className="relative aspect-square bg-[var(--paper)]">
                  {img && (
                    <Image
                      src={img}
                      alt={l.title_ar}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition group-hover:scale-[1.02]"
                    />
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-sm font-medium">{l.title_ar}</p>
                  <p className="mt-1.5 font-bold text-[var(--teal)]">
                    {Number(l.retail_price)} {l.currency}
                  </p>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <p className="mt-16 text-center text-[var(--ink)]/50">
          المتجر لسه بيجهّز منتجاته — ارجع قريب 👀
        </p>
      )}
    </main>
  );
}
