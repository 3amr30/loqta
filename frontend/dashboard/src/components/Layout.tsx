import { NavLink, Outlet } from "react-router";
import { supabase } from "../lib/supabase";

const NAV = [
  { to: "/", label: "الاستيراد" },
  { to: "/listings", label: "المنتجات" },
];

export function Layout({ storeName }: { storeName: string }) {
  return (
    <div className="flex min-h-screen bg-stone-50">
      <aside className="flex w-56 flex-col border-l border-stone-200 bg-white p-4">
        <h1 className="mb-1 text-xl font-bold">
          لقطة<span className="text-amber-500">.</span>
        </h1>
        <p className="mb-6 truncate text-sm text-stone-500">{storeName}</p>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm ${
                  isActive ? "bg-amber-50 font-bold text-amber-700" : "hover:bg-stone-50"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="rounded-lg px-3 py-2 text-right text-sm text-stone-500 hover:bg-stone-50"
        >
          تسجيل الخروج
        </button>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
