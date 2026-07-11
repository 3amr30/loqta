import { createClient } from "@/lib/supabase/server";
import { createStore, requestImport } from "./actions";

export const dynamic = "force-dynamic";

const JOB_LABEL: Record<string, string> = {
  queued: "في الانتظار",
  processing: "شغال...",
  done: "تم ✅",
  failed: "فشل ❌",
};

const LISTING_LABEL: Record<string, string> = {
  draft: "مسودة",
  active: "منشور",
  paused: "موقوف",
  archived: "مؤرشف",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: store } = await supabase
    .from("stores")
    .select("id, name, slug, currency")
    .limit(1)
    .maybeSingle();

  // ---------- Onboarding: no store yet ----------
  if (!store) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold">أنشئ متجرك الأول</h1>
        <p className="mt-2 text-[var(--ink)]/60">
          دقيقة واحدة وهيبقى عندك متجر على رابط خاص بيك.
        </p>
        <form action={createStore} className="mt-8 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">اسم المتجر</span>
            <input
              name="name"
              required
              placeholder="متجر أحمد"
              className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--teal)]"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              الرابط <span className="text-[var(--ink)]/50">(إنجليزي وأرقام وشرطات)</span>
            </span>
            <div dir="ltr" className="flex items-center gap-2">
              <input
                name="slug"
                required
                pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
                placeholder="ahmed-store"
                className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--teal)]"
              />
              <span className="text-sm text-[var(--ink)]/50">.loqta.shop</span>
            </div>
          </label>
          <button className="mt-2 rounded-lg bg-[var(--teal)] px-6 py-3 font-semibold text-white transition hover:opacity-90">
            أنشئ المتجر
          </button>
        </form>
      </div>
    );
  }

  // ---------- Main dashboard ----------
  const [{ data: imports }, { data: listings }] = await Promise.all([
    supabase
      .from("import_jobs")
      .select("id, url, status, error, created_at")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("listings")
      .select("id, title_ar, retail_price, cost_snapshot, currency, status")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-2xl font-bold">{store.name}</h1>
        <p dir="ltr" className="mt-1 text-sm text-[var(--ink)]/50">
          {store.slug}.loqta.shop
        </p>
      </div>

      {/* ---- The core promise: paste a URL ---- */}
      <section className="rounded-xl border border-[var(--line)] bg-white p-6">
        <h2 className="font-bold">استورد منتج بلينك واحد</h2>
        <p className="mt-1 text-sm text-[var(--ink)]/60">
          الصق رابط المنتج من موقع المورد — لقطة هتسحب الاسم والصور والسعر وتحسب
          سعر البيع بهامش ربحك.
        </p>
        <form action={requestImport} className="mt-4 flex gap-2">
          <input
            dir="ltr"
            name="url"
            type="url"
            required
            placeholder="https://supplier-site.com/product/123"
            className="w-full rounded-lg border border-[var(--line)] px-4 py-3 outline-none focus:border-[var(--teal)]"
          />
          <button className="shrink-0 rounded-lg bg-[var(--teal)] px-6 py-3 font-semibold text-white transition hover:opacity-90">
            استيراد
          </button>
        </form>
      </section>

      {/* ---- Imports ---- */}
      <section>
        <h2 className="font-bold">آخر عمليات الاستيراد</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          {imports?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {imports.map((j) => (
                  <tr key={j.id} className="border-b border-[var(--line)] last:border-0">
                    <td dir="ltr" className="max-w-0 truncate px-4 py-3 text-[var(--ink)]/70">
                      {j.url}
                    </td>
                    <td className="w-32 px-4 py-3 font-medium">
                      {JOB_LABEL[j.status] ?? j.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-[var(--ink)]/50">
              لسه مفيش عمليات استيراد — جرّب اللينك الأول فوق.
            </p>
          )}
        </div>
      </section>

      {/* ---- Listings ---- */}
      <section>
        <h2 className="font-bold">منتجاتك</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          {listings?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-[var(--paper)] text-right text-[var(--ink)]/60">
                <tr>
                  <th className="px-4 py-2 font-medium">المنتج</th>
                  <th className="px-4 py-2 font-medium">سعر البيع</th>
                  <th className="px-4 py-2 font-medium">الربح المتوقع</th>
                  <th className="px-4 py-2 font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--line)] last:border-0">
                    <td className="px-4 py-3">{l.title_ar}</td>
                    <td className="px-4 py-3">
                      {Number(l.retail_price)} {l.currency}
                    </td>
                    <td className="px-4 py-3 text-[var(--teal)]">
                      +{(Number(l.retail_price) - Number(l.cost_snapshot)).toFixed(0)}{" "}
                      {l.currency}
                    </td>
                    <td className="px-4 py-3">{LISTING_LABEL[l.status] ?? l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-sm text-[var(--ink)]/50">مفيش منتجات لسه.</p>
          )}
        </div>
      </section>
    </div>
  );
}
