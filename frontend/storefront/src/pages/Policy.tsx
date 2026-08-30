import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../lib/api";
import { useStore } from "../StoreContext";

const VALID = ["refund", "shipping", "privacy"] as const;
type PolicyType = (typeof VALID)[number];

export default function Policy() {
  const { type } = useParams<{ type: string }>();
  const { store } = useStore();
  const [policy, setPolicy] = useState<{ title: string; body: string } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!store || !type) return;
    if (!VALID.includes(type as PolicyType)) {
      setMissing(true);
      return;
    }
    api<{ policy: { title: string; body: string } }>(
      `/v1/public/stores/${store.slug}/policies/${type}`,
    )
      .then((r) => {
        setPolicy(r.policy);
        document.title = `${r.policy.title} — ${store.name}`;
      })
      .catch(() => setMissing(true));
  }, [store, type]);

  if (missing) return <p className="py-16 text-center text-stone-400">الصفحة غير موجودة</p>;
  if (!policy) return <p className="py-16 text-center text-stone-400">جاري التحميل...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{policy.title}</h1>
      <p className="whitespace-pre-line text-sm leading-7 text-stone-700">{policy.body}</p>
      <Link to="/" className="inline-block pt-2 text-sm font-bold text-amber-600">
        ← ارجع للتسوق
      </Link>
    </div>
  );
}
