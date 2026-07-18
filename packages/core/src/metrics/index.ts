// @code-analyzer/core — Metrics (Stub)

export interface MetricsCollector {
  incrementCounter(name: string, value?: number, tags?: Record<string, string>): void;
  recordDuration(name: string, duration: number, tags?: Record<string, string>): void;
  setGauge(name: string, value: number, tags?: Record<string, string>): void;
}

export function createMetrics(): MetricsCollector {
  return {
    incrementCounter: () => {},
    recordDuration: () => {},
    setGauge: () => {},
  };
}
