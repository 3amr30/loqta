import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { supabase } from "../lib/supabase";

/**
 * Magic-link landing (ported flow from the old Next.js confirm route):
 * verifies token_hash from the email link, then enters the app.
 */
export default function AuthConfirm() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token_hash = params.get("token_hash");
    const type = params.get("type");
    if (!token_hash || type !== "email") {
      setFailed(true);
      return;
    }
    void supabase.auth
      .verifyOtp({ token_hash, type: "email" })
      .then(({ error }) => (error ? setFailed(true) : navigate("/", { replace: true })));
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      {failed ? (
        <p className="text-red-600">الرابط غير صالح أو انتهت صلاحيته — اطلب رابط جديد.</p>
      ) : (
        <p className="text-stone-500">جاري تسجيل الدخول...</p>
      )}
    </main>
  );
}
