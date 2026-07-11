import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";
import { Sentry } from "../lib/sentry";

/**
 * One error envelope for the whole API:
 *   { error: { code, message, details? } }
 * 5xx goes to Sentry with route/store/merchant tags.
 * Request BODIES are never attached (customer PII lives there).
 */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    const fastifyErr = err as { statusCode?: unknown; message?: string };
    const statusCode = typeof fastifyErr.statusCode === "number" ? fastifyErr.statusCode : 500;
    if (statusCode < 500) {
      // Fastify-generated 4xx (malformed JSON, payload too large, ...)
      return reply.status(statusCode).send({
        error: { code: "BAD_REQUEST", message: fastifyErr.message ?? "Bad request" },
      });
    }
    Sentry.captureException(err, {
      tags: {
        route: req.routeOptions?.url ?? req.url,
        merchantId: req.merchantId || undefined,
        storeSlug: req.store?.slug,
      },
    });
    req.log.error(err);
    return reply
      .status(500)
      .send({ error: { code: "INTERNAL", message: "Internal server error" } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` },
    });
  });
}
