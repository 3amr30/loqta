import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server.ts", worker: "src/worker.ts" },
  format: "esm",
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  // @loqta/core points at TS source (workspace convention) - inline it.
  noExternal: ["@loqta/core"],
});
