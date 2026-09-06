import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EGYPT_GOVERNORATES } from "@loqta/core";
import { api } from "../lib/api";

interface Rate {
  governorate: string;
  fee: number;
  delivery_days: number | null;
}
type Row = { fee: string; days: string };

export default function Shipping() {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ["shipping-rates"],
    queryFn: () => api<{ default_fee: number; rates: Rate[] }>("/v1/shipping-rates"),
  });

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!current.data) return;
    const byGov: Record<string, Row> = {};
    for (const g of EGYPT_GOVERNORATES) byGov[g] = { fee: "", days: "" };
    for (const r of current.data.rates) {
      byGov[r.governorate] = {
        fee: String(r.fee),
        days: r.delivery_days == null ? "" : String(r.delivery_days),
      };
    }
    setRows(byGov);
  }, [current.data]);

  const save = useMutation({
    mutationFn: () => {
      const rates = EGYPT_GOVERNORATES.flatMap((g) => {
        const row = rows[g];
        if (!row || row.fee.trim() === "") return []; // blank => use store default
        return [
          {
            governorate: g,
            fee: Math.max(0, Number(row.fee) || 0),
            ...(row.days.trim() ? { delivery_days: Math.max(0, Number(row.days) || 0) } : {}),
          },
        ];
      });
      return api("/v1/shipping-rates", { method: "PUT", body: { rates } });
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ["shipping-rates"] });
    },
  });

  const set = (g: string, k: keyof Row, v: string) =>
    setRows((p) => ({ ...p, [g]: { ...(p[g] ?? { fee: "", days: "" }), [k]: v } }));

  if (!current.data) return <p className="text-stone-500">جاري التحميل...</p>;

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">الشحن حسب المحافظة 🚚</h1>
        <p className="mt-1 text-sm text-stone-500">
          سيبها فاضية عشان تستخدم رسوم الشحن الافتراضية ({current.data.default_fee} جنيه) — عدّلها من الإعدادات.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">المحافظة</th>
              <th className="p-3">رسوم الشحن (جنيه)</th>
              <th className="p-3">مدة التوصيل (أيام)</th>
            </tr>
          </thead>
          <tbody>
            {EGYPT_GOVERNORATES.map((g) => (
              <tr key={g} className="border-t border-stone-100">
                <td className="p-2 font-medium">{g}</td>
                <td className="p-2">
                  <input value={rows[g]?.fee ?? ""} onChange={(e) => set(g, "fee", e.target.value)}
                    dir="ltr" inputMode="numeric" placeholder="افتراضي"
                    className="w-24 rounded-lg border border-stone-300 p-2 text-left focus:border-amber-500 focus:outline-none" />
                </td>
                <td className="p-2">
                  <input value={rows[g]?.days ?? ""} onChange={(e) => set(g, "days", e.target.value)}
                    dir="ltr" inputMode="numeric" placeholder="—"
                    className="w-20 rounded-lg border border-stone-300 p-2 text-left focus:border-amber-500 focus:outline-none" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="rounded-lg bg-amber-500 px-6 py-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50">
          {save.isPending ? "لحظة..." : "حفظ أسعار الشحن"}
        </button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ ✓</span>}
      </div>
    </div>
  );
}
