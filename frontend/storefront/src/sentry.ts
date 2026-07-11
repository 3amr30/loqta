import * as Sentry from "@sentry/react";
import { scrubSentryEvent } from "@loqta/core";

/**
 * Storefront Sentry - stays ANONYMOUS (no setUser, ever; buyers are not
 * accounts). Will post through the /v1/monitoring tunnel from P3 so
 * ad-blockers do not eat events. DSN-less init is a no-op.
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
