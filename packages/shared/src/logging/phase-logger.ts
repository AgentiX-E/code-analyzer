// @code-analyzer/shared — Phase Logger
// Structured logging interface for pipeline phases.
// Provides consistent error/warn/info/debug logging with
// phase context (phaseId, file path, duration, error details).

/** Contextual metadata attached to every log entry. */
export interface PhaseLogContext {
  /** The ID of the phase that produced this log entry. */
  phaseId: string;
  /** Optional file path being processed when the log entry was produced. */
  filePath?: string;
  /** Optional duration in milliseconds for timing-related log entries. */
  durationMs?: number;
  /** Arbitrary extra data for ad-hoc context. */
  extra?: Record<string, unknown>;
}

/** Structured log entry produced by a PhaseLogger. */
export interface PhaseLogEntry {
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context: PhaseLogContext;
  error?: Error;
  timestamp: number;
}

/**
 * Logger interface for pipeline phases.
 * All catch blocks in the analysis pipeline MUST use this logger
 * instead of swallowing errors silently.
 */
export interface PhaseLogger {
  /** Log an error with full structured context. Always includes the Error object. */
  error(message: string, error: Error, context: PhaseLogContext): void;

  /** Log a warning — non-fatal issues that may degrade results. */
  warn(message: string, context: PhaseLogContext): void;

  /** Log informational progress. */
  info(message: string, context: PhaseLogContext): void;

  /** Log debug-level detail (suppressed in production). */
  debug(message: string, context: PhaseLogContext): void;

  /** Log trace-level detail (maximum verbosity). */
  trace(message: string, context: PhaseLogContext): void;
}

/**
 * Creates a PhaseLogger that writes to the given transport.
 * The transport receives structured PhaseLogEntry objects.
 */
export function createPhaseLogger(
  transport: (entry: PhaseLogEntry) => void,
  label: string,
): PhaseLogger {
  function log(
    level: PhaseLogEntry['level'],
    message: string,
    context: PhaseLogContext,
    error?: Error,
  ): void {
    const entry: PhaseLogEntry = {
      level,
      message: `[${label}] ${message}`,
      context,
      error,
      timestamp: Date.now(),
    };
    transport(entry);
  }

  return {
    error(message: string, error: Error, context: PhaseLogContext): void {
      log('error', message, context, error);
    },
    warn(message: string, context: PhaseLogContext): void {
      log('warn', message, context);
    },
    info(message: string, context: PhaseLogContext): void {
      log('info', message, context);
    },
    debug(message: string, context: PhaseLogContext): void {
      log('debug', message, context);
    },
    trace(message: string, context: PhaseLogContext): void {
      log('trace', message, context);
    },
  };
}

/**
 * Creates a no-op PhaseLogger for use when logging is disabled.
 */
export function createNoopPhaseLogger(): PhaseLogger {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const noop = (): void => {};
  return {
    error: noop as PhaseLogger['error'],
    warn: noop as PhaseLogger['warn'],
    info: noop as PhaseLogger['info'],
    debug: noop as PhaseLogger['debug'],
    trace: noop as PhaseLogger['trace'],
  };
}
