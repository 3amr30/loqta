import { Link } from "react-router";
import { setQty, useCart } from "../lib/cart";
import { useStore } from "../StoreContext";

export default function Cart() {
  const items = useCart();
  const { store } = useStore();
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const shipping = store?.shipping_fee ?? 0;

  if (items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="mb-4 text-stone-400">سلتك فاضية 🛒</p>
        <Link to="/" className="font-bold text-amber-600">ارجع للتسوق</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">السلة</h1>
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={`${i.listingId}:${i.variantId ?? ""}`} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-3">
            {i.image && <img src={i.image} alt="" className="h-16 w-16 rounded-lg object-cover" />}
            <div className="flex-1">
              <Link to={`/p/${i.slug}`} className="text-sm font-medium">{i.title}</Link>
              {i.variantTitle && <p className="text-xs text-stone-500">{i.variantTitle}</p>}
              <p className="mt-1 text-sm font-bold">{i.unitPrice * i.qty} {store?.currency}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setQty(i, i.qty - 1)} className="h-8 w-8 rounded-full border border-stone-300">−</button>
              <span className="w-5 text-center text-sm">{i.qty}</span>
              <button onClick={() => setQty(i, Math.min(i.qty + 1, 20))} className="h-8 w-8 rounded-full border border-stone-300">+</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-1 rounded-xl bg-white p-4 text-sm border border-stone-200">
        <div className="flex justify-between"><span>المجموع</span><span>{subtotal} {store?.currency}</span></div>
        <div className="flex justify-between"><span>الشحن</span><span>{shipping} {store?.currency}</span></div>
        <div className="flex justify-between border-t border-stone-100 pt-2 font-bold"><span>الإجمالي</span><span>{subtotal + shipping} {store?.currency}</span></div>
      </div>

      <Link to="/checkout" className="block w-full rounded-xl bg-amber-500 p-4 text-center font-bold text-white">
        إتمام الطلب — الدفع عند الاستلام
      </Link>
    </div>
  );
}
