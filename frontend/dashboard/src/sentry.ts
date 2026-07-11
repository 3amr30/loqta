import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "@loqta/core";

/**
 * Dashboard Sentry. Sentry.setUser({ id: merchantId }) is called after
 * login (P2) - id only, never email/phone. Every event passes the shared
 * @loqta/core PII scrubber. DSN-less init is a no-op.
 */
export function initSentry() {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: __SENTRY_RELEASE__,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export { Sentry };
