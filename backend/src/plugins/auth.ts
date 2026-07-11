import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import type { Config } from "../config";
import { AppError } from "../lib/errors";
import { queryOne } from "../lib/db";

export interface StoreRow {
  id: string;
  slug: string;
  name: string;
  currency: string;
  sync_policy: string;
  settings: Record<string, unknown>;
}

declare module "fastify" {
  interface FastifyRequest {
    merchantId: string;
    store: StoreRow | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requireStore: (req: FastifyRequest) => Promise<void>;
  }
}

type AuthConfig = Pick<Config, "SUPABASE_URL" | "SUPABASE_JWT_SECRET">;

/**
 * Supabase JWT verification supporting BOTH key regimes:
 *  - legacy HS256 project secret (SUPABASE_JWT_SECRET)
 *  - newer asymmetric keys via the project JWKS endpoint
 * The JWKS remote set is created once; jose caches and re-fetches keys
 * on its own schedule. Selection is per token from the header alg.
 */
export function buildVerifier(cfg: AuthConfig): (token: string) => Promise<{ sub: string }> {
  const jwks = createRemoteJWKSet(
    new URL(`${cfg.SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
  );
  const hsSecret = cfg.SUPABASE_JWT_SECRET
    ? new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET)
    : null;

  return async (token) => {
    const header = decodeProtectedHeader(token); // throws on garbage -> 401 upstream
    const options = { audience: "authenticated" };
    let sub: string | undefined;
    if (header.alg === "HS256") {
      if (!hsSecret) {
        throw new AppError("UNAUTHORIZED", 401, "HS256 token but SUPABASE_JWT_SECRET is not set");
      }
      sub = (await jwtVerify(token, hsSecret, options)).payload.sub;
    } else {
      sub = (await jwtVerify(token, jwks, options)).payload.sub;
    }
    if (!sub) throw new AppError("UNAUTHORIZED", 401, "Token has no subject");
    return { sub };
  };
}

export function registerAuth(app: FastifyInstance, cfg: AuthConfig) {
  const verify = buildVerifier(cfg);

  app.decorateRequest("merchantId", "");
  app.decorateRequest("store", null);

  app.decorate("requireAuth", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHORIZED", 401, "Missing bearer token");
    }
    try {
      const { sub } = await verify(header.slice("Bearer ".length));
      req.merchantId = sub;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("UNAUTHORIZED", 401, "Invalid or expired token");
    }
  });

  app.decorate("requireStore", async (req: FastifyRequest) => {
    await app.requireAuth(req);
    const store = await queryOne<StoreRow>(
      `select id, slug, name, currency, sync_policy, settings
       from stores where merchant_id = $1
       order by created_at limit 1`,
      [req.merchantId],
    );
    if (!store) throw new AppError("NO_STORE", 404, "No store for this merchant");
    req.store = store;
  });
}
