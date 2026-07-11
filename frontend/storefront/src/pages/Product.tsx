import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, type PublicListing, type PublicVariant } from "../lib/api";
import { useStore } from "../StoreContext";
import { addToCart } from "../lib/cart";

export default function Product() {
  const { slug } = useParams<{ slug: string }>();
  const { store } = useStore();
  const navigate = useNavigate();
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [variants, setVariants] = useState<PublicVariant[]>([]);
  const [variantId, setVariantId] = useState<string | undefined>();
  const [imgIdx, setImgIdx] = useState(0);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!store || !slug) return;
    api<{ listing: PublicListing; variants: PublicVariant[] }>(
      `/v1/public/stores/${store.slug}/listings/${slug}`,
    )
      .then((r) => {
        setListing(r.listing);
        setVariants(r.variants);
        document.title = `${r.listing.title_ar} — ${store.name}`;
      })
      .catch(() => setMissing(true));
  }, [store, slug]);

  if (missing) return <p className="py-16 text-center text-stone-400">المنتج غير موجود</p>;
  if (!listing || !store) return <p className="py-16 text-center text-stone-400">جاري التحميل...</p>;

  const selected = variants.find((v) => v.id === variantId);
  const price = selected?.retail_price ?? listing.retail_price;
  const inStock =
    listing.stock_status === "active" && (!selected || selected.stock_status === "active");

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
    navigate("/cart");
  };

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
      <p className="text-2xl font-bold">
        {price} <span className="text-sm font-normal text-stone-500">{listing.currency}</span>
      </p>

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
    </div>
  );
}
