/**
 * Metrics Collector — tag-based dimensional metrics with Counter, Histogram, and Gauge.
 */

/** A single value within a counter. */
interface CounterValue {
  name: string;
  tags: Record<string, string>;
  value: number;
}

/** A histogram bucket definition. */
interface HistogramBucket {
  le: number; // "less than or equal"
  count: number;
}

/** A single histogram instance. */
interface HistogramValue {
  name: string;
  tags: Record<string, string>;
  values: number[];
  sum: number;
  count: number;
  buckets: HistogramBucket[];
}

/** A single gauge value. */
interface GaugeValue {
  name: string;
  tags: Record<string, string>;
  value: number;
}

/**
 * Metrics collector with Counter, Histogram, and Gauge operations.
 * Supports tag-based dimensional metrics for aggregation.
 */
export interface MetricsCollector {
  /**
   * Increment a counter by the given value (default: 1).
   */
  incrementCounter(name: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record a duration value in a histogram.
   */
  recordDuration(name: string, duration: number, tags?: Record<string, string>): void;

  /**
   * Set a gauge to an absolute value.
   */
  setGauge(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * Get the current value of a counter.
   */
  getCounter(name: string, tags?: Record<string, string>): number;

  /**
   * Get the current value of a gauge.
   */
  getGauge(name: string, tags?: Record<string, string>): number;

  /**
   * Get histogram data for a named histogram.
   */
  getHistogram(name: string, tags?: Record<string, string>): { values: number[]; count: number; sum: number } | undefined;

  /**
   * Reset all metrics.
   */
  reset(): void;
}

/**
 * Generate a stable key from a name and tag set.
 */
function tagsKey(name: string, tags: Record<string, string> = {}): string {
  const tagStr = Object.entries(tags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return tagStr ? `${name}[${tagStr}]` : name;
}

/**
 * Default MetricsCollector implementation with in-memory storage.
 */
export class DefaultMetricsCollector implements MetricsCollector {
  private counters = new Map<string, CounterValue>();
  private histograms = new Map<string, HistogramValue>();
  private gauges = new Map<string, GaugeValue>();

  // Default histogram bucket boundaries
  private defaultBuckets: number[] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
  ];

  incrementCounter(name: string, value = 1, tags?: Record<string, string>): void {
    const key = tagsKey(name, tags);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, {
        name,
        tags: tags ?? {},
        value,
      });
    }
  }

  recordDuration(name: string, duration: number, tags?: Record<string, string>): void {
    const key = tagsKey(name, tags);
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = {
        name,
        tags: tags ?? {},
        values: [],
        sum: 0,
        count: 0,
        buckets: this.defaultBuckets.map((le) => ({ le, count: 0 })),
      };
      this.histograms.set(key, hist);
    }

    hist.values.push(duration);
    hist.sum += duration;
    hist.count++;

    // Update buckets
    for (const bucket of hist.buckets) {
      if (duration <= bucket.le) {
        bucket.count++;
      }
    }
  }

  setGauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = tagsKey(name, tags);
    this.gauges.set(key, {
      name,
      tags: tags ?? {},
      value,
    });
  }

  getCounter(name: string, tags?: Record<string, string>): number {
    const key = tagsKey(name, tags);
    return this.counters.get(key)?.value ?? 0;
  }

  getGauge(name: string, tags?: Record<string, string>): number {
    const key = tagsKey(name, tags);
    return this.gauges.get(key)?.value ?? 0;
  }

  getHistogram(name: string, tags?: Record<string, string>): { values: number[]; count: number; sum: number } | undefined {
    const key = tagsKey(name, tags);
    const hist = this.histograms.get(key);
    if (!hist) return undefined;
    return {
      values: [...hist.values],
      count: hist.count,
      sum: hist.sum,
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}
