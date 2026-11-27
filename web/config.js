import { fileURLToPath } from "node:url";

import { z } from "zod";

/**
 * Typed, validated configuration built from environment variables.
 *
 * Only settings that genuinely differ between environments are read from the
 * environment; everything else is a named constant below. A misconfigured
 * deployment fails at startup with a list of every problem. In development the
 * Shopify CLI provides the SHOPIFY_* variables, SCOPES, HOST and BACKEND_PORT;
 * MongoDB settings come from web/.env.
 */

/** Must exceed the load balancer's idle timeout (60s on most) so it closes idle connections first. */
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const REQUEST_TIMEOUT_MS = 30_000;
const SHOPIFY_API_TIMEOUT_MS = 10_000;
const SHOPIFY_API_RETRIES = 2;
const MONGODB_MAX_POOL_SIZE = 20;
const MONGODB_SERVER_SELECTION_TIMEOUT_MS = 10_000;
const RATE_LIMITS = { windowMs: 60_000, max: 120, writeMax: 30, authMax: 30 };

const NODE_ENVS = ["development", "test", "production"];
const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
const SHOPIFY_HINT = "The Shopify CLI sets it in development; set it on your host in production.";

const blankToUndefined = (value) => (value === "" ? undefined : value);

const optionalInteger = ({ min = 0, max = Number.MAX_SAFE_INTEGER } = {}) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().min(min).max(max).optional());

/** A non-empty string; required unless `optional` (blank counts as missing). */
const requiredString = (key, hint, { optional = false } = {}) =>
  optional
    ? z
        .string()
        .trim()
        .transform((value) => value || undefined)
        .optional()
    : z
        .string({ error: `${key} is required. ${hint}` })
        .trim()
        .min(1, { error: `${key} is required. ${hint}` });

/**
 * Express "trust proxy": a boolean, a hop count, or a list of trusted
 * addresses/subnets (including the keywords loopback, linklocal, uniquelocal).
 */
const trustProxy = z
  .string()
  .trim()
  .default("loopback,linklocal,uniquelocal")
  .transform((value) => {
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  });

/**
 * Field-level rules only, so a single parse reports every problem. Which
 * variables are required depends on NODE_ENV, which is read first.
 */
function envSchema(nodeEnv) {
  const optional = nodeEnv === "test";

  return z.object({
    NODE_ENV: z.enum(NODE_ENVS).default("development"),
    BACKEND_PORT: optionalInteger({ min: 1, max: 65_535 }),
    PORT: optionalInteger({ min: 1, max: 65_535 }),
    TRUST_PROXY: trustProxy,
    SHUTDOWN_TIMEOUT_MS: optionalInteger({ min: 1_000 }),
    SHUTDOWN_DELAY_MS: optionalInteger(),

    SHOPIFY_API_KEY: requiredString("SHOPIFY_API_KEY", SHOPIFY_HINT, { optional }),
    SHOPIFY_API_SECRET: requiredString("SHOPIFY_API_SECRET", SHOPIFY_HINT, { optional }),
    SCOPES: requiredString("SCOPES", SHOPIFY_HINT, { optional }),
    HOST: requiredString("HOST", SHOPIFY_HINT, { optional }).refine(
      (value) => value === undefined || /^https?:\/\/[^/\s]+$/.test(value),
      { error: "HOST must be the app's origin, e.g. https://my-app.example.com" },
    ),

    MONGODB_URI: requiredString("MONGODB_URI", "See web/.env.example.").refine(
      (value) => /^mongodb(\+srv)?:\/\//.test(value),
      { error: "MONGODB_URI must start with mongodb:// or mongodb+srv://." },
    ),
    MONGODB_DB_NAME: z.string().trim().min(1).default("n_helixo_timer"),

    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  });
}

export class ConfigError extends Error {
  constructor(issues) {
    super(
      `Invalid configuration:\n${issues
        .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

/**
 * @param {Record<string, string | undefined>} [source] Usually `process.env`.
 */
export function loadConfig(source = process.env) {
  const nodeEnv = NODE_ENVS.includes(source.NODE_ENV) ? source.NODE_ENV : "development";
  const result = envSchema(nodeEnv).safeParse(source);
  if (!result.success) throw new ConfigError(result.error.issues);
  const env = result.data;

  const isProduction = env.NODE_ENV === "production";
  const isTest = env.NODE_ENV === "test";

  // After SIGTERM, keep serving (while /readyz reports 503) for this long so load
  // balancers stop routing here before the listener closes. Set both to fit your
  // platform's grace period before it force-kills the process.
  const shutdownTimeoutMs = env.SHUTDOWN_TIMEOUT_MS ?? 15_000;
  const shutdownDelayMs = env.SHUTDOWN_DELAY_MS ?? (isProduction ? 5_000 : 0);
  if (shutdownDelayMs >= shutdownTimeoutMs) {
    throw new ConfigError([
      {
        path: ["SHUTDOWN_DELAY_MS"],
        message: "SHUTDOWN_DELAY_MS must be shorter than SHUTDOWN_TIMEOUT_MS.",
      },
    ]);
  }

  const host = env.HOST ? new URL(env.HOST) : null;

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction,
    isTest,
    server: Object.freeze({
      port: env.BACKEND_PORT ?? env.PORT ?? 3000,
      trustProxy: env.TRUST_PROXY,
      keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
      // Node requires headersTimeout > keepAliveTimeout.
      headersTimeoutMs: KEEP_ALIVE_TIMEOUT_MS + 1_000,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      shutdownTimeoutMs,
      shutdownDelayMs,
      jsonBodyLimit: "16kb",
      staticPath: fileURLToPath(
        new URL(isProduction ? "./frontend/dist/" : "./frontend/", import.meta.url),
      ),
    }),
    shopify: Object.freeze({
      apiKey: env.SHOPIFY_API_KEY ?? "",
      apiSecret: env.SHOPIFY_API_SECRET ?? "",
      scopes: env.SCOPES ? env.SCOPES.split(",").map((scope) => scope.trim()) : [],
      hostScheme: host ? host.protocol.replace(":", "") : "https",
      hostName: host ? host.host : "localhost",
      apiTimeoutMs: SHOPIFY_API_TIMEOUT_MS,
      apiRetries: SHOPIFY_API_RETRIES,
    }),
    mongo: Object.freeze({
      uri: env.MONGODB_URI,
      dbName: env.MONGODB_DB_NAME,
      maxPoolSize: MONGODB_MAX_POOL_SIZE,
      serverSelectionTimeoutMs: MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    }),
    log: Object.freeze({
      level: env.LOG_LEVEL ?? (isTest ? "silent" : isProduction ? "info" : "debug"),
      pretty: env.NODE_ENV === "development",
    }),
    rateLimit: Object.freeze({ ...RATE_LIMITS }),
  });
}
