import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./index.css";
import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Sentry is lazy-loaded as an async chunk: the SDK (+ browser tracing) is
// ~50KB gz and must not count against the 150KB *initial* JS budget.
void import("./sentry").then((m) => m.initSentry());

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
