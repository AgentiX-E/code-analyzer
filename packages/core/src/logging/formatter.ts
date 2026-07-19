/**
 * Logging formatters for structured log entries.
 */

/** Log level enumeration. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Structured log entry produced by the logger. */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    context?: Record<string, unknown>;
  };
}

/** Numeric severity for ordering. */
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/** ANSI escape codes for pretty formatting. */
const COLORS: Record<LogLevel, string> = {
  trace: '\x1b[90m', // gray
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  fatal: '\x1b[35m', // magenta
};
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

/**
 * Format a log entry as a single-line JSON string (machine-readable).
 */
export function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Format a log entry as a human-readable, colorized string.
 */
export function formatPretty(entry: LogEntry): string {
  const color = COLORS[entry.level] ?? '';
  const levelLabel = entry.level.toUpperCase().padEnd(5);
  const ts = new Date(entry.timestamp).toISOString();
  const header = `${DIM}${ts}${RESET} ${color}${levelLabel}${RESET} ${DIM}[${entry.component}]${RESET}`;

  let line = `${header} ${entry.message}`;

  if (entry.error) {
    line += `\n  ${color}Error:${RESET} ${entry.error.message}`;
    if (entry.error.code) {
      line += ` ${DIM}(${entry.error.code})${RESET}`;
    }
    if (entry.error.stack) {
      line += `\n${DIM}${entry.error.stack}${RESET}`;
    }
  }

  if (entry.data && Object.keys(entry.data).length > 0) {
    try {
      const dataStr = JSON.stringify(entry.data, null, 2);
      line += `\n${DIM}  Data: ${dataStr}${RESET}`;
    } catch {
      line += `\n${DIM}  Data: [unserializable]${RESET}`;
    }
  }

  return line;
}

/**
 * Filter function type: returns true if the entry should be logged.
 */
export type LogFilter = (entry: LogEntry) => boolean;

/**
 * Create a level filter that only allows entries at or above the given minimum level.
 */
export function createLevelFilter(minLevel: LogLevel): LogFilter {
  const minSeverity = LEVEL_SEVERITY[minLevel];
  return (entry: LogEntry) => LEVEL_SEVERITY[entry.level] >= minSeverity;
}
