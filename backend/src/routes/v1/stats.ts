import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { statsOverview } from "../../services/stats";

const Query = z.object({ days: z.coerce.number().default(30) });

export function statsRoutes(app: FastifyInstance) {
  app.get("/v1/stats/overview", { preHandler: (req) => app.requireStore(req) }, async (req) => {
    const { days } = Query.parse(req.query);
    return statsOverview(req.store!.id, days);
  });
}
