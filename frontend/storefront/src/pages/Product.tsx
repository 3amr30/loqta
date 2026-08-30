import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  ApiError,
  type PublicListing,
  type PublicVariant,
  type ReviewsBlock,
} from "../lib/api";
import { useStore } from "../StoreContext";
import { addToCart } from "../lib/cart";
import { trackAddToCart, trackViewContent } from "../lib/track";

interface ProductResponse {
  listing: PublicListing;
  variants: PublicVariant[];
  related: PublicListing[];
  reviews: ReviewsBlock;
}

function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="text-amber-500" aria-label={`${value} من 5`}>
      {"★".repeat(full)}
      <span className="text-stone-300">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export default function Product() {
  const { slug } = useParams<{ slug: string }>();
  const { store } = useStore();
  const navigate = useNavigate();
  const [data, setData] = useState<ProductResponse | null>(null);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [imgIdx, setImgIdx] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!store || !slug) return;
    setData(null);
    setImgIdx(0);
    setVariantId(undefined);
    api<ProductResponse>(`/v1/public/stores/${store.slug}/listings/${slug}`)
      .then((r) => {
        setData(r);
        document.title = `${r.listing.title_ar} — ${store.name}`;
        trackViewContent({
          id: r.listing.id,
          name: r.listing.title_ar,
          value: r.listing.retail_price,
          currency: r.listing.currency,
        });
      })
      .catch(() => setMissing(true));
  }, [store, slug]);

  if (missing) return <p className="py-16 text-center text-stone-400">المنتج غير موجود</p>;
  if (!data || !store) return <p className="py-16 text-center text-stone-400">جاري التحميل...</p>;

  const { listing, variants, related, reviews } = data;
  const selected = variants.find((v) => v.id === variantId);
  const price = selected?.retail_price ?? listing.retail_price;
  const inStock =
    listing.stock_status === "active" && (!selected || selected.stock_status === "active");
  const lowStock =
    inStock &&
    typeof listing.stock_qty === "number" &&
    listing.stock_qty > 0 &&
    listing.stock_qty <= store.low_stock_threshold;

  const add = () => {
    addToCart({
      listingId: listing.id,
      variantId,
      slug: listing.slug,
      title: listing.title_ar,
      variantTitle: selected?.title,
      image: selected?.image_url ?? listing.images[0],
      unitPrice: price,
    });
    trackAddToCart({ id: listing.id, name: listing.title_ar, value: price, currency: listing.currency });
    navigate("/cart");
  };

  const waLink =
    store.whatsapp_phone &&
    `https://wa.me/${store.whatsapp_phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
      `مرحبًا، عايز أستفسر عن: ${listing.title_ar}\n${window.location.href}`,
    )}`;

  return (
    <div className="space-y-4">
      <div>
        {listing.images[imgIdx] && (
          <img src={listing.images[imgIdx]} alt={listing.title_ar} className="aspect-square w-full rounded-2xl object-cover" />
        )}
        {listing.images.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {listing.images.map((img, i) => (
              <button key={i} onClick={() => setImgIdx(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${i === imgIdx ? "border-amber-500" : "border-transparent"}`}>
                <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <h1 className="text-lg font-bold">{listing.title_ar}</h1>
      {reviews.count > 0 && reviews.avg != null && (
        <p className="flex items-center gap-2 text-sm">
          <Stars value={reviews.avg} />
          <span className="text-stone-500">
            {reviews.avg.toFixed(1)} ({reviews.count} تقييم)
          </span>
        </p>
      )}
      <p className="text-2xl font-bold">
        {price} <span className="text-sm font-normal text-stone-500">{listing.currency}</span>
      </p>

      {lowStock && (
        <p className="inline-block rounded-lg bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
          باقي {listing.stock_qty} بس 🔥
        </p>
      )}

      {variants.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">اختر النوع</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id === variantId ? undefined : v.id)}
                disabled={v.stock_status !== "active"}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  v.id === variantId
                    ? "border-amber-500 bg-amber-50 font-bold text-amber-700"
                    : "border-stone-300"
                } disabled:line-through disabled:opacity-40`}
              >
                {v.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {listing.description_ar && (
        <p className="whitespace-pre-line text-sm leading-6 text-stone-600">{listing.description_ar}</p>
      )}

      <button
        onClick={add}
        disabled={!inStock || (variants.length > 0 && !variantId)}
        className="w-full rounded-xl bg-amber-500 p-4 font-bold text-white disabled:bg-stone-300"
      >
        {!inStock ? "غير متوفر حاليًا" : variants.length > 0 && !variantId ? "اختر النوع الأول" : "أضف إلى السلة 🛒"}
      </button>

      {waLink && (
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500 p-3 font-bold text-emerald-700"
        >
          💬 اسأل عن المنتج على واتساب
        </a>
      )}

      <Reviews slug={listing.slug} reviews={reviews} />

      {related.length > 0 && (
        <section className="pt-4">
          <h2 className="mb-3 font-bold">منتجات مشابهة</h2>
          <div className="grid grid-cols-3 gap-2">
            {related.map((r) => (
              <Link key={r.id} to={`/p/${r.slug}`} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                {r.images[0] ? (
                  <img src={r.images[0]} alt={r.title_ar} loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="aspect-square w-full bg-stone-100" />
                )}
                <p className="line-clamp-2 p-1.5 text-xs">{r.title_ar}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Reviews({ slug, reviews }: { slug: string; reviews: ReviewsBlock }) {
  const { store } = useStore();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ order_number: "", phone: "", rating: 5, name: "", comment: "" });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await api(`/v1/public/stores/${store!.slug}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingSlug: slug, ...form }),
      });
      setDone(true);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === "NOT_A_BUYER") setErr("مش لاقيين طلب بالرقم ده على المنتج — راجع رقم الطلب والموبايل.");
      else if (e2 instanceof ApiError && e2.code === "ALREADY_REVIEWED") setErr("قيّمت المنتج ده قبل كده.");
      else if (e2 instanceof ApiError && e2.status === 429) setErr("محاولات كتير — استنى دقيقة.");
      else setErr("حصلت مشكلة — جرّب تاني.");
    }
  };

  const input = "w-full rounded-lg border border-stone-300 p-2.5 text-sm focus:border-amber-500 focus:outline-none";

  return (
    <section className="border-t border-stone-200 pt-4">
      <h2 className="mb-3 font-bold">تقييمات العملاء {reviews.count > 0 && `(${reviews.count})`}</h2>

      {reviews.latest.length === 0 ? (
        <p className="text-sm text-stone-400">لسه مفيش تقييمات — كن أول واحد يقيّم بعد الشراء.</p>
      ) : (
        <ul className="space-y-3">
          {reviews.latest.map((r, i) => (
            <li key={i} className="rounded-lg bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.buyer_name}</span>
                <Stars value={r.rating} />
              </div>
              {r.comment && <p className="mt-1 text-sm text-stone-600">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {done ? (
        <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          شكرًا! تقييمك هيظهر بعد مراجعة صاحب المتجر.
        </p>
      ) : open ? (
        <form onSubmit={submit} className="mt-4 space-y-2 rounded-xl bg-white p-3">
          <p className="text-sm font-medium">قيّم بعد ما استلمت المنتج</p>
          <div className="flex gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} onClick={() => setForm((f) => ({ ...f, rating: n }))}
                className={n <= form.rating ? "text-amber-500" : "text-stone-300"}>
                ★
              </button>
            ))}
          </div>
          <input required placeholder="اسمك" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={input} />
          <input required placeholder="رقم الطلب (LQ-000000)" dir="ltr" value={form.order_number} onChange={(e) => setForm((f) => ({ ...f, order_number: e.target.value }))} className={`${input} text-left`} />
          <input required placeholder="رقم الموبايل المستخدم في الطلب" dir="ltr" inputMode="numeric" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={`${input} text-left`} />
          <textarea placeholder="رأيك في المنتج (اختياري)" rows={2} value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} className={input} />
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white">إرسال التقييم</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm">إلغاء</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-4 rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700">
          ✍️ قيّم المنتج (بعد الشراء)
        </button>
      )}
    </section>
  );
}
