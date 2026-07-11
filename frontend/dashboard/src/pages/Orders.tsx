import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, apiBlob, saveBlob } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

export interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  governorate: string | null;
  status: string;
  currency: string;
  total: number;
  profit: number;
  tracking_number: string | null;
  created_at: string;
  item_count?: string;
}

const TABS = [
  { key: "", label: "الكل" },
  { key: "pending", label: "جديد" },
  { key: "confirmed", label: "مؤكد" },
  { key: "fulfilled", label: "تم التجهيز" },
  { key: "shipped", label: "في الشحن" },
  { key: "delivered", label: "تم التوصيل" },
];

export default function Orders() {
  const [status, setStatus] = useState("");
  const [downloading, setDownloading] = useState(false);

  const orders = useQuery({
    queryKey: ["orders", status],
    queryFn: () =>
      api<{ data: Order[] }>(`/v1/orders${status ? `?status=${status}` : ""}`),
  });

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      // Bearer-authenticated fetch -> blob; a plain <a href> would 401.
      const blob = await apiBlob(`/v1/orders/export.csv${status ? `?status=${status}` : ""}`);
      saveBlob(blob, "loqta-orders.csv");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الطلبات 📦</h1>
        <button
          onClick={() => void downloadCsv()}
          disabled={downloading}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 disabled:opacity-50"
        >
          {downloading ? "لحظة..." : "تصدير CSV ⬇"}
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm ${
              status === t.key ? "bg-amber-500 font-bold text-white" : "bg-white border border-stone-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">الطلب</th>
              <th className="p-3">العميل</th>
              <th className="p-3">المحافظة</th>
              <th className="p-3">الإجمالي</th>
              <th className="p-3">الربح</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {(orders.data?.data ?? []).map((o) => (
              <tr key={o.id} className="border-t border-stone-100 hover:bg-stone-50">
                <td className="p-3">
                  <Link to={`/orders/${o.id}`} className="font-bold text-amber-600" dir="ltr">
                    {o.order_number}
                  </Link>
                </td>
                <td className="p-3">
                  {o.customer_name}
                  <a href={`tel:${o.customer_phone}`} className="block text-xs text-stone-500" dir="ltr">
                    {o.customer_phone}
                  </a>
                </td>
                <td className="p-3">{o.governorate}</td>
                <td className="p-3 font-medium">{o.total} {o.currency}</td>
                <td className="p-3 text-emerald-700">+{o.profit}</td>
                <td className="p-3"><StatusBadge status={o.status} /></td>
                <td className="p-3 text-stone-500">{new Date(o.created_at).toLocaleDateString("ar-EG")}</td>
              </tr>
            ))}
            {orders.data && orders.data.data.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-stone-400">مفيش طلبات هنا</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
