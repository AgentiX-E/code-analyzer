/**
 * Metrics Exporter — Prometheus-compatible metrics registry.
 * Supports Counter, Gauge, Histogram with labels and dual export (text/JSON).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabel {
  name: string;
  value: string;
}

export interface CounterMetric {
  inc(value?: number, labels?: Record<string, string>): void;
  get(labels?: Record<string, string>): number;
}

export interface GaugeMetric {
  set(value: number, labels?: Record<string, string>): void;
  inc(value?: number, labels?: Record<string, string>): void;
  dec(value?: number, labels?: Record<string, string>): void;
  get(labels?: Record<string, string>): number;
}

export interface HistogramMetric {
  observe(value: number, labels?: Record<string, string>): void;
  get(
    labels?: Record<string, string>
  ): { count: number; sum: number; buckets: Record<string, number> };
}

// ---------------------------------------------------------------------------
// Internal Metric Implementations
// ---------------------------------------------------------------------------

/**
 * Stable key generation from labels for metric deduplication.
 */
function labelsKey(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return (
    '{' +
    Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',') +
    '}'
  );
}

/**
 * Serialize label set to a Prometheus-compatible label string.
 */
function serializeLabels(labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  return (
    '{' +
    Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
      .join(',') +
    '}'
  );
}

/** Returns the base name for metric identification without labels. */
function metricBase(name: string): string {
  return name;
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

class CounterMetricImpl implements CounterMetric {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType = 'counter';
  readonly labelNames: string[];
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string, labelNames?: string[]) {
    this.name = metricBase(name);
    this.help = help;
    this.labelNames = labelNames ?? [];
  }

  inc(value = 1, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + value);
  }

  get(labels?: Record<string, string>): number {
    return this.values.get(labelsKey(labels)) ?? 0;
  }

  /** Export a snapshot for serialization. */
  exportEntries(): Array<{ value: number; labels: Record<string, string> }> {
    const entries: Array<{ value: number; labels: Record<string, string> }> =
      [];
    for (const [key, value] of this.values) {
      entries.push({
        value,
        labels: key ? parseLabelsFromKey(key) : {},
      });
    }
    return entries;
  }

  reset(): void {
    this.values.clear();
  }
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

class GaugeMetricImpl implements GaugeMetric {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType = 'gauge';
  readonly labelNames: string[];
  private values: Map<string, number> = new Map();

  constructor(name: string, help: string, labelNames?: string[]) {
    this.name = metricBase(name);
    this.help = help;
    this.labelNames = labelNames ?? [];
  }

  set(value: number, labels?: Record<string, string>): void {
    this.values.set(labelsKey(labels), value);
  }

  inc(value = 1, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current + value);
  }

  dec(value = 1, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    const current = this.values.get(key) ?? 0;
    this.values.set(key, current - value);
  }

  get(labels?: Record<string, string>): number {
    return this.values.get(labelsKey(labels)) ?? 0;
  }

  exportEntries(): Array<{ value: number; labels: Record<string, string> }> {
    const entries: Array<{ value: number; labels: Record<string, string> }> =
      [];
    for (const [key, value] of this.values) {
      entries.push({
        value,
        labels: key ? parseLabelsFromKey(key) : {},
      });
    }
    return entries;
  }

  reset(): void {
    this.values.clear();
  }
}

// ---------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------

interface HistogramEntry {
  count: number;
  sum: number;
  bucketCounts: number[];
}

class HistogramMetricImpl implements HistogramMetric {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType = 'histogram';
  readonly labelNames: string[];
  readonly buckets: number[];
  private entries: Map<string, HistogramEntry> = new Map();

  constructor(
    name: string,
    help: string,
    buckets?: number[],
    labelNames?: string[]
  ) {
    this.name = metricBase(name);
    this.help = help;
    this.buckets = buckets ?? [
      0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
    ];
    this.labelNames = labelNames ?? [];
  }

