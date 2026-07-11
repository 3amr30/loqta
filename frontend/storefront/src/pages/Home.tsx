import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type PublicListing } from "../lib/api";
import { useStore } from "../StoreContext";

export default function Home() {
  const { store } = useStore();
  const [listings, setListings] = useState<PublicListing[] | null>(null);

  useEffect(() => {
    if (!store) return;
    void api<{ data: PublicListing[] }>(`/v1/public/stores/${store.slug}/listings`).then((r) =>
      setListings(r.data),
    );
  }, [store]);

  if (!store) return null;
  return (
    <div className="space-y-4">
      {listings === null ? (
        <p className="py-16 text-center text-stone-400">جاري التحميل...</p>
      ) : listings.length === 0 ? (
        <p className="py-16 text-center text-stone-400">لسه مفيش منتجات في المتجر</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {listings.map((l) => (
            <Link
              key={l.id}
              to={`/p/${l.slug}`}
              className="overflow-hidden rounded-xl border border-stone-200 bg-white"
            >
              {l.images[0] ? (
                <img src={l.images[0]} alt={l.title_ar} loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square w-full bg-stone-100" />
              )}
              <div className="p-2">
                <p className="line-clamp-2 text-sm">{l.title_ar}</p>
                <p className="mt-1 font-bold">
                  {l.retail_price} <span className="text-xs font-normal">{l.currency}</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
