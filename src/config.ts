import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.string().default("info"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  ENABLE_API_DOCS: z.enum(["true", "false"]).optional(),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  DATABASE_URL: z.string().min(1),
  MEDUSA_BACKEND_URL: z.url(),
  MEDUSA_PUBLISHABLE_KEY: z.string().min(1),
  MODEL_PROVIDER: z.enum(["openai", "anthropic"]),
  MODEL_NAME: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default("medusa-sales-agent"),
  JWT_AUDIENCE: z.string().default("medusa-storefront"),
  SESSION_ISSUER_KEY: z.string().min(24),
  SESSION_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  APPROVAL_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  THREAD_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: z.string().default("http://localhost:8000"),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  METRICS_TOKEN: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = environmentSchema.parse(source);

  if (env.MODEL_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when MODEL_PROVIDER=openai");
  }
  if (env.MODEL_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when MODEL_PROVIDER=anthropic");
  }

  return {
    nodeEnv: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxy: env.TRUST_PROXY === "true",
    enableApiDocs:
      env.ENABLE_API_DOCS === undefined
        ? env.NODE_ENV !== "production"
        : env.ENABLE_API_DOCS === "true",
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    databaseUrl: env.DATABASE_URL,
    medusa: {
      backendUrl: env.MEDUSA_BACKEND_URL.replace(/\/$/, ""),
      publishableKey: env.MEDUSA_PUBLISHABLE_KEY,
    },
    model: {
      provider: env.MODEL_PROVIDER,
      name: env.MODEL_NAME,
      openAiApiKey: env.OPENAI_API_KEY,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    },
    auth: {
      jwtSecret: env.JWT_SECRET,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      sessionIssuerKey: env.SESSION_ISSUER_KEY,
      tokenTtlSeconds: env.SESSION_TOKEN_TTL_SECONDS,
    },
    approvalTtlSeconds: env.APPROVAL_TTL_SECONDS,
    threadRetentionDays: env.THREAD_RETENTION_DAYS,
    corsOrigins: env.CORS_ORIGINS.split(",").map((origin) => origin.trim()),
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      timeWindow: env.RATE_LIMIT_WINDOW,
    },
    metricsToken: env.METRICS_TOKEN?.trim() || undefined,
  } as const;
}
