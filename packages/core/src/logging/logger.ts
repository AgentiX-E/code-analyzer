import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  type LogEntry,
  type LogFilter,
  type LogLevel,
  formatJson,
  formatPretty,
  createLevelFilter,
} from './formatter.js';

/**
 * A transport sends formatted log entries to a destination.
 */
export interface LogTransport {
  /** Write a formatted log line to the transport. */
  write(formatted: string, entry: LogEntry): void;
  /** Flush any buffered output. */
  flush?(): void;
  /** Clean up transport resources. */
  close?(): void;
}

/** Logger configuration options. */
export interface LoggerOptions {
  /** Minimum log level (default: 'info'). */
  minLevel?: LogLevel;
  /** Output format: 'json' or 'pretty' (default: 'pretty' for console, 'json' for file). */
  format?: 'json' | 'pretty';
  /** Enable file transport (default: false). */
  enableFile?: boolean;
  /** File transport output directory (default: './logs'). */
  logDir?: string;
  /** Additional custom filters. */
  filters?: LogFilter[];
  /** Custom transports. */
  transports?: LogTransport[];
}

/**
 * Structured logger with configurable levels, formats, and transports.
 */
export interface Logger {
  readonly component: string;
  trace(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;
  fatal(message: string, error?: Error, data?: Record<string, unknown>): void;
  /** Check if a given log level is enabled. */
  isLevelEnabled(level: LogLevel): boolean;
  /** Flush all transports. */
  flush(): void;
  /** Close all transports. */
  close(): void;
}

/**
 * Console transport: writes formatted entries to stdout/stderr.
 */
class ConsoleTransport implements LogTransport {
  write(formatted: string, entry: LogEntry): void {
    switch (entry.level) {
      case 'error':
      case 'fatal':
        process.stderr.write(formatted + '\n');
        break;
      default:
        process.stdout.write(formatted + '\n');
    }
  }
}

/**
 * File transport: appends log entries to a date-stamped log file.
 */
class FileTransport implements LogTransport {
  private stream: fs.WriteStream | undefined;

  constructor(private readonly logDir: string, private readonly component: string) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  private ensureStream(): fs.WriteStream {
    if (this.stream) return this.stream;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filePath = path.join(this.logDir, `${this.component}-${date}.log`);
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    return this.stream;
  }

  write(formatted: string, _entry: LogEntry): void {
    const stream = this.ensureStream();
    stream.write(formatted + '\n');
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = undefined;
    }
  }
}

/**
 * Core logger implementation.
 */
export class LoggerImpl implements Logger {
  private minLevel: LogLevel;
  private formatFn: (entry: LogEntry) => string;
  private filters: LogFilter[];
  private transports: LogTransport[];
  private closed = false;

  constructor(
    public readonly component: string,
    options: LoggerOptions = {}
  ) {
    this.minLevel = options.minLevel ?? 'info';
    this.filters = [createLevelFilter(this.minLevel)];

    if (options.filters) {
      this.filters.push(...options.filters);
    }

    const format = options.format ?? 'pretty';
    this.formatFn = format === 'json' ? formatJson : formatPretty;

    this.transports = [];

    // Default: always add console transport if no custom transports provided
    if (options.transports) {
      this.transports.push(...options.transports);
    } else {
      this.transports.push(new ConsoleTransport());
    }

    // File transport is opt-in
    if (options.enableFile) {
      const logDir = options.logDir ?? './logs';
      this.transports.push(new FileTransport(logDir, component));
    }
  }

  isLevelEnabled(level: LogLevel): boolean {
    return this.filters.every(
      (f) =>
        f({
          timestamp: '',
          level,
          component: '',
          message: '',
        })
    );
  }

  private log(
    level: LogLevel,
    message: string,
    error?: Error,
    data?: Record<string, unknown>
  ): void {
    if (this.closed) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
    };

    if (data !== undefined && Object.keys(data).length > 0) {
      entry.data = data;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      // Extract code and context from CodeAnalyzerError derivatives using a type-safe pattern
      if ('code' in error) {
        const codeValue = (error as { code: unknown }).code;
        if (typeof codeValue === 'string') {
          entry.error.code = codeValue;
        }
      }
      if ('context' in error) {
        const ctxValue = (error as { context: unknown }).context;
        if (typeof ctxValue === 'object' && ctxValue !== null) {
          entry.error.context = ctxValue as Record<string, unknown>;
        }
      }
    }

    // Apply filters
    const allowed = this.filters.every((f) => f(entry));
    if (!allowed) return;

    const formatted = this.formatFn(entry);
    for (const transport of this.transports) {
      try {
        transport.write(formatted, entry);
      } catch {
        // Silently ignore transport errors to prevent cascading failures
      }
    }
  }

  trace(message: string, data?: Record<string, unknown>): void {
    this.log('trace', message, undefined, data);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, undefined, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, undefined, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, undefined, data);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log('error', message, error, data);
  }

  fatal(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log('fatal', message, error, data);
  }

  flush(): void {
    for (const transport of this.transports) {
      transport.flush?.();
    }
  }

  close(): void {
    this.closed = true;
    for (const transport of this.transports) {
      transport.close?.();
    }
  }
}

/**
 * Create a new logger for the given component.
 *
 * @param component - The component name for log attribution.
 * @param options - Logger configuration options.
 * @returns A configured Logger instance.
 */
export function createLogger(component: string, options?: LoggerOptions): Logger {
  return new LoggerImpl(component, options);
}

/**
 * Create a no-op (silent) logger. Useful for testing or when logging is disabled.
 */
export function createNoopLogger(component: string): Logger {
  return new LoggerImpl(component, { minLevel: 'fatal', format: 'json' });
}
