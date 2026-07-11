import { Link, useParams } from "react-router";

export default function Success() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
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
