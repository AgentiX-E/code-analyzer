// @code-analyzer/infra — Resilience Module
// Production hardening utilities: retry, circuit breaker, and health checks.

export {
  withRetry,
  isNetworkError,
  isServerError,
  isRateLimitError,
  isTransientError,
} from './retry.js';
export type { RetryOptions, RetryResult } from './retry.js';

export {
  HealthCheckRegistry,
  createDependencyCheck,
  createThresholdCheck,
} from './health-check.js';
export type {
  HealthStatus,
  HealthCheckResult,
  HealthReport,
  HealthCheckFn,
} from './health-check.js';

// Note: CircuitBreaker is already exported from workers/circuit-breaker.ts
// Re-export for convenience in the resilience namespace
export { CircuitBreaker } from '../workers/circuit-breaker.js';
export type { CircuitState, CircuitBreakerOptions } from '../workers/circuit-breaker.js';
