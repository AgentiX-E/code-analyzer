// @code-analyzer/core — Logging (Stub)

export interface Logger {
  trace(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, error?: Error, data?: Record<string, unknown>): void;
  fatal(msg: string, error?: Error, data?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  return {
    trace: (msg, data) => { /* stub */ },
    debug: (msg, data) => { /* stub */ },
    info: (msg, data) => console.log(`[${component}] ${msg}`),
    warn: (msg, data) => console.warn(`[${component}] ${msg}`),
    error: (msg, error, data) => console.error(`[${component}] ${msg}`, error),
    fatal: (msg, error, data) => { console.error(`[FATAL][${component}] ${msg}`, error); process.exit(1); },
  };
}
