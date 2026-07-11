import * as Sentry from "@sentry/node";
import { scrubSentryEvent } from "@loqta/core";

/**
 * One Sentry init for both backend surfaces (api + worker).
 * PII rule: every event passes the shared @loqta/core scrubber -
 * Egyptian phone numbers, emails, and customer_* fields never leave.
 * Without SENTRY_DSN this is a no-op (dev-friendly).
 */
export function initSentry(surface: "api" | "worker") {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    release: process.env.SENTRY_RELEASE ?? process.env.GITHUB_SHA,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
  });
  Sentry.setTag("surface", surface);
}

export { Sentry };
