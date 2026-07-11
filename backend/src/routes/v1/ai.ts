import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { queryOne } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { getBoss } from "../../lib/queue";

/** Enqueue the Gemini rewrite job for a listing the merchant owns. */
export function aiRoutes(app: FastifyInstance) {
  app.post(
    "/v1/listings/:id/ai-rewrite",
    {
      preHandler: (req) => app.requireStore(req),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const listing = await queryOne<{ id: string }>(
        `select id from listings where id = $1 and store_id = $2`,
        [id, req.store!.id],
      );
      if (!listing) throw new AppError("NOT_FOUND", 404, "Listing not found");

      const boss = await getBoss();
      await boss.send("content.generate", { listingId: id }, { singletonKey: id });
      return reply.status(202).send({ queued: true });
    },
  );
}
