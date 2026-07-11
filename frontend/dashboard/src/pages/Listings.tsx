import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

export interface Listing {
  id: string;
  slug: string;
  title_ar: string;
  images: string[];
  currency: string;
  retail_price: number;
  cost_snapshot: number;
  profit: number;
  price_mode: "rule" | "manual";
  status: "draft" | "active" | "paused" | "archived";
  stock_status: string;
}

export default function Listings() {
  const qc = useQueryClient();
  const listings = useQuery({
    queryKey: ["listings"],
    queryFn: () => api<{ data: Listing[] }>("/v1/listings"),
  });

  const toggle = useMutation({
    mutationFn: (l: Listing) =>
      api(`/v1/listings/${l.id}`, {
        method: "PATCH",
        body: { status: l.status === "active" ? "paused" : "active" },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["listings"] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">منتجاتك</h1>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">المنتج</th>
              <th className="p-3">سعر البيع</th>
              <th className="p-3">الربح</th>
              <th className="p-3">المخزون</th>
              <th className="p-3">الحالة</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(listings.data?.data ?? []).map((l) => (
              <tr key={l.id} className="border-t border-stone-100">
                <td className="p-3">
                  <Link
                    to={`/listings/${l.id}`}
                    className="flex items-center gap-3 hover:text-amber-600"
                  >
                    {l.images[0] && (
                      <img
                        src={l.images[0]}
                        alt=""
                        loading="lazy"
                        className="h-10 w-10 rounded-lg object-cover"
                      />
                    )}
                    <span className="font-medium">{l.title_ar}</span>
                  </Link>
                </td>
                <td className="p-3">
                  {l.retail_price} {l.currency}
                </td>
                <td className="p-3 text-emerald-700">+{l.profit.toFixed(0)}</td>
                <td className="p-3">
                  <StatusBadge status={l.stock_status} />
                </td>
                <td className="p-3">
                  <StatusBadge status={l.status} />
                </td>
                <td className="p-3">
                  <button
                    onClick={() => toggle.mutate(l)}
                    disabled={toggle.isPending || l.status === "archived"}
                    className="rounded-lg border border-stone-300 px-3 py-1 text-xs hover:bg-stone-50"
                  >
                    {l.status === "active" ? "إيقاف" : "نشر"}
                  </button>
                </td>
              </tr>
            ))}
            {listings.data && listings.data.data.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-stone-400">
                  لسه مفيش منتجات — ابدأ من صفحة الاستيراد
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
