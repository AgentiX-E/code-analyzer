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

// Operations (Health Check, Graceful Shutdown, Resilience)
// NOTE: HealthStatus from operations (interface) overrides lifecycle's (string type).
// Use operations' HealthStatus for health check reports.
export {
  HealthCheckRegistry,
} from './operations/health-check.js';
export type {
  HealthStatus as HealthReport,
  HealthCheckResult as HealthCheckItem,
  HealthCheck,
  HealthCheckRegistryOptions,
} from './operations/health-check.js';
export {
  GracefulShutdown,
} from './operations/graceful-shutdown.js';
export type {
  ShutdownSignal,
  ShutdownHandler,
  ShutdownResult,
  GracefulShutdownOptions,
} from './operations/graceful-shutdown.js';
export {
  RetryPolicy,
  DeadLetterQueue,
} from './operations/resilience.js';
export type {
  RetryConfig,
  DeadLetterEntry,
  DeadLetterQueueOptions,
  RetryResult,
} from './operations/resilience.js';

// AI Agent Auto-Detection
export {
  detectAllAgents,
  detectAgentById,
  getSupportedAgents,
  getAgentMetadata,
  getAgentRegistry,
} from './agents/detector.js';
export { getMcpTemplate, getAgentSetupGuide, getQuickSetup } from './agents/templates.js';
export type {
  AgentId,
  AgentMetadata,
  AgentDetection,
  AgentDetectionResult,
  DetectionSignal,
  DetectionConfidence,
  McpConfigTemplate,
} from './agents/types.js';

// Plugins
export type {
  CodeAnalyzerPlugin,
  PluginRule,
  PluginRuleResult,
  PluginLens,
  PluginLensFinding,
  PluginStandard,
  PluginMCPTool,
} from './plugins/index.js';
export { PluginLoader, PluginRegistry, getPluginRegistry, resetPluginRegistry } from './plugins/index.js';

// Security
export {
  IntegrityVerifier,
  scanForSecrets,
  isRestrictedLicense,
  SECRET_PATTERNS,
} from './security/supply-chain-integrity.js';
export type {
  IntegrityManifest,
  AuditResult,
  SecurityViolation,
  DependencyIntegrity,
} from './security/supply-chain-integrity.js';
