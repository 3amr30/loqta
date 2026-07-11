import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface Store {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  whatsapp_phone: string | null;
  sync_policy: "pause_only" | "auto_apply" | "require_approval";
  settings: {
    shipping_fee?: number;
    notify?: { email_new_order?: boolean; whatsapp_new_order?: boolean };
  };
}

const POLICIES = [
  {
    value: "pause_only",
    title: "الوضع الآمن (موصى به)",
    desc: "لو المنتج خلص عند المورد يتوقف تلقائيًا. تغيّر السعر يوصلك إشعار وانت تقرر.",
  },
  {
    value: "auto_apply",
    title: "تحديث تلقائي",
    desc: "لو سعر المورد اتغيّر، سعر البيع يتحدث تلقائيًا حسب قاعدة التسعير + يوصلك إشعار.",
  },
  {
    value: "require_approval",
    title: "موافقة يدوية",
    desc: "أي تغيير يوصلك إشعار بس — محدش يلمس أسعارك أو منتجاتك غيرك.",
  },
] as const;

export default function Settings() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ store: Store }>("/v1/me") });

  const [name, setName] = useState("");
  const [logo, setLogo] = useState("");
  const [fee, setFee] = useState("0");
  const [policy, setPolicy] = useState<Store["sync_policy"]>("pause_only");
  const [wa, setWa] = useState("");
  const [emailNewOrder, setEmailNewOrder] = useState(true);
  const [waNewOrder, setWaNewOrder] = useState(false);
  const [saved, setSaved] = useState(false);

  const store = me.data?.store;
  useEffect(() => {
    if (store) {
      setName(store.name);
      setLogo(store.logo_url ?? "");
      setFee(String(store.settings?.shipping_fee ?? 0));
      setPolicy(store.sync_policy);
      setWa(store.whatsapp_phone ?? "");
      setEmailNewOrder(store.settings?.notify?.email_new_order ?? true);
      setWaNewOrder(store.settings?.notify?.whatsapp_new_order ?? false);
    }
  }, [store]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/stores", {
        method: "PATCH",
        body: {
          name,
          logo_url: logo || null,
          sync_policy: policy,
          whatsapp_phone: wa || null,
          settings: {
            shipping_fee: Math.max(0, Number(fee) || 0),
            notify: { email_new_order: emailNewOrder, whatsapp_new_order: waNewOrder },
          },
        },
      }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ["me"] });
    },
  });

  if (!store) return <p className="text-stone-500">جاري التحميل...</p>;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">إعدادات المتجر ⚙️</h1>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <label className="mb-1 block text-sm font-medium">اسم المتجر</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-stone-300 p-3 focus:border-amber-500 focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">رابط اللوجو (اختياري)</label>
          <input value={logo} onChange={(e) => setLogo(e.target.value)} dir="ltr" placeholder="https://..."
            className="w-full rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">رسوم الشحن الثابتة (جنيه)</label>
          <input value={fee} onChange={(e) => setFee(e.target.value)} inputMode="numeric" dir="ltr"
            className="w-36 rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none" />
          <p className="mt-1 text-xs text-stone-400">بتتضاف على كل طلب دفع عند الاستلام.</p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold">التنبيهات 🔔</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">رقم واتساب المتجر (بصيغة دولية)</label>
          <input value={wa} onChange={(e) => setWa(e.target.value)} dir="ltr" placeholder="+201012345678"
            className="w-56 rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none" />
          <p className="mt-1 text-xs text-stone-400">بتوصلك عليه تنبيهات الطلبات لو فعّلتها، وهيظهر كزرار تواصل في متجرك قريبًا.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={emailNewOrder} onChange={(e) => setEmailNewOrder(e.target.checked)} className="accent-amber-500" />
          إيميل عند وصول طلب جديد
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={waNewOrder} onChange={(e) => setWaNewOrder(e.target.checked)} className="accent-amber-500" />
          رسالة واتساب عند وصول طلب جديد
        </label>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-1 font-bold">لما المورد يغيّر السعر أو المخزون؟</h2>
        <p className="mb-3 text-xs text-stone-500">في كل الحالات: المنتج اللي يخلص من المورد بيتوقف تلقائيًا، واللي يرجع متوفر مش بيتفعّل لوحده أبدًا.</p>
        <div className="space-y-2">
          {POLICIES.map((p) => (
            <label key={p.value}
              className={`block cursor-pointer rounded-xl border p-4 ${policy === p.value ? "border-amber-500 bg-amber-50/50" : "border-stone-200"}`}>
              <input type="radio" name="policy" value={p.value} checked={policy === p.value}
                onChange={() => setPolicy(p.value)} className="ms-0 me-2 accent-amber-500" />
              <span className="font-medium">{p.title}</span>
              <p className="mt-1 pr-6 text-sm text-stone-500">{p.desc}</p>
            </label>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="rounded-lg bg-amber-500 px-6 py-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50">
          {save.isPending ? "لحظة..." : "حفظ الإعدادات"}
        </button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ ✓</span>}
      </div>
    </div>
  );
}
