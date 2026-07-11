import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";

const Schema = z.object({
  name: z.string().trim().min(1, "اكتب اسم المتجر").max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "3-40 حرف: أحرف إنجليزية صغيرة وأرقام وشرطات"),
});
type Form = z.infer<typeof Schema>;

export default function Onboarding() {
  const qc = useQueryClient();
  const { register, handleSubmit, formState, setError, watch } = useForm<Form>({
    resolver: zodResolver(Schema),
  });

  const onSubmit = handleSubmit(async (body) => {
    try {
      await api("/v1/stores", { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === "SLUG_TAKEN"
          ? "الاسم المختصر ده محجوز — جرّب غيره."
          : "حصلت مشكلة — جرّب تاني.";
      setError("slug", { message });
    }
  });

  const slug = watch("slug") ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-bold">أنشئ متجرك 🏪</h1>
        <p className="mb-6 text-sm text-stone-500">خطوة واحدة وتبدأ تستورد منتجات</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">اسم المتجر</label>
            <input
              {...register("name")}
              placeholder="متجر أحمد"
              className="w-full rounded-lg border border-stone-300 p-3 focus:border-amber-500 focus:outline-none"
            />
            {formState.errors.name && (
              <p className="mt-1 text-sm text-red-600">{formState.errors.name.message}</p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الاسم المختصر (رابط المتجر)</label>
            <input
              {...register("slug")}
              dir="ltr"
              placeholder="ahmed-store"
              className="w-full rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-stone-400" dir="ltr">
              {slug || "your-store"}.loqta.shop
            </p>
            {formState.errors.slug && (
              <p className="mt-1 text-sm text-red-600">{formState.errors.slug.message}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={formState.isSubmitting}
            className="w-full rounded-lg bg-amber-500 p-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {formState.isSubmitting ? "لحظة..." : "أنشئ المتجر"}
          </button>
        </form>
      </div>
    </main>
  );
}
