import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { trustTone, type TrustHistory } from "../lib/orderMeta";

interface Customer extends TrustHistory {
  phone: string;
  name: string | null;
  last_order_at: string;
  delivered_value: number;
}

const TONE: Record<string, { label: string; cls: string }> = {
  risky: { label: "محتاج انتباه", cls: "bg-red-50 text-red-700" },
  trusted: { label: "عميل موثوق", cls: "bg-emerald-50 text-emerald-700" },
  new: { label: "جديد", cls: "bg-stone-100 text-stone-600" },
  neutral: { label: "—", cls: "bg-stone-100 text-stone-500" },
};

export default function Customers() {
  const [search, setSearch] = useState("");

  const customers = useQuery({
    queryKey: ["customers", search],
    queryFn: () =>
      api<{ data: Customer[]; meta: { total: number } }>(
        `/v1/customers${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`,
      ),
  });

  const rows = customers.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">العملاء 👥</h1>
        <p className="mt-1 text-sm text-stone-500">
          كل رقم اشترى من متجرك وسجله معاك — يساعدك تقرر مين تثق فيه.
        </p>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ابحث برقم الموبايل..."
        dir="ltr"
        className="w-full max-w-xs rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none"
      />

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">العميل</th>
              <th className="p-3">الطلبات</th>
              <th className="p-3">مؤكد</th>
              <th className="p-3">ملغي</th>
              <th className="p-3">مرتجع</th>
              <th className="p-3">التقييم</th>
              <th className="p-3">آخر طلب</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const tone = trustTone(c);
              const t = TONE[tone]!;
              return (
                <tr key={c.phone} className="border-t border-stone-100">
                  <td className="p-3">
                    <span className="font-medium">{c.name || "—"}</span>
                    <a href={`tel:${c.phone}`} className="block text-xs text-stone-500" dir="ltr">{c.phone}</a>
                  </td>
                  <td className="p-3" dir="ltr">{c.total}</td>
                  <td className="p-3 text-emerald-700" dir="ltr">{c.confirmed}</td>
                  <td className="p-3 text-red-600" dir="ltr">{c.cancelled || ""}</td>
                  <td className="p-3 text-red-600" dir="ltr">{c.returned || ""}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${t.cls}`}>{t.label}</span>
                  </td>
                  <td className="p-3 text-stone-500">{new Date(c.last_order_at).toLocaleDateString("ar-EG")}</td>
                </tr>
              );
            })}
            {customers.data && rows.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-stone-400">
                {search.trim() ? "مفيش عميل بالرقم ده" : "لسه مفيش عملاء"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
