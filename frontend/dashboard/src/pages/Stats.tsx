import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Overview {
  totals: { orders: number; revenue: number; cost: number; profit: number };
  daily: { date: string; orders: string; revenue: number; profit: number }[];
  topProducts: { listing_id: string; title: string; qty: number; revenue: number }[];
}

export default function Stats() {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["stats", days],
    queryFn: () => api<Overview>(`/v1/stats/overview?days=${days}`),
  });
  const d = q.data;
  const maxRevenue = Math.max(1, ...(d?.daily ?? []).map((x) => x.revenue));

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الإحصائيات 📊</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-stone-300 p-2 text-sm">
          <option value={7}>آخر أسبوع</option>
          <option value={30}>آخر شهر</option>
          <option value={90}>آخر ٣ شهور</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "الطلبات", value: d?.totals.orders ?? "—", cls: "" },
          { label: "المبيعات", value: d ? `${d.totals.revenue} ج` : "—", cls: "" },
          { label: "التكلفة", value: d ? `${d.totals.cost} ج` : "—", cls: "text-stone-500" },
          { label: "صافي الربح", value: d ? `${d.totals.profit} ج` : "—", cls: "text-emerald-700" },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-xs text-stone-500">{c.label}</p>
            <p className={`mt-1 text-xl font-bold ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-400">الربح محسوب من تكلفة المورد وقت كل طلب (مش السعر الحالي).</p>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">المبيعات اليومية</h2>
        {(d?.daily ?? []).length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">مفيش مبيعات في الفترة دي</p>
        ) : (
          <div className="flex h-40 items-end gap-1">
            {d!.daily.map((day) => (
              <div key={String(day.date)} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-amber-400 transition-colors group-hover:bg-amber-500"
                  style={{ height: `${Math.max(4, (day.revenue / maxRevenue) * 150)}px` }}
                />
                <div className="pointer-events-none absolute bottom-full right-1/2 z-10 mb-1 hidden translate-x-1/2 whitespace-nowrap rounded bg-stone-800 px-2 py-1 text-xs text-white group-hover:block">
                  {new Date(day.date).toLocaleDateString("ar-EG")} — {day.revenue} ج (ربح {day.profit})
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">الأكثر مبيعًا</h2>
        {(d?.topProducts ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-400">لسه</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {d!.topProducts.map((p, i) => (
              <li key={p.listing_id ?? i} className="flex items-center justify-between">
                <span>{i + 1}. {p.title}</span>
                <span className="text-stone-500">{p.qty} قطعة — {p.revenue} ج</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