  observe(value: number, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        count: 0,
        sum: 0,
        bucketCounts: new Array(this.buckets.length).fill(0),
      };
      this.entries.set(key, entry);
    }

    entry.count++;
    entry.sum += value;

    // Increment appropriate buckets
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        entry.bucketCounts[i]++;
      }
    }
  }

  get(
    labels?: Record<string, string>
  ): { count: number; sum: number; buckets: Record<string, number> } {
    const entry = this.entries.get(labelsKey(labels));
    if (!entry) {
      return { count: 0, sum: 0, buckets: {} };
    }
    const buckets: Record<string, number> = {};
    for (let i = 0; i < this.buckets.length; i++) {
      buckets[String(this.buckets[i])] = entry.bucketCounts[i];
    }
    return { count: entry.count, sum: entry.sum, buckets };
  }

  get bucketsKeyed(): Record<string, number> {
    const result: Record<string, number> = {};
    for (let i = 0; i < this.buckets.length; i++) {
      result[String(this.buckets[i])] = 0;
    }
    for (const entry of this.entries.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        result[String(this.buckets[i])] += entry.bucketCounts[i];
      }
    }
    return result;
  }

  exportEntries(): Array<{
    count: number;
    sum: number;
    bucketCounts: number[];
    labels: Record<string, string>;
  }> {
    const entries: Array<{
      count: number;
      sum: number;
      bucketCounts: number[];
      labels: Record<string, string>;
    }> = [];
    for (const [key, entry] of this.entries) {
      entries.push({
        count: entry.count,
        sum: entry.sum,
        bucketCounts: [...entry.bucketCounts],
        labels: key ? parseLabelsFromKey(key) : {},
      });
    }
    return entries;
  }

  reset(): void {
    this.entries.clear();
  }
}

// ---------------------------------------------------------------------------
// Label Key Parsing
// ---------------------------------------------------------------------------

/** Parse a stable key like {method="GET",status="200"} back to a labels map. */
function parseLabelsFromKey(key: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!key.startsWith('{')) return labels;

  const inner = key.slice(1, -1); // Remove braces
  // Match key="value" pairs (value may contain escaped quotes)
  const parts = inner.split(',');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const k = part.slice(0, eqIdx).trim();
    let v = part.slice(eqIdx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    labels[k] = v;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// MetricsRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for Prometheus-compatible metrics.
 * Supports Counter, Gauge, Histogram with labels.
 */
export class MetricsRegistry {
  private counters: Map<string, CounterMetricImpl> = new Map();
  private gauges: Map<string, GaugeMetricImpl> = new Map();
  private histograms: Map<string, HistogramMetricImpl> = new Map();

  /**
   * Register a counter metric.
   *
   * @param name - Metric name.
   * @param help - Help text for the metric.
   * @param labels - Label names.
   */
  counter(name: string, help: string, labels?: string[]): CounterMetric {
    const existing = this.counters.get(name);
    if (existing) return existing;
    const metric = new CounterMetricImpl(name, help, labels);
    this.counters.set(name, metric);
    return metric;
  }

  /**
   * Register a gauge metric.
   *
   * @param name - Metric name.
   * @param help - Help text for the metric.
   * @param labels - Label names.
   */
  gauge(name: string, help: string, labels?: string[]): GaugeMetric {
    const existing = this.gauges.get(name);
    if (existing) return existing;
    const metric = new GaugeMetricImpl(name, help, labels);
    this.gauges.set(name, metric);
    return metric;
  }

  /**
   * Register a histogram metric.
   *
   * @param name - Metric name.
   * @param help - Help text for the metric.
   * @param buckets - Bucket boundaries (default: prometheus defaults).
   * @param labels - Label names.
   */
  histogram(
    name: string,
    help: string,
    buckets?: number[],
    labels?: string[]
  ): HistogramMetric {
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const metric = new HistogramMetricImpl(name, help, buckets, labels);
    this.histograms.set(name, metric);
    return metric;
  }

  /**
   * Export all metrics in Prometheus text exposition format.
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const metric of this.counters.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      const entries = metric.exportEntries();
      if (entries.length === 0) {
        lines.push(`${metric.name} 0`);
      } else {
        for (const entry of entries) {
          const labelStr = serializeLabels(entry.labels);
          lines.push(`${metric.name}${labelStr} ${entry.value}`);
        }
      }
      lines.push('');
    }

    // Gauges
    for (const metric of this.gauges.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      const entries = metric.exportEntries();
      if (entries.length === 0) {
        lines.push(`${metric.name} 0`);
      } else {
        for (const entry of entries) {
          const labelStr = serializeLabels(entry.labels);
          lines.push(`${metric.name}${labelStr} ${entry.value}`);
        }
      }
      lines.push('');
    }

    // Histograms
    for (const metric of this.histograms.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      const entries = metric.exportEntries();

      if (entries.length === 0) {
        lines.push(`${metric.name}_bucket{le="+Inf"} 0`);
        lines.push(`${metric.name}_sum 0`);
        lines.push(`${metric.name}_count 0`);
      } else {
        for (const entry of entries) {
          const labelStr = serializeLabels(entry.labels);
          let cumulative = 0;
          for (let i = 0; i < metric.buckets.length; i++) {
            cumulative += entry.bucketCounts[i];
            const le =
              metric.buckets[i] === Number.POSITIVE_INFINITY
                ? '+Inf'
                : String(metric.buckets[i]);
            const bucketLabels = {
              ...entry.labels,
              le,
            };
            lines.push(
              `${metric.name}_bucket${serializeLabels(bucketLabels)} ${cumulative}`
            );
          }
          // +Inf bucket (total count)
          const infLabels = { ...entry.labels, le: '+Inf' };
          lines.push(
            `${metric.name}_bucket${serializeLabels(infLabels)} ${entry.count}`
          );
          lines.push(
            `${metric.name}_sum${serializeLabels(entry.labels)} ${entry.sum}`
          );
          lines.push(
            `${metric.name}_count${serializeLabels(entry.labels)} ${entry.count}`
          );
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Export all metrics as a JSON-compatible object.
   */
  exportJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const counterData: Record<string, unknown> = {};
    for (const [name, metric] of this.counters) {
      counterData[name] = metric.exportEntries().map((e) => ({
        value: e.value,
        labels: e.labels,
      }));
    }
    result.counters = counterData;

    const gaugeData: Record<string, unknown> = {};
    for (const [name, metric] of this.gauges) {
      gaugeData[name] = metric.exportEntries().map((e) => ({
        value: e.value,
        labels: e.labels,
      }));
    }
    result.gauges = gaugeData;

    const histogramData: Record<string, unknown> = {};
    for (const [name, metric] of this.histograms) {
      histogramData[name] = metric.exportEntries().map((e) => ({
        count: e.count,
        sum: e.sum,
        bucketCounts: e.bucketCounts,
        buckets: metric.buckets,
        labels: e.labels,
      }));
    }
    result.histograms = histogramData;

    return result;
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    for (const metric of this.counters.values()) metric.reset();
    for (const metric of this.gauges.values()) metric.reset();
    for (const metric of this.histograms.values()) metric.reset();
  }
}

