import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../lib/supabase";

const Schema = z.object({ email: z.string().email("بريد إلكتروني غير صحيح") });
type Form = z.infer<typeof Schema>;

export default function Login() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(Schema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) setError("تعذر إرسال الرابط — جرّب تاني بعد دقيقة.");
    else setSent(true);
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold">
          لقطة<span className="text-amber-500">.</span>
        </h1>
        <p className="mb-6 text-sm text-stone-500">سجّل دخولك برابط سحري على بريدك</p>
        {sent ? (
          <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">
            اتبعت لك رابط الدخول 📩 — افتح بريدك واضغط عليه.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              {...register("email")}
              type="email"
              dir="ltr"
              placeholder="you@example.com"
              className="w-full rounded-lg border border-stone-300 p-3 text-left focus:border-amber-500 focus:outline-none"
            />
            {formState.errors.email && (
              <p className="text-sm text-red-600">{formState.errors.email.message}</p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={formState.isSubmitting}
              className="w-full rounded-lg bg-amber-500 p-3 font-bold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {formState.isSubmitting ? "لحظة..." : "ابعت لي الرابط"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
