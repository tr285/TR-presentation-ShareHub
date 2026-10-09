/**
 * Production-ready structured logger for TR Presentation ShareHub.
 * Outputs JSON format in production and human-readable format in development.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private isJson: boolean;

  constructor() {
    const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
    this.level = LOG_LEVEL_PRIORITY[envLevel] !== undefined ? envLevel : "info";

    const format = (process.env.LOG_FORMAT || "").toLowerCase();
    this.isJson =
      format === "json" ||
      (format !== "pretty" && process.env.NODE_ENV === "production");
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatError(err: unknown): Record<string, unknown> | null {
    if (!err) return null;
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }
    return { error: String(err) };
  }

  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: unknown
  ): void {
    if (!this.shouldLog(level)) return;

    const timestamp = new Date().toISOString();
    const formattedError = error ? this.formatError(error) : undefined;

    if (this.isJson) {
      const payload: Record<string, unknown> = {
        timestamp,
        level,
        message,
        ...(context ? { context } : {}),
        ...(formattedError ? { error: formattedError } : {}),
      };
      const stream = level === "error" ? process.stderr : process.stdout;
      stream.write(JSON.stringify(payload) + "\n");
    } else {
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      const contextStr = context ? ` ${JSON.stringify(context)}` : "";
      const errorStr = error instanceof Error ? `\n  Error: ${error.stack || error.message}` : "";
      const stream = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      stream(`${prefix} ${message}${contextStr}${errorStr}`);
    }
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.log("warn", message, context, error);
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.log("error", message, context, error);
  }
}

export const logger = new Logger();
