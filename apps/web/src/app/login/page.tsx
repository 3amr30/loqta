"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-2xl font-bold">
        لقطة<span className="text-[var(--amber)]">.</span>
      </p>
      <h1 className="mt-8 text-2xl font-bold">تسجيل الدخول</h1>
      <p className="mt-2 text-[var(--ink)]/60">
        هنبعتلك لينك دخول على إيميلك — من غير باسورد.
      </p>

      {status === "sent" ? (
        <div className="mt-8 rounded-lg border border-[var(--teal)]/30 bg-[var(--teal)]/5 p-4">
          اتبعت اللينك ✅ — افتح إيميلك ودوس عليه للدخول.
        </div>
      ) : (
        <form onSubmit={sendLink} className="mt-8 flex flex-col gap-3">
          <input
            dir="ltr"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--teal)]"
          />
          <button
            disabled={status === "sending"}
            className="rounded-lg bg-[var(--teal)] px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {status === "sending" ? "ثواني..." : "ابعت لينك الدخول"}
          </button>
          {status === "error" && (
            <p className="text-sm text-red-600">حصلت مشكلة — جرب تاني.</p>
          )}
        </form>
      )}
    </main>
  );
}
