import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

interface PriceChange {
  id: string;
  listing_id: string;
  title_ar: string;
  old_cost: number;
  new_cost: number;
  cost_currency: string;
  old_retail: number;
  proposed_retail: number | null;
  current_retail: number;
  price_mode: "rule" | "manual";
  created_at: string;
}

export default function PriceChanges() {
  const qc = useQueryClient();

  const pending = useQuery({
    queryKey: ["price-changes"],
    queryFn: () => api<{ data: PriceChange[] }>("/v1/price-changes?status=pending"),
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      api(`/v1/price-changes/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["price-changes"] });
      void qc.invalidateQueries({ queryKey: ["listings"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "SUPERSEDED") {
        // A newer supplier change replaced this row — refresh shows it.
        void qc.invalidateQueries({ queryKey: ["price-changes"] });
      }
    },
  });

  const rows = pending.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">موافقات الأسعار ⚖️</h1>
        <p className="mt-1 text-sm text-stone-500">
          تغييرات أسعار الموردين المستنية قرارك — الموافقة بتطبّق قاعدة التسعير على التكلفة الجديدة، والتجاهل بيسيب سعرك زي ما هو.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">المنتج</th>
              <th className="p-3">تكلفة المورد</th>
              <th className="p-3">سعر البيع الحالي</th>
              <th className="p-3">السعر المقترح</th>
              <th className="p-3">التاريخ</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const up = c.new_cost > c.old_cost;
              return (
                <tr key={c.id} className="border-t border-stone-100">
                  <td className="max-w-xs truncate p-3 font-medium">{c.title_ar}</td>
                  <td className="p-3" dir="ltr">
                    <span className="text-stone-400">{c.old_cost}</span>
                    <span className={`mx-1 font-bold ${up ? "text-red-600" : "text-emerald-700"}`}>
                      ← {c.new_cost}
                    </span>
                    <span className="text-xs text-stone-400">{c.cost_currency}</span>
                  </td>
                  <td className="p-3" dir="ltr">{c.current_retail}</td>
                  <td className="p-3 font-bold" dir="ltr">
                    {c.proposed_retail ?? "—"}
                  </td>
                  <td className="p-3 text-stone-500">
                    {new Date(c.created_at).toLocaleString("ar-EG")}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => act.mutate({ id: c.id, action: "approve" })}
                        disabled={act.isPending}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        طبّق السعر
                      </button>
                      <button
                        onClick={() => act.mutate({ id: c.id, action: "reject" })}
                        disabled={act.isPending}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-50"
                      >
                        تجاهل
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {pending.data && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-stone-400">
                  مفيش تغييرات أسعار مستنية موافقتك 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
