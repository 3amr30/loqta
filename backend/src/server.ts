import "dotenv/config";
import Fastify from "fastify";
import { initSentry, Sentry } from "./lib/sentry";

initSentry("api");

const app = Fastify({ logger: true });

app.get("/healthz", async () => ({ ok: true }));

// Consistent error envelope; the full error-handler plugin lands in P1.
app.setErrorHandler((err, req, reply) => {
  Sentry.captureException(err, { tags: { route: req.url } });
  req.log.error(err);
  reply.status(500).send({ error: { code: "INTERNAL", message: "Internal server error" } });
});

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
