// @code-analyzer/core — Operations Module
// Health checks, metrics export, graceful shutdown, resilience patterns

export {
  HealthCheckRegistry,
} from './health-check.js';
export type {
  HealthStatus,
  HealthCheckResult,
  HealthCheck,
  HealthCheckRegistryOptions,
} from './health-check.js';

export {
  MetricsRegistry,
  createStandardMetrics,
} from './metrics-exporter.js';
export type {
  MetricType,
  MetricLabel,
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
} from './metrics-exporter.js';

export {
  GracefulShutdown,
} from './graceful-shutdown.js';
export type {
  ShutdownSignal,
  ShutdownHandler,
  ShutdownResult,
  GracefulShutdownOptions,
} from './graceful-shutdown.js';

export {
  RetryPolicy,
  DeadLetterQueue,
} from './resilience.js';
export type {
  RetryConfig,
  DeadLetterEntry,
  DeadLetterQueueOptions,
  RetryResult,
} from './resilience.js';