// ---------------------------------------------------------------------------
// Standard Metrics Factory
// ---------------------------------------------------------------------------

/**
 * Create a MetricsRegistry pre-populated with standard application metrics.
 *
 * Pre-built metrics:
 * - http_requests_total (counter)
 * - http_request_duration_seconds (histogram)
 * - analysis_files_total (counter)
 * - analysis_duration_seconds (histogram)
 * - store_nodes_total (gauge)
 * - store_edges_total (gauge)
 * - review_comments_total (counter)
 * - tool_calls_total (counter)
 * - memory_usage_bytes (gauge)
 * - active_connections (gauge)
 */
export function createStandardMetrics(): MetricsRegistry {
  const registry = new MetricsRegistry();

  registry.counter(
    'http_requests_total',
    'Total number of HTTP requests',
    ['method', 'status']
  );

  registry.histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    undefined,
    ['method']
  );

  registry.counter(
    'analysis_files_total',
    'Total number of files analyzed',
    ['language']
  );

  registry.histogram(
    'analysis_duration_seconds',
    'Analysis duration in seconds'
  );

  registry.gauge(
    'store_nodes_total',
    'Total number of nodes in the graph store'
  );

  registry.gauge(
    'store_edges_total',
    'Total number of edges in the graph store'
  );

  registry.counter(
    'review_comments_total',
    'Total number of review comments generated',
    ['severity']
  );

  registry.counter(
    'tool_calls_total',
    'Total number of MCP tool invocations',
    ['tool']
  );

  registry.gauge('memory_usage_bytes', 'Current memory usage in bytes');

  registry.gauge('active_connections', 'Number of active connections');

  return registry;
}
