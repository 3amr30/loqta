import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import type { Listing } from "./Listings";

interface Detail {
  listing: Listing & {
    title_en: string | null;
    description_ar: string | null;
    description_en: string | null;
  };
  variants: Array<{
    id: string;
    title: string;
    retail_price: number | null;
    source_price: number | null;
    stock_status: string;
    is_enabled: boolean;
  }>;
  sourceProduct: {
    price: number;
    currency: string;
    stock_status: string;
    last_synced_at: string | null;
    source_url: string;
  } | null;
}

interface Preview {
  retail: number;
  effectiveCost: number;
  profit: number;
  trace: string[];
  fxStale: boolean;
}

export default function ListingEdit() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["listing", id],
    queryFn: () => api<Detail>(`/v1/listings/${id}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/listings/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["listing", id] });
      void qc.invalidateQueries({ queryKey: ["listings"] });
    },
  });

  // AI rewrite: enqueue, then poll the listing until the worker flips
  // ai_generated (or we give up after ~90s). Content refreshes in place.
  const [rewriting, setRewriting] = useState(false);
  const rewrite = useMutation({
    mutationFn: () => api(`/v1/listings/${id}/ai-rewrite`, { method: "POST" }),
    onSuccess: () => {
      setRewriting(true);
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        void qc.invalidateQueries({ queryKey: ["listing", id] });
        const fresh = qc.getQueryData<Detail>(["listing", id]);
        if ((fresh?.listing as { ai_generated?: boolean } | undefined)?.ai_generated || tries > 18) {
          clearInterval(timer);
          setRewriting(false);
        }
      }, 5000);
    },
  });

  const l = detail.data?.listing;
  const sp = detail.data?.sourceProduct;

  const [titleAr, setTitleAr] = useState("");
  const [descAr, setDescAr] = useState("");
  const [retail, setRetail] = useState<string>("");

  useEffect(() => {
    if (l) {
      setTitleAr(l.title_ar);
      setDescAr(l.description_ar ?? "");
      setRetail(String(l.retail_price));
    }
  }, [l]);

  // Live rule-pricing preview from the CURRENT supplier cost.
  const preview = useQuery({
    queryKey: ["preview", sp?.price, sp?.currency],
    queryFn: () =>
      api<Preview>("/v1/pricing/preview", {
        method: "POST",
        body: { cost: sp!.price, currency: sp!.currency },
      }),
    enabled: !!sp,
  });

  if (detail.isLoading) return <p className="text-stone-500">جاري التحميل...</p>;
  if (!l) return <p className="text-red-600">المنتج غير موجود</p>;

  const retailNum = Number(retail);
  const manualProfit = Number.isFinite(retailNum) ? retailNum - l.cost_snapshot : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">تعديل المنتج</h1>
        <StatusBadge status={l.status} />
      </div>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <label className="block text-sm font-medium">العنوان</label>
        <input
          value={titleAr}
          onChange={(e) => setTitleAr(e.target.value)}
          className="w-full rounded-lg border border-stone-300 p-3 focus:border-amber-500 focus:outline-none"
        />
        <label className="block text-sm font-medium">الوصف</label>
        <textarea
          value={descAr}
          onChange={(e) => setDescAr(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-stone-300 p-3 focus:border-amber-500 focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => patch.mutate({ title_ar: titleAr, description_ar: descAr || null })}
            disabled={patch.isPending}
            className="rounded-lg bg-amber-500 px-5 py-2 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            حفظ المحتوى
          </button>
          <button
            onClick={() => rewrite.mutate()}
            disabled={rewrite.isPending || rewriting}
            className="rounded-lg border border-amber-300 px-5 py-2 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
          >
            {rewriting ? "جاري التحسين... ✨" : "✨ تحسين بالذكاء الاصطناعي"}
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold">التسعير</h2>
        {sp && (
          <p className="text-sm text-stone-500">
            سعر المورد الحالي: {sp.price} {sp.currency} — <StatusBadge status={sp.stock_status} />
          </p>
        )}
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">سعر البيع ({l.currency})</label>
            <input
              value={retail}
              onChange={(e) => setRetail(e.target.value)}
              inputMode="decimal"
              dir="ltr"
              className="w-36 rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none"
            />
          </div>
          {manualProfit !== null && (
            <p className={`pb-3 text-sm font-medium ${manualProfit > 0 ? "text-emerald-700" : "text-red-600"}`}>
              الربح المتوقع: {manualProfit.toFixed(2)} {l.currency}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => patch.mutate({ retail_price: retailNum })}
            disabled={patch.isPending || !Number.isFinite(retailNum) || retailNum <= 0}
            className="rounded-lg bg-amber-500 px-5 py-2 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            حفظ سعر يدوي
          </button>
          <button
            onClick={() => patch.mutate({ price_mode: "rule" })}
            disabled={patch.isPending}
            className="rounded-lg border border-stone-300 px-5 py-2 hover:bg-stone-50"
          >
            سعّر بالقاعدة تلقائيًا
          </button>
        </div>
        {preview.data && (
          <div className="rounded-lg bg-stone-50 p-4 text-sm">
            <p className="mb-1 font-medium">
              لو سعّرت بالقاعدة: {preview.data.retail} {l.currency}
              <span className="text-emerald-700"> (ربح {preview.data.profit.toFixed(2)})</span>
              {preview.data.fxStale && (
                <span className="text-amber-700"> — تنبيه: سعر الصرف قديم</span>
              )}
            </p>
            <ol className="list-inside list-decimal text-xs text-stone-500" dir="ltr">
              {preview.data.trace.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {detail.data && detail.data.variants.length > 0 && (
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="mb-3 font-bold">المقاسات والألوان</h2>
          <ul className="space-y-2 text-sm">
            {detail.data.variants.map((v) => (
              <li key={v.id} className="flex items-center justify-between">
                <span>{v.title}</span>
                <span className="flex items-center gap-2">
                  {v.retail_price ?? l.retail_price} {l.currency}
                  <StatusBadge status={v.stock_status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
