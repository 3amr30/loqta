import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Sentry release = git SHA (GITHUB_SHA in CI, "dev" locally).
    __SENTRY_RELEASE__: JSON.stringify(process.env.GITHUB_SHA ?? "dev"),
  },
  server: { port: 5173 },
});
