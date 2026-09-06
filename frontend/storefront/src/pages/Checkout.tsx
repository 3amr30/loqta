import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { EGYPT_GOVERNORATES } from "@loqta/core";
import { api, ApiError } from "../lib/api";
import { clearCart, useCart } from "../lib/cart";
import { useStore } from "../StoreContext";
import { trackInitiateCheckout } from "../lib/track";

const Schema = z.object({
  name: z.string().trim().min(2, "اكتب اسمك").max(80),
  phone: z.string().regex(/^01[0-9]{9}$/, "رقم موبايل مصري: 01xxxxxxxxx"),
  governorate: z.enum(EGYPT_GOVERNORATES, { message: "اختر المحافظة" }),
  address: z.string().trim().min(5, "اكتب العنوان بالتفصيل").max(300),
  notes: z.string().max(500).optional(),
});
type Form = z.infer<typeof Schema>;

export default function Checkout() {
  const items = useCart();
  const { store } = useStore();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(Schema) });

  // InitiateCheckout fires once when a non-empty cart reaches this page.
  useEffect(() => {
    if (!store || items.length === 0) return;
    const value = items.reduce((s, i) => s + i.unitPrice * i.qty, 0) + store.shipping_fee;
    const count = items.reduce((s, i) => s + i.qty, 0);
    trackInitiateCheckout({ value, currency: store.currency, numItems: count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.slug]);

  if (!store) return null;
  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-stone-400">مفيش حاجة في السلة</p>
        <Link to="/" className="font-bold text-amber-600">ارجع للتسوق</Link>
      </div>
    );
  }

  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const total = subtotal + store.shipping_fee;

  const onSubmit = handleSubmit(async (customer) => {
    setServerError(null);
    try {
      const res = await api<{ orderNumber: string; total: number }>(
        `/v1/public/stores/${store.slug}/checkout`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer,
            items: items.map((i) => ({
              listingId: i.listingId,
              ...(i.variantId ? { variantId: i.variantId } : {}),
              qty: i.qty,
            })),
            ...(code.trim() ? { discount_code: code.trim() } : {}),
          }),
        },
      );
      clearCart();
      navigate(`/success/${res.orderNumber}`, { state: { total: res.total } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "OUT_OF_STOCK") {
        setServerError("للأسف في منتج خلص من المخزون — راجع السلة.");
      } else if (err instanceof ApiError && err.code === "LISTING_UNAVAILABLE") {
        setServerError("في منتج لم يعد متاحًا — راجع السلة.");
      } else if (err instanceof ApiError && err.code?.startsWith("DISCOUNT_")) {
        setServerError(err.message || "كود الخصم غير صالح.");
      } else if (err instanceof ApiError && err.status === 429) {
        setServerError("محاولات كتير — استنى دقيقة وجرّب تاني.");
      } else {
        setServerError("حصلت مشكلة — جرّب تاني.");
      }
    }
  });

  const input = "w-full rounded-lg border border-stone-300 p-3 focus:border-amber-500 focus:outline-none";
  const err = (m?: string) => m && <p className="mt-1 text-sm text-red-600">{m}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">بيانات التوصيل</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <input {...register("name")} placeholder="الاسم بالكامل" className={input} />
          {err(formState.errors.name?.message)}
        </div>
        <div>
          <input {...register("phone")} placeholder="01xxxxxxxxx" dir="ltr" inputMode="numeric" className={`${input} text-left`} />
          {err(formState.errors.phone?.message)}
        </div>
        <div>
          <select {...register("governorate")} defaultValue="" className={input}>
            <option value="" disabled>المحافظة</option>
            {EGYPT_GOVERNORATES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          {err(formState.errors.governorate?.message)}
        </div>
        <div>
          <textarea {...register("address")} placeholder="العنوان بالتفصيل (الشارع، رقم العمارة، الدور...)" rows={3} className={input} />
          {err(formState.errors.address?.message)}
        </div>
        <textarea {...register("notes")} placeholder="ملاحظات (اختياري)" rows={2} className={input} />

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="كود خصم (اختياري)"
          dir="ltr"
          className={`${input} text-left`}
        />

        <div className="rounded-xl bg-white p-4 text-sm border border-stone-200 space-y-1">
          <div className="flex justify-between text-stone-500">
            <span>المنتجات</span>
            <span>{subtotal} {store.currency}</span>
          </div>
          <div className="flex justify-between text-stone-500">
            <span>الشحن</span>
            <span>{store.shipping_fee} {store.currency}</span>
          </div>
          {code.trim() && (
            <p className="text-xs text-stone-400">
              الخصم بيتطبق ويتأكد بعد الضغط على تأكيد الطلب.
            </p>
          )}
          <div className="flex justify-between border-t border-stone-100 pt-1 font-bold">
            <span>الإجمالي (دفع عند الاستلام)</span>
            <span>{total} {store.currency}</span>
          </div>
        </div>

        {serverError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{serverError}</p>}

        <button
          type="submit"
          disabled={formState.isSubmitting}
          className="w-full rounded-xl bg-amber-500 p-4 font-bold text-white disabled:opacity-50"
        >
          {formState.isSubmitting ? "لحظة..." : "تأكيد الطلب 🛵"}
        </button>
      </form>
    </div>
  );
}
