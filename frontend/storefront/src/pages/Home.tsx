import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type PublicListing } from "../lib/api";
import { useStore } from "../StoreContext";

export default function Home() {
  const { store } = useStore();
  const [listings, setListings] = useState<PublicListing[] | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!store) return;
    const q = search.trim();
    const t = setTimeout(() => {
      setListings(null);
      const qs = q ? `?search=${encodeURIComponent(q)}` : "";
      void api<{ data: PublicListing[] }>(`/v1/public/stores/${store.slug}/listings${qs}`).then((r) =>
        setListings(r.data),
      );
    }, q ? 300 : 0); // debounce typed queries; initial load is immediate
    return () => clearTimeout(t);
  }, [store, search]);

  if (!store) return null;
  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="ابحث عن منتج..."
        className="w-full rounded-xl border border-stone-300 p-3 focus:border-amber-500 focus:outline-none"
      />
      {listings === null ? (
        <p className="py-16 text-center text-stone-400">جاري التحميل...</p>
      ) : listings.length === 0 ? (
        <p className="py-16 text-center text-stone-400">
          {search.trim() ? "مفيش نتائج للبحث ده" : "لسه مفيش منتجات في المتجر"}
        </p>
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
