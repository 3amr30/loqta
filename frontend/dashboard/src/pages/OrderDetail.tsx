import { useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { confirmationMeta, trustTone, type ConfirmationStatus, type TrustHistory } from "../lib/orderMeta";
import type { Order } from "./Orders";

interface Item {
  id: string;
  title_snapshot: string;
  variant_snapshot: string | null;
  qty: number;
  unit_price: number;
  unit_cost_snapshot: number;
  supplier_name: string | null;
  supplier_whatsapp: string | null;
}

interface Detail {
  order: Order & {
    shipping_address: { line?: string; notes?: string | null };
    subtotal: number;
    shipping_fee: number;
    total_cost: number;
    notes: string | null;
    discount_code: string | null;
    discount_amount: number;
    whatsapp_confirmation_status: ConfirmationStatus;
    whatsapp_confirmed_at: string | null;
  };
  items: Item[];
  nextStatuses: string[];
  customerHistory: TrustHistory;
  trustNote: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: "تأكيد الطلب ✓",
  fulfilled: "تم التجهيز 📦",
  shipped: "خرج للشحن 🛵",
  delivered: "تم التوصيل 🎉",
  cancelled: "إلغاء ✗",
  returned: "مرتجع ↩",
};

function whatsappLink(item: Item, order: Detail["order"]): string | null {
  if (!item.supplier_whatsapp) return null;
  const phone = item.supplier_whatsapp.replace(/[^\d]/g, "");
  const text = [
    `طلب جديد ${order.order_number}`,
    `المنتج: ${item.title_snapshot}${item.variant_snapshot ? ` (${item.variant_snapshot})` : ""}`,
    `الكمية: ${item.qty}`,
    `التوصيل: ${order.governorate ?? ""} — ${order.shipping_address?.line ?? ""}`,
    `العميل: ${order.customer_name} ${order.customer_phone}`,
  ].join("\n");
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tracking, setTracking] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<Detail>(`/v1/orders/${id}`),
  });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/orders/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["order", id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (detail.isLoading) return <p className="text-stone-500">جاري التحميل...</p>;
  const d = detail.data;
  if (!d) return <p className="text-red-600">الطلب غير موجود</p>;
  const o = d.order;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" dir="ltr">{o.order_number}</h1>
        <StatusBadge status={o.status} />
      </div>

      {(() => {
        const cm = confirmationMeta(o.whatsapp_confirmation_status);
        const tone = trustTone(d.customerHistory);
        if (!cm && tone === "new") return null;
        return (
          <section className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white p-4">
            {cm && (
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${cm.cls}`}>
                واتساب: {cm.label}
                {o.whatsapp_confirmed_at && ` · ${new Date(o.whatsapp_confirmed_at).toLocaleString("ar-EG")}`}
              </span>
            )}
            {d.trustNote && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  tone === "risky"
                    ? "bg-red-50 text-red-700"
                    : tone === "trusted"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-stone-100 text-stone-600"
                }`}
              >
                {tone === "risky" ? "⚠️ " : ""}
                {d.trustNote}
              </span>
            )}
          </section>
        );
      })()}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-2 font-bold">العميل</h2>
        <p>{o.customer_name} — <a href={`tel:${o.customer_phone}`} className="text-amber-600" dir="ltr">{o.customer_phone}</a></p>
        <p className="mt-1 text-sm text-stone-600">{o.governorate} — {o.shipping_address?.line}</p>
        {o.shipping_address?.notes && <p className="mt-1 text-sm text-stone-500">ملاحظات: {o.shipping_address.notes}</p>}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">المنتجات</h2>
        <ul className="space-y-3">
          {d.items.map((it) => {
            const wa = whatsappLink(it, o);
            return (
              <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium">{it.qty}× {it.title_snapshot}{it.variant_snapshot && ` (${it.variant_snapshot})`}</p>
                  <p className="text-xs text-stone-500">
                    بيع {it.unit_price} — تكلفة {it.unit_cost_snapshot}
                    {it.supplier_name && ` — المورد: ${it.supplier_name}`}
                  </p>
                </div>
                {wa && (
                  <a href={wa} target="_blank" rel="noreferrer"
                     className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600">
                    واتساب المورد 💬
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
          <div className="flex justify-between"><span>المجموع</span><span>{o.subtotal} {o.currency}</span></div>
          {o.discount_amount > 0 && (
            <div className="flex justify-between text-emerald-700">
              <span>خصم{o.discount_code ? ` (${o.discount_code})` : ""}</span>
              <span dir="ltr">−{o.discount_amount} {o.currency}</span>
            </div>
          )}
          <div className="flex justify-between"><span>الشحن</span><span>{o.shipping_fee} {o.currency}</span></div>
          <div className="flex justify-between font-bold"><span>الإجمالي (COD)</span><span>{o.total} {o.currency}</span></div>
          <div className="flex justify-between text-emerald-700"><span>الربح الصافي (من اللقطات)</span><span>+{o.profit} {o.currency}</span></div>
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">الحالة والشحن</h2>
        <div className="flex flex-wrap gap-2">
          {d.nextStatuses.map((s) => (
            <button key={s} onClick={() => patch.mutate({ status: s })} disabled={patch.isPending}
              className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                s === "cancelled" || s === "returned" ? "bg-red-500 hover:bg-red-600" : "bg-amber-500 hover:bg-amber-600"
              }`}>
              {STATUS_LABEL[s] ?? s}
            </button>
          ))}
          {d.nextStatuses.length === 0 && <p className="text-sm text-stone-400">الطلب في حالته النهائية</p>}
        </div>
        <div className="mt-4 flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">رقم الشحنة (تتبع)</label>
            <input
              value={tracking ?? o.tracking_number ?? ""}
              onChange={(e) => setTracking(e.target.value)}
              dir="ltr"
              className="w-full rounded-lg border border-stone-300 p-2.5 text-left focus:border-amber-500 focus:outline-none"
            />
          </div>
          <button
            onClick={() => patch.mutate({ tracking_number: tracking || null })}
            disabled={patch.isPending || tracking === null}
            className="rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50 disabled:opacity-50"
          >
            حفظ
          </button>
        </div>
      </section>
    </div>
  );
}
