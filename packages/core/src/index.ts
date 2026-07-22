// @code-analyzer/core — Public API
// Foundation layer: config, logging, errors, i18n, metrics, lifecycle, operations, security

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

// Operations — health checks, metrics export, graceful shutdown, resilience
export {
  HealthCheckRegistry,
  MetricsRegistry,
  createStandardMetrics,
  GracefulShutdown,
  RetryPolicy,
  DeadLetterQueue,
} from './operations/index.js';
export type {
  // Note: operations HealthStatus/HealthCheckResult conflict with lifecycle types;
  // import from './operations' directly for the operational variants.
  HealthCheck,
  HealthCheckRegistryOptions,
  MetricType,
  MetricLabel,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
  ShutdownSignal,
  ShutdownHandler,
  ShutdownResult,
  GracefulShutdownOptions,
  RetryConfig,
  DeadLetterEntry,
  DeadLetterQueueOptions,
  RetryResult,
  HealthStatus as OperationalHealthStatus,
  HealthCheckResult as OperationalHealthCheckResult,
} from './operations/index.js';

// Security
export { RBACEngine, AuditLogger, SecretScanner } from './security/index.js';
export type {
  Permission,
  Role,
  RoleDefinition,
  UserIdentity,
  AuditEvent,
  AuditQuery,
  AuditSummary,
  SecretScanResult,
} from './security/index.js';
