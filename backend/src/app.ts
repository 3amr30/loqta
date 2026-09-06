import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config";
import { registerErrorHandler } from "./plugins/error-handler";
import { registerAuth } from "./plugins/auth";
import { registerStaticTenants } from "./plugins/static-tenants";
import { meRoutes } from "./routes/v1/me";
import { storesRoutes } from "./routes/v1/stores";
import { importsRoutes } from "./routes/v1/imports";
import { listingsRoutes } from "./routes/v1/listings";
import { pricingRoutes } from "./routes/v1/pricing";
import { publicRoutes } from "./routes/v1/public";
import { monitoringRoutes } from "./routes/v1/monitoring";
import { ordersRoutes } from "./routes/v1/orders";
import { notificationsRoutes } from "./routes/v1/notifications";
import { aiRoutes } from "./routes/v1/ai";
import { statsRoutes } from "./routes/v1/stats";
import { priceChangesRoutes } from "./routes/v1/price-changes";
import { webhookRoutes } from "./routes/v1/webhooks";
import { reviewsRoutes } from "./routes/v1/reviews";
import { shippingRoutes } from "./routes/v1/shipping";
import { discountsRoutes } from "./routes/v1/discounts";

/** App factory - server.ts wires it to the network; tests use inject(). */
export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });

  const origins = config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  if (origins.length > 0) {
    await app.register(cors, { origin: origins });
  }
  await app.register(rateLimit, { global: false });
  await app.register(formbody); // Twilio webhooks post application/x-www-form-urlencoded

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
  publicRoutes(app);
  monitoringRoutes(app);
  ordersRoutes(app);
  notificationsRoutes(app);
  aiRoutes(app);
  statsRoutes(app);
  priceChangesRoutes(app);
  webhookRoutes(app, config);
  reviewsRoutes(app);
  shippingRoutes(app);
  discountsRoutes(app);

  // Built SPA locations: <repo>/frontend/*/dist relative to backend/.
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  registerStaticTenants(app, config, {
    dashboardDist: `${repoRoot}frontend/dashboard/dist`,
    storefrontDist: `${repoRoot}frontend/storefront/dist`,
  });

  return app;
}
