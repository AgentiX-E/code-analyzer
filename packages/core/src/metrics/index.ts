// @code-analyzer/core — Metrics Collector
// Tag-based dimensional metrics with Counter, Histogram, and Gauge

export { DefaultMetricsCollector } from './collector.js';
export { NoopMetricsCollector } from './noop.js';
export type { MetricsCollector } from './collector.js';

import { DefaultMetricsCollector } from './collector.js';

import type { MetricsCollector } from './collector.js';

/**
 * Create a new metrics collector instance.
 *
 * @returns A MetricsCollector with in-memory storage.
 */
export function createMetrics(): MetricsCollector {
  return new DefaultMetricsCollector();
}
