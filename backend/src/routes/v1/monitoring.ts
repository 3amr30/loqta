import type { FastifyInstance } from "fastify";

/**
 * Sentry tunnel (optional per spec §7): the storefront posts envelopes
 * here so ad-blockers don't eat them. We forward to the DSN's ingest
 * host — nothing is parsed beyond the envelope header, nothing stored.
 */
export function monitoringRoutes(app: FastifyInstance) {
  // Raw body needed — envelopes are newline-delimited JSON, not JSON.
  app.addContentTypeParser("application/x-sentry-envelope", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    "/v1/monitoring",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = req.body as Buffer | string;
      const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      const headerLine = raw.slice(0, raw.indexOf("\n"));

      let dsn: URL;
      try {
        dsn = new URL(JSON.parse(headerLine).dsn);
      } catch {
        return reply.status(400).send({ error: { code: "BAD_ENVELOPE", message: "Invalid envelope" } });
      }
      // Only forward to Sentry's own ingest — never an arbitrary host.
      if (!dsn.hostname.endsWith(".sentry.io")) {
        return reply.status(400).send({ error: { code: "BAD_ENVELOPE", message: "Unsupported DSN host" } });
      }
      const projectId = dsn.pathname.replace(/^\//, "");
      const upstream = `https://${dsn.hostname}/api/${projectId}/envelope/`;

      const res = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/x-sentry-envelope" },
        body: raw,
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);

      return reply.status(res?.ok ? 200 : 502).send({ ok: !!res?.ok });
    },
  );
}
