import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const sentry = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT ?? "loqta-storefront",
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.GITHUB_SHA },
      }),
    ]
  : [];

export default defineConfig({
  plugins: [react(), tailwindcss(), ...sentry],
  define: {
    __SENTRY_RELEASE__: JSON.stringify(process.env.GITHUB_SHA ?? "dev"),
  },
  // Manifest lets scripts/check-bundle-size.mjs measure the true initial
  // JS graph (entry + static imports) and exclude lazy chunks like Sentry.
  build: { manifest: true, sourcemap: Boolean(process.env.SENTRY_AUTH_TOKEN) },
  server: { port: 5174 },
});
