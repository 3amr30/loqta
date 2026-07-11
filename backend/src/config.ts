import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().optional(),
  ROOT_DOMAIN: z.string().default("loqta.shop"),
  CORS_ORIGINS: z.string().default(""),
  GEMINI_API_KEY: z.string().optional(),
  SCRAPER_API_KEY: z.string().optional(),
  ALIEXPRESS_APP_KEY: z.string().optional(),
  ALIEXPRESS_APP_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default("development"),
  // WhatsApp (Twilio) + email (Resend) — all optional; features flag off by absence.
  PUBLIC_API_URL: z.string().url().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  TWILIO_CONTENT_SID_MERCHANT_ALERT: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_EMAIL_FROM: z.string().optional(),
  IMPORT_SWEEP_MS: z.coerce.number().int().positive().default(5000),
  SYNC_BATCH_SIZE: z.coerce.number().int().positive().default(25),
});

export type Config = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {}

/**
 * Fail-fast env validation. Empty strings count as unset (common in
 * .env templates and CI). Throws ConfigError with every problem listed;
 * the entrypoints catch it, print, and exit(1).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
