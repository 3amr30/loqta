import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Config } from "./config";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerAuth } from "./plugins/auth";
import { meRoutes } from "./routes/v1/me";
import { storesRoutes } from "./routes/v1/stores";
import { importsRoutes } from "./routes/v1/imports";
import { listingsRoutes } from "./routes/v1/listings";
import { pricingRoutes } from "./routes/v1/pricing";

/** App factory - server.ts wires it to the network; tests use inject(). */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.length > 0) {
    await app.register(cors, { origin: origins });
  }

  registerErrorHandler(app);
  registerAuth(app, config);

  app.get("/healthz", async () => ({
    ok: true,
    version: process.env.SENTRY_RELEASE ?? process.env.GITHUB_SHA ?? "dev",
  }));

  meRoutes(app);
  storesRoutes(app);
  importsRoutes(app);
  listingsRoutes(app);
  pricingRoutes(app);

  return app;
}
