import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./dashboard/actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-xl font-bold">
            لقطة<span className="text-[var(--amber)]">.</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span dir="ltr" className="text-[var(--ink)]/60">
              {user.email}
            </span>
            <form action={signOut}>
              <button className="rounded-md border border-[var(--line)] px-3 py-1.5 transition hover:bg-[var(--paper)]">
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
