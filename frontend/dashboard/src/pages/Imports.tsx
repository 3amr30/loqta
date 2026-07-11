import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { POLL_INTERVALS } from "../lib/constants";
import { StatusBadge } from "../components/StatusBadge";

const Schema = z.object({ url: z.string().url("الصق رابط منتج صحيح") });
type Form = z.infer<typeof Schema>;

interface ImportJob {
  id: string;
  url: string;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  listing_id: string | null;
  duplicate: boolean;
  created_at: string;
}

export default function Imports() {
  const qc = useQueryClient();
  const { register, handleSubmit, formState, reset, setError } = useForm<Form>({
    resolver: zodResolver(Schema),
  });

  const jobs = useQuery({
    queryKey: ["imports"],
    queryFn: () => api<{ data: ImportJob[] }>("/v1/imports"),
    refetchInterval: POLL_INTERVALS.imports,
  });

  const create = useMutation({
    mutationFn: (body: Form) => api("/v1/imports", { method: "POST", body }),
    onSuccess: () => {
      reset();
      void qc.invalidateQueries({ queryKey: ["imports"] });
    },
    onError: (err) => {
      let message = "حصلت مشكلة — جرّب تاني.";
      if (err instanceof ApiError && err.code === "UNSUPPORTED_URL") {
        message = "المنصة دي غير مدعومة.";
      } else if (err instanceof ApiError && err.code === "UNSAFE_URL") {
        message = "الرابط ده غير مسموح.";
      }
      setError("url", { message });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">استيراد منتج</h1>
      <form
        onSubmit={handleSubmit((b) => create.mutate(b))}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          {...register("url")}
          dir="ltr"
          placeholder="https://supplier.com/products/..."
          className="flex-1 rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-amber-500 px-6 py-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {create.isPending ? "لحظة..." : "استورد"}
        </button>
      </form>
      {formState.errors.url && (
        <p className="text-sm text-red-600">{formState.errors.url.message}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-right text-stone-500">
            <tr>
              <th className="p-3">الرابط</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {(jobs.data?.data ?? []).map((j) => (
              <tr key={j.id} className="border-t border-stone-100">
                <td className="max-w-xs truncate p-3 text-left" dir="ltr">
                  {j.url}
                </td>
                <td className="p-3">
                  <StatusBadge status={j.status} />
                  {j.duplicate && (
                    <span className="ms-2 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                      موجود من قبل
                    </span>
                  )}
                  {j.error && <p className="mt-1 text-xs text-red-600">{j.error}</p>}
                </td>
                <td className="p-3 text-stone-500">
                  {new Date(j.created_at).toLocaleString("ar-EG")}
                </td>
              </tr>
            ))}
            {jobs.data && jobs.data.data.length === 0 && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-stone-400">
                  الصق رابط منتج من موقع المورد وسيظهر هنا
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
