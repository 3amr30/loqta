const STYLES: Record<string, { label: string; cls: string }> = {
  queued: { label: "في الانتظار", cls: "bg-stone-100 text-stone-600" },
  processing: { label: "جاري الاستيراد", cls: "bg-blue-50 text-blue-700" },
  done: { label: "تم", cls: "bg-emerald-50 text-emerald-700" },
  failed: { label: "فشل", cls: "bg-red-50 text-red-700" },
  draft: { label: "مسودة", cls: "bg-stone-100 text-stone-600" },
  active: { label: "منشور", cls: "bg-emerald-50 text-emerald-700" },
  paused: { label: "موقوف", cls: "bg-amber-50 text-amber-700" },
  archived: { label: "مؤرشف", cls: "bg-stone-100 text-stone-500" },
  out_of_stock: { label: "نفد من المورد", cls: "bg-red-50 text-red-700" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { label: status, cls: "bg-stone-100 text-stone-600" };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}
