import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from .env file if present
dotenv.config();

const DEFAULT_TEST_DB_URL = "postgresql://postgres:postgres@localhost:5432/wallet_voice_call";
const DEFAULT_TEST_SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid PostgreSQL connection URL"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters long for cryptographic security"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  AUTH_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  AUTH_DOMAIN: z.string().default("localhost:3001"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  STUN_URLS: z.string().default("stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"),
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  DISCONNECT_GRACE_PERIOD_SECONDS: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env | null = null;

export function loadEnv(customEnv?: Record<string, string | undefined>): Env {
  const raw = customEnv || process.env;
  const isTest = raw.NODE_ENV === "test";
  const source = {
    ...raw,
    DATABASE_URL: raw.DATABASE_URL || (isTest ? DEFAULT_TEST_DB_URL : undefined),
    SESSION_SECRET: raw.SESSION_SECRET || (isTest ? DEFAULT_TEST_SESSION_SECRET : undefined),
  };

  const result = envSchema.safeParse(source);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `  - ${err.path.join(".")}: ${err.message}`)
      .join("\n");
    throw new Error(
      `[Config] Invalid environment configuration:\n${formattedErrors}\nPlease review your .env file against .env.example.`
    );
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export function getEnv(): Env {
  if (!parsedEnv) {
    return loadEnv();
  }
  return parsedEnv;
}

export const env = getEnv();
