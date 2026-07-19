// @code-analyzer/core — Public API
// Foundation layer: config, logging, errors, i18n, metrics, lifecycle

// Configuration
export type { CodeAnalyzerConfig } from '@code-analyzer/shared';
export { getDefaultConfig, loadConfig, deepMerge, validateConfig } from './config/index.js';
export type { ValidationError } from './config/validator.js';

// Logging
export {
  createLogger,
  createNoopLogger,
  LoggerImpl,
  formatJson,
  formatPretty,
  createLevelFilter,
} from './logging/index.js';
export type {
  Logger,
  LoggerOptions,
  LogTransport,
  LogLevel,
  LogEntry,
  LogFilter,
} from './logging/index.js';

// Errors
export {
  CodeAnalyzerError,
  ConfigError,
  IOError,
  ParseError,
  ResolutionError,
  GraphIntegrityError,
  EmbeddingError,
  LLMProviderError,
  MCPProtocolError,
  RateLimitError,
} from './errors/index.js';

// Internationalization
export {
  DEFAULT_MESSAGES,
  DefaultTranslator,
  getTranslator,
  setTranslator,
  resetTranslator,
} from './i18n/index.js';
export type { Translator } from './i18n/index.js';

// Metrics
export {
  DefaultMetricsCollector,
  NoopMetricsCollector,
  createMetrics,
} from './metrics/index.js';
export type { MetricsCollector } from './metrics/index.js';

// Lifecycle
export { LifecycleManager } from './lifecycle/index.js';
export type {
  Component,
  HealthStatus,
  HealthCheckResult,
  ComponentDescriptor,
  LifecycleOptions,
} from './lifecycle/index.js';
