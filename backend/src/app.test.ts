import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { AppError } from "./lib/errors";
import type { Config } from "./config";

const config = {
  PORT: 0,
  DATABASE_URL: "postgresql://u:p@db.example.com:5432/postgres",
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
  SUPABASE_JWT_SECRET: "s",
  ROOT_DOMAIN: "loqta.shop",
  CORS_ORIGINS: "",
  SENTRY_ENVIRONMENT: "test",
  IMPORT_SWEEP_MS: 5000,
  SYNC_BATCH_SIZE: 25,
} as Config;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp(config);
  app.get("/boom", async () => {
    throw new AppError("TEAPOT", 418, "short and stout", { handle: true });
  });
  await app.ready();
});

afterAll(() => app.close());

describe("error envelope", () => {
  it("healthz responds", async () => {
    const res = await app.inject({ url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("AppError renders the standard envelope", async () => {
    const res = await app.inject({ url: "/boom" });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({
      error: { code: "TEAPOT", message: "short and stout", details: { handle: true } },
    });
  });

  it("unknown routes get the NOT_FOUND envelope", async () => {
    const res = await app.inject({ url: "/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("merchant routes are locked without a token", async () => {
    const res = await app.inject({ url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
