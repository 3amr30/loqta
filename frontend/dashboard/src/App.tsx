import { createBrowserRouter, RouterProvider } from "react-router";

// P0 placeholder - real routes (login, onboarding, imports, listings,
// orders, pricing, stats, settings) land from P2 onward.
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <main className="flex min-h-screen items-center justify-center">
        <h1 className="text-2xl font-bold">
          لقطة<span className="text-amber-500">.</span> — لوحة التاجر قيد الإنشاء
        </h1>
      </main>
    ),
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
