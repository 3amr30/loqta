import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./index.css";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Sentry is lazy-loaded as an async chunk: the SDK (+ browser tracing) is
// ~50KB gz and must not count against the 150KB *initial* JS budget.
//
// Early-error gap cover: between first paint and the chunk resolving, a
// synchronous error would be lost. Buffer window errors + unhandled
// rejections immediately, flush into Sentry once it initializes (Sentry's
// own global handlers take over from there).
const earlyErrors: unknown[] = [];
const onEarlyError = (e: ErrorEvent) => earlyErrors.push(e.error ?? e.message);
const onEarlyRejection = (e: PromiseRejectionEvent) => earlyErrors.push(e.reason);
window.addEventListener("error", onEarlyError);
window.addEventListener("unhandledrejection", onEarlyRejection);

void import("./sentry").then((m) => {
  m.initSentry();
  window.removeEventListener("error", onEarlyError);
  window.removeEventListener("unhandledrejection", onEarlyRejection);
  for (const err of earlyErrors) m.Sentry.captureException(err);
  earlyErrors.length = 0;
});

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    void import("./sentry").then((m) => m.Sentry.captureException(error));
  }

  render() {
    if (this.state.failed) {
      return (
        <main style={{ padding: 32, textAlign: "center" }}>
          <h1>حصلت مشكلة غير متوقعة</h1>
          <p>جرّب تحديث الصفحة.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
