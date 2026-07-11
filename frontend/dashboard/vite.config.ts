import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Source-map upload runs ONLY when SENTRY_AUTH_TOKEN is present;
// builds never fail without it (spec §7).
const sentry = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT ?? "loqta-dashboard",
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
  build: { sourcemap: Boolean(process.env.SENTRY_AUTH_TOKEN) },
  server: { port: 5173 },
});
