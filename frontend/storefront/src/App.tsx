import { createBrowserRouter, RouterProvider } from "react-router";

// P0 placeholder - real routes ("/", "/p/:slug", "/cart", "/checkout",
// "/success/:orderNumber") land in P3.
const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <main className="flex min-h-screen items-center justify-center">
        <h1 className="text-xl font-bold">المتجر قيد التجهيز 🛍️</h1>
      </main>
    ),
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
