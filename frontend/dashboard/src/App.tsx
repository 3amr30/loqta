import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { api } from "./lib/api";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import AuthConfirm from "./pages/AuthConfirm";
import Onboarding from "./pages/Onboarding";
import Imports from "./pages/Imports";
import Listings from "./pages/Listings";
import ListingEdit from "./pages/ListingEdit";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Settings from "./pages/Settings";
import PricingRules from "./pages/PricingRules";
import Stats from "./pages/Stats";

interface Me {
  profile: { id: string; full_name: string };
  store: { id: string; name: string; slug: string } | null;
  plan: { id: string; name_ar: string };
}

function Protected() {
  const { session, loading } = useAuth();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/v1/me"),
    enabled: !!session,
  });

  if (loading || (session && me.isLoading)) {
    return <p className="p-8 text-center text-stone-500">جاري التحميل...</p>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (me.isError) {
    return <p className="p-8 text-center text-red-600">تعذر الاتصال بالخادم — حدّث الصفحة.</p>;
  }
  if (!me.data?.store) return <Onboarding />;

  return (
    <Routes>
      <Route element={<Layout storeName={me.data.store.name} />}>
        <Route index element={<Imports />} />
        <Route path="listings" element={<Listings />} />
        <Route path="listings/:id" element={<ListingEdit />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="pricing" element={<PricingRules />} />
        <Route path="stats" element={<Stats />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/confirm" element={<AuthConfirm />} />
          <Route path="/*" element={<Protected />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
