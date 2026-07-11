import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-2xl font-bold tracking-tight">
        لقطة<span className="text-[var(--amber)]">.</span>
      </p>

      <h1 className="mt-10 text-4xl font-bold leading-snug md:text-5xl">
        الصق لينك المنتج من المورد…
        <br />
        <span className="text-[var(--teal)]">واتفرج على متجرك بيتبني.</span>
      </h1>

      <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--ink)]/70">
        لقطة بتسحب بيانات المنتج أوتوماتيك، بتحسب سعر البيع بهامش ربحك، وبتتابع
        سعر المورد والمخزون بالنيابة عنك. موردين محليين، شحن سريع، ودفع عند
        الاستلام من أول يوم.
      </p>

      <div className="mt-10 flex gap-3">
        <Link
          href="/dashboard"
          className="rounded-lg bg-[var(--teal)] px-6 py-3 font-semibold text-white transition hover:opacity-90"
        >
          افتح لوحة التحكم
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-[var(--line)] px-6 py-3 font-semibold transition hover:bg-white"
        >
          تسجيل الدخول
        </Link>
      </div>

      <p className="mt-16 text-sm text-[var(--ink)]/50">
        Scaffold — Phase 1 قيد التنفيذ
      </p>
    </main>
  );
}
