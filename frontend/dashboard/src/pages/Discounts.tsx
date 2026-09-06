import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface Discount {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_subtotal: number | null;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  active: boolean;
}

export default function Discounts() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["discounts"],
    queryFn: () => api<{ data: Discount[] }>("/v1/discounts"),
  });

  const [form, setForm] = useState({ code: "", type: "percent", value: "", max_uses: "", min_subtotal: "" });
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      setErr(null);
      return api("/v1/discounts", {
        method: "POST",
        body: {
          code: form.code.trim(),
          type: form.type,
          value: Number(form.value),
          ...(form.max_uses.trim() ? { max_uses: Number(form.max_uses) } : {}),
          ...(form.min_subtotal.trim() ? { min_subtotal: Number(form.min_subtotal) } : {}),
        },
      });
    },
    onSuccess: () => {
      setForm({ code: "", type: "percent", value: "", max_uses: "", min_subtotal: "" });
      void qc.invalidateQueries({ queryKey: ["discounts"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "CODE_TAKEN") setErr("الكود ده مستخدم بالفعل.");
      else if (e instanceof ApiError && e.code === "VALIDATION_ERROR") setErr(e.message);
      else setErr("راجع البيانات وجرّب تاني.");
    },
  });

  const toggle = useMutation({
    mutationFn: (d: Discount) => api(`/v1/discounts/${d.id}`, { method: "PATCH", body: { active: !d.active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["discounts"] }),
  });

  const input = "rounded-lg border border-stone-300 p-2.5 text-sm focus:border-amber-500 focus:outline-none";
  const rows = list.data?.data ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-xl font-bold">أكواد الخصم 🏷️</h1>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">كود جديد</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            placeholder="الكود (SALE20)" dir="ltr" className={`${input} text-left`} />
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={input}>
            <option value="percent">نسبة %</option>
            <option value="fixed">مبلغ ثابت</option>
          </select>
          <input value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            placeholder={form.type === "percent" ? "القيمة %" : "القيمة (جنيه)"} dir="ltr" inputMode="numeric" className={`${input} text-left`} />
          <input value={form.min_subtotal} onChange={(e) => setForm((f) => ({ ...f, min_subtotal: e.target.value }))}
            placeholder="أقل مبلغ (اختياري)" dir="ltr" inputMode="numeric" className={`${input} text-left`} />
          <input value={form.max_uses} onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
            placeholder="أقصى استخدام (اختياري)" dir="ltr" inputMode="numeric" className={`${input} text-left`} />
          <button onClick={() => create.mutate()} disabled={create.isPending || !form.code.trim() || !form.value.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 font-bold text-white hover:bg-amber-600 disabled:opacity-50">
            إنشاء
          </button>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </section>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">الكود</th>
              <th className="p-3">الخصم</th>
              <th className="p-3">الاستخدام</th>
              <th className="p-3">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-stone-100">
                <td className="p-3 font-bold" dir="ltr">{d.code}</td>
                <td className="p-3">{d.type === "percent" ? `${d.value}%` : `${d.value} جنيه`}
                  {d.min_subtotal ? <span className="text-xs text-stone-400"> (فوق {d.min_subtotal})</span> : null}</td>
                <td className="p-3" dir="ltr">{d.used_count}{d.max_uses ? ` / ${d.max_uses}` : ""}</td>
                <td className="p-3">
                  <button onClick={() => toggle.mutate(d)} disabled={toggle.isPending}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${d.active ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>
                    {d.active ? "مفعّل" : "موقوف"}
                  </button>
                </td>
              </tr>
            ))}
            {list.data && rows.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-stone-400">مفيش أكواد خصم لسه</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
