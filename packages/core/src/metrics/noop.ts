import type { MetricsCollector } from './collector.js';

/**
 * No-operation MetricsCollector implementation.
 * All methods are no-ops that silently discard data.
 * Use when metrics collection is disabled or in test environments.
 */
export class NoopMetricsCollector implements MetricsCollector {
  incrementCounter(_name: string, _value?: number, _tags?: Record<string, string>): void {
    // no-op
  }

  recordDuration(_name: string, _duration: number, _tags?: Record<string, string>): void {
    // no-op
  }

  setGauge(_name: string, _value: number, _tags?: Record<string, string>): void {
    // no-op
  }

  getCounter(_name: string, _tags?: Record<string, string>): number {
    return 0;
  }

  getGauge(_name: string, _tags?: Record<string, string>): number {
    return 0;
  }

  getHistogram(_name: string, _tags?: Record<string, string>): { values: number[]; count: number; sum: number } | undefined {
    return undefined;
  }

  reset(): void {
    // no-op
  }
}
