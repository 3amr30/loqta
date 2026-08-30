import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Review {
  id: string;
  listing_id: string;
  listing_title: string;
  rating: number;
  comment: string | null;
  buyer_name: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

const TABS = [
  { key: "pending", label: "بانتظار المراجعة" },
  { key: "approved", label: "منشورة" },
  { key: "rejected", label: "مرفوضة" },
] as const;

export default function Reviews() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");

  const reviews = useQuery({
    queryKey: ["reviews", tab],
    queryFn: () => api<{ data: Review[] }>(`/v1/reviews?status=${tab}`),
  });

  const moderate = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) =>
      api(`/v1/reviews/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["reviews"] }),
  });

  const rows = reviews.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">التقييمات ⭐</h1>
        <p className="mt-1 text-sm text-stone-500">
          كل تقييم من عميل اشترى فعلًا — راجعه قبل ما يظهر في المتجر.
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm ${
              tab === t.key ? "bg-amber-500 font-bold text-white" : "bg-white border border-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.listing_title}</span>
              <span className="text-amber-500">{"★".repeat(r.rating)}<span className="text-stone-300">{"★".repeat(5 - r.rating)}</span></span>
            </div>
            <p className="mt-1 text-sm text-stone-500">{r.buyer_name} · {new Date(r.created_at).toLocaleDateString("ar-EG")}</p>
            {r.comment && <p className="mt-2 text-sm text-stone-700">{r.comment}</p>}
            {tab === "pending" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => moderate.mutate({ id: r.id, status: "approved" })}
                  disabled={moderate.isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  نشر
                </button>
                <button
                  onClick={() => moderate.mutate({ id: r.id, status: "rejected" })}
                  disabled={moderate.isPending}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50 disabled:opacity-50"
                >
                  رفض
                </button>
              </div>
            )}
          </div>
        ))}
        {reviews.data && rows.length === 0 && (
          <p className="rounded-xl border border-stone-200 bg-white p-8 text-center text-stone-400">
            مفيش تقييمات هنا
          </p>
        )}
      </div>
    </div>
  );
}
