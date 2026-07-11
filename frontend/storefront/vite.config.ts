import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __SENTRY_RELEASE__: JSON.stringify(process.env.GITHUB_SHA ?? "dev"),
  },
  // Manifest lets scripts/check-bundle-size.mjs measure the true initial
  // JS graph (entry + static imports) and exclude lazy chunks like Sentry.
  build: { manifest: true },
  server: { port: 5174 },
});
