import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { computeRetail, parsePricingSteps, type PricingStep } from "@loqta/core";
import { api } from "../lib/api";

const STEP_META: Record<PricingStep["type"], { label: string; param: string; unit: string }> = {
  fx_buffer: { label: "هامش أمان للدولار", param: "pct", unit: "%" },
  margin_pct: { label: "هامش ربح", param: "pct", unit: "%" },
  add_fixed: { label: "مبلغ ثابت", param: "amount", unit: "ج" },
  min_profit: { label: "حد أدنى للربح", param: "amount", unit: "ج" },
  round_to_ending: { label: "تقريب نفسي (نهاية السعر)", param: "ending", unit: "" },
};

const SAMPLE_COSTS = [50, 150, 400, 1000];

interface Rule {
  id: string;
  name: string;
  steps: unknown;
}

export default function PricingRules() {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: ["pricing-rules"],
    queryFn: () => api<{ rules: Rule[] }>("/v1/pricing-rules"),
  });

  const [steps, setSteps] = useState<PricingStep[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const def = rules.data?.rules[0];
    if (def) setSteps(parsePricingSteps(def.steps));
  }, [rules.data]);

  const save = useMutation({
    mutationFn: () => api("/v1/pricing-rules", { method: "PUT", body: { steps } }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ["pricing-rules"] });
    },
  });

  const update = (i: number, value: number) => {
    setSteps((s) =>
      s.map((step, j) => {
        if (j !== i) return step;
        const key = STEP_META[step.type].param as "pct" | "amount" | "ending";
        return { ...step, [key]: value } as PricingStep;
      }),
    );
  };

  const move = (i: number, dir: -1 | 1) => {
    setSteps((s) => {
      const next = [...s];
      const j = i + dir;
      if (j < 0 || j >= next.length) return s;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };

  const addStep = (type: PricingStep["type"]) => {
    const defaults: Record<string, PricingStep> = {
      fx_buffer: { type: "fx_buffer", pct: 5 },
      margin_pct: { type: "margin_pct", pct: 30 },
      add_fixed: { type: "add_fixed", amount: 20 },
      min_profit: { type: "min_profit", amount: 50 },
      round_to_ending: { type: "round_to_ending", ending: 99 },
    };
    setSteps((s) => [...s, defaults[type]!]);
  };

  const paramOf = (s: PricingStep): number =>
    (s as unknown as Record<string, number>)[STEP_META[s.type].param]!;

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-xl font-bold">قاعدة التسعير 💰</h1>
      <p className="text-sm text-stone-500">
        الخطوات بتتنفذ بالترتيب على تكلفة المورد. أي منتج وضعه "تلقائي" بيتسعّر بيها.
      </p>

      <section className="space-y-2 rounded-xl border border-stone-200 bg-white p-5">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-stone-50 p-2">
            <span className="w-6 text-center text-xs text-stone-400">{i + 1}</span>
            <span className="flex-1 text-sm font-medium">{STEP_META[s.type].label}</span>
            <input
              value={paramOf(s)}
              onChange={(e) => update(i, Number(e.target.value) || 0)}
              inputMode="decimal"
              dir="ltr"
              className="w-20 rounded-lg border border-stone-300 p-1.5 text-center text-sm"
            />
            <span className="w-4 text-xs text-stone-400">{STEP_META[s.type].unit}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-stone-400 disabled:opacity-30">↑</button>
            <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="px-1 text-stone-400 disabled:opacity-30">↓</button>
            <button onClick={() => setSteps((x) => x.filter((_, j) => j !== i))} className="px-1 text-red-400">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          {(Object.keys(STEP_META) as PricingStep["type"][]).map((t) => (
            <button key={t} onClick={() => addStep(t)}
              className="rounded-full border border-dashed border-stone-300 px-3 py-1 text-xs text-stone-500 hover:border-amber-400">
              + {STEP_META[t].label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="mb-3 font-bold">معاينة فورية (تكلفة بالجنيه)</h2>
        <table className="w-full text-sm">
          <thead className="text-right text-stone-500">
            <tr><th className="pb-2">التكلفة</th><th className="pb-2">سعر البيع</th><th className="pb-2">ربحك</th></tr>
          </thead>
          <tbody>
            {SAMPLE_COSTS.map((cost) => {
              // same pure engine the worker uses - preview matches reality
              const r = computeRetail({ cost, steps });
              return (
                <tr key={cost} className="border-t border-stone-100">
                  <td className="py-2">{cost} ج</td>
                  <td className="py-2 font-bold">{r.retail} ج</td>
                  <td className="py-2 text-emerald-700">+{r.profit.toFixed(2)} ج</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={() => save.mutate()} disabled={save.isPending || steps.length === 0}
          className="rounded-lg bg-amber-500 px-6 py-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50">
          {save.isPending ? "لحظة..." : "حفظ القاعدة"}
        </button>
        {saved && <span className="text-sm text-emerald-700">تم الحفظ ✓ — المنتجات الجديدة هتتسعّر بيها</span>}
      </div>
    </div>
  );
}
