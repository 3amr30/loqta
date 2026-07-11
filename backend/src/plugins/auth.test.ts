import { describe, expect, it, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { registerAuth } from "./auth";
import { registerErrorHandler } from "./error-handler";

const SECRET = "test-jwt-secret-with-enough-entropy-0123456789";
const key = new TextEncoder().encode(SECRET);

function sign(opts: { sub?: string; aud?: string; expired?: boolean; secret?: string } = {}) {
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.sub ?? "11111111-1111-1111-1111-111111111111")
    .setAudience(opts.aud ?? "authenticated")
    .setIssuedAt()
    .setExpirationTime(opts.expired ? "-1h" : "1h");
  return jwt.sign(opts.secret ? new TextEncoder().encode(opts.secret) : key);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  registerAuth(app, {
    SUPABASE_URL: "http://127.0.0.1:1", // JWKS never fetched for HS256 tokens
    SUPABASE_JWT_SECRET: SECRET,
  });
  app.get("/t", { preHandler: (req) => app.requireAuth(req) }, async (req) => ({
    merchantId: req.merchantId,
  }));
  await app.ready();
});

afterAll(() => app.close());

describe("auth plugin (HS256 path)", () => {
  it("accepts a valid token and attaches merchantId", async () => {
    const res = await app.inject({
      url: "/t",
      headers: { authorization: `Bearer ${await sign()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().merchantId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects a missing bearer header", async () => {
    const res = await app.inject({ url: "/t" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an expired token", async () => {
    const res = await app.inject({
      url: "/t",
      headers: { authorization: `Bearer ${await sign({ expired: true })}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const res = await app.inject({
      url: "/t",
      headers: { authorization: `Bearer ${await sign({ secret: "wrong-".repeat(8) })}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects the wrong audience", async () => {
    const res = await app.inject({
      url: "/t",
      headers: { authorization: `Bearer ${await sign({ aud: "service_role" })}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects garbage tokens without crashing", async () => {
    const res = await app.inject({
      url: "/t",
      headers: { authorization: "Bearer not.a.jwt" },
    });
    expect(res.statusCode).toBe(401);
  });
});
