import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initSentry, Sentry } from "./sentry";
import App from "./App";

initSentry();

const queryClient = new QueryClient();

function ErrorFallback() {
  return (
    <main style={{ padding: 32, textAlign: "center" }}>
      <h1>حصلت مشكلة غير متوقعة</h1>
      <p>جرّب تحديث الصفحة — لو المشكلة استمرت كلمنا.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
