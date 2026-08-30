import { BrowserRouter, Link, Route, Routes } from "react-router";
import { StoreProvider, useStore } from "./StoreContext";
import { useCart } from "./lib/cart";
import Home from "./pages/Home";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Success from "./pages/Success";
import Policy from "./pages/Policy";

function Shell() {
  const { store, loading, error } = useStore();
  const items = useCart();
  const count = items.reduce((s, i) => s + i.qty, 0);

  if (loading) return <p className="py-24 text-center text-stone-400">جاري التحميل...</p>;
  if (error || !store) {
    return <p className="py-24 text-center text-stone-500">{error ?? "المتجر غير موجود"}</p>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-stone-50 px-4 pb-24">
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between bg-stone-50/95 px-4 py-3 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold">
          {store.logo_url && <img src={store.logo_url} alt="" className="h-8 w-8 rounded-full object-cover" />}
          {store.name}
        </Link>
        <Link to="/cart" className="relative rounded-full bg-white p-2 shadow-sm">
          🛒
          {count > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              {count}
            </span>
          )}
        </Link>
      </header>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p/:slug" element={<Product />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/success/:orderNumber" element={<Success />} />
        <Route path="/pages/:type" element={<Policy />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <footer className="mt-10 border-t border-stone-200 pt-4 text-center text-xs text-stone-400">
        <nav className="flex justify-center gap-4">
          <Link to="/pages/shipping">الشحن</Link>
          <Link to="/pages/refund">الاسترجاع</Link>
          <Link to="/pages/privacy">الخصوصية</Link>
        </nav>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </StoreProvider>
  );
}
