import { appendFileSync } from "node:fs";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) in LOG_LEVELS
    ? (process.env.LOG_LEVEL as LogLevel)
    : "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  spanId?: string;
  worker?: string;
  [key: string]: unknown;
}

function formatLog(entry: LogEntry): void {
  const { timestamp, level, message, ...rest } = entry;
  const logObj = { ...rest, ts: timestamp, level, msg: message };
  const line = JSON.stringify(logObj);
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.log;
  fn(line);

  if (process.env.LOG_FILE) {
    try {
      appendFileSync(process.env.LOG_FILE, line + "\n");
    } catch (e) {
      console.warn(
        "[logger] Failed to write to log file:",
        process.env.LOG_FILE,
        String(e),
      );
    }
  }
}

export class Logger {
  private defaults: Record<string, unknown>;

  constructor(defaults: Record<string, unknown> = {}) {
    this.defaults = defaults;
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    if (shouldLog("debug"))
      formatLog({
        timestamp: new Date().toISOString(),
        level: "debug",
        message,
        ...this.defaults,
        ...extra,
      });
  }

  info(message: string, extra?: Record<string, unknown>): void {
    if (shouldLog("info"))
      formatLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message,
        ...this.defaults,
        ...extra,
      });
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    if (shouldLog("warn"))
      formatLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message,
        ...this.defaults,
        ...extra,
      });
  }

  error(message: string, extra?: Record<string, unknown>): void {
    if (shouldLog("error"))
      formatLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message,
        ...this.defaults,
        ...extra,
      });
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.defaults, ...extra });
  }
}

export const defaultLogger = new Logger();
