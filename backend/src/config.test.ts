import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const VALID = {
  DATABASE_URL: "postgresql://u:p@db.example.com:5432/postgres",
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
} as NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("applies defaults on a minimal valid env", () => {
    const cfg = loadConfig(VALID);
    expect(cfg.PORT).toBe(3001);
    expect(cfg.ROOT_DOMAIN).toBe("loqta.shop");
    expect(cfg.SYNC_BATCH_SIZE).toBe(25);
    expect(cfg.IMPORT_SWEEP_MS).toBe(5000);
  });

  it("fails fast with the missing variable named", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID;
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrowError(ConfigError);
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrowError(/DATABASE_URL/);
  });

  it("treats empty strings as unset", () => {
    expect(() => loadConfig({ ...VALID, SUPABASE_URL: "" })).toThrowError(/SUPABASE_URL/);
    const cfg = loadConfig({ ...VALID, SENTRY_DSN: "" });
    expect(cfg.SENTRY_DSN).toBeUndefined();
  });
});
