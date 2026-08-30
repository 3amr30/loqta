import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router";
import { trackPurchase } from "../lib/track";
import { useStore } from "../StoreContext";

export default function Success() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const { store } = useStore();
  const location = useLocation();

  // Purchase pixel fires here only — the order already exists server-side.
  // value/total come via router state from the checkout response.
  useEffect(() => {
    const total = (location.state as { total?: number } | null)?.total;
    if (orderNumber && typeof total === "number") {
      trackPurchase({ orderNumber, value: total, currency: store?.currency ?? "EGP" });
    }
  }, [orderNumber, location.state, store]);

  return (
    <div className="py-16 text-center">
      <p className="mb-2 text-5xl">🎉</p>
      <h1 className="mb-2 text-xl font-bold">تم استلام طلبك!</h1>
      <p className="mb-1 text-stone-600">رقم الطلب</p>
      <p className="mb-6 text-2xl font-bold tracking-wider" dir="ltr">{orderNumber}</p>
      <p className="mb-8 text-sm text-stone-500">هنتواصل معاك على الموبايل لتأكيد الطلب — الدفع كاش عند الاستلام.</p>
      <Link to="/" className="font-bold text-amber-600">متابعة التسوق</Link>
    </div>
  );
}
