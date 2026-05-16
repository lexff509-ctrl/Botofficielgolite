/**
 * Minimal structured logger.
 *
 * In production (NODE_ENV=production) only warn/error are emitted.
 * All output goes to stdout/stderr so it is captured by the Next.js
 * server process and any log aggregator attached to it.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel =
  process.env.NODE_ENV === "production" ? "warn" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

function format(
  level: LogLevel,
  context: string,
  message: string,
  meta?: unknown
): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${context}] ${message}`;
  if (meta !== undefined) {
    try {
      return `${base} ${JSON.stringify(meta)}`;
    } catch {
      return `${base} [unserializable meta]`;
    }
  }
  return base;
}

export function createLogger(context: string) {
  return {
    debug(message: string, meta?: unknown) {
      if (shouldLog("debug")) {
        console.debug(format("debug", context, message, meta));
      }
    },
    info(message: string, meta?: unknown) {
      if (shouldLog("info")) {
        console.info(format("info", context, message, meta));
      }
    },
    warn(message: string, meta?: unknown) {
      if (shouldLog("warn")) {
        console.warn(format("warn", context, message, meta));
      }
    },
    error(message: string, meta?: unknown) {
      if (shouldLog("error")) {
        console.error(format("error", context, message, meta));
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
