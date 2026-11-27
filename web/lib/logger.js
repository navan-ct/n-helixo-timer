import pino from "pino";

/**
 * Paths scrubbed from every log line. Request logs only include method and path,
 * but these guard against secrets reaching logs through ad-hoc context objects.
 */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  "*.accessToken",
  "*.apiSecretKey",
  "*.password",
  "*.token",
];

/**
 * Creates the application's root logger: JSON lines in production (for log
 * shippers), human-readable output in development.
 *
 * @param {{ level: string, pretty: boolean }} options
 */
export function createLogger({ level, pretty }) {
  return pino({
    level,
    base: { service: "n-helixo-timer" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    formatters: { level: (label) => ({ level: label }) },
    ...(pretty && {
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service" },
      },
    }),
  });
}

/** A logger that discards everything; handy as a default in tests. */
export const silentLogger = pino({ level: "silent" });
