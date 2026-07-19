// @code-analyzer/core — Logging System
// Structured JSON logging with level filtering and multiple transports

export {
  createLogger,
  createNoopLogger,
  LoggerImpl,
} from './logger.js';
export type {
  Logger,
  LoggerOptions,
  LogTransport,
} from './logger.js';

export {
  formatJson,
  formatPretty,
  createLevelFilter,
} from './formatter.js';
export type {
  LogLevel,
  LogEntry,
  LogFilter,
} from './formatter.js';
