import { describe, it, expect, beforeEach } from 'vitest';

import {
  MetricsRegistry,
  createStandardMetrics,
} from '../operations/metrics-exporter.js';

import type { CounterMetric, GaugeMetric, HistogramMetric } from '../operations/metrics-exporter.js';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  describe('counter', () => {
    it('should create and increment a counter', () => {
      const c = registry.counter('test_counter', 'A test counter');
      expect(c.get()).toBe(0);
      c.inc();
      expect(c.get()).toBe(1);
    });

    it('should increment by a custom value', () => {
      const c = registry.counter('test_counter', 'A test counter');
      c.inc(5);
      expect(c.get()).toBe(5);
    });

    it('should accumulate increments', () => {
      const c = registry.counter('test_counter', 'A test counter');
      c.inc(2);
      c.inc(3);
      expect(c.get()).toBe(5);
    });

    it('should support labels', () => {
      const c = registry.counter('http_requests', 'HTTP requests', ['method', 'status']);
      c.inc(1, { method: 'GET', status: '200' });
      c.inc(1, { method: 'POST', status: '201' });
      c.inc(1, { method: 'GET', status: '200' });

      expect(c.get({ method: 'GET', status: '200' })).toBe(2);
      expect(c.get({ method: 'POST', status: '201' })).toBe(1);
    });

    it('should return 0 for non-existent label combination', () => {
      const c = registry.counter('test_counter', 'A test counter', ['method']);
      c.inc(1, { method: 'GET' });
      expect(c.get({ method: 'PUT' })).toBe(0);
    });

    it('should return the same metric instance when called again', () => {
      const c1 = registry.counter('test_counter', 'A test counter');
      const c2 = registry.counter('test_counter', 'Different help');
      expect(c1).toBe(c2);
    });
  });

  describe('gauge', () => {
    it('should set a gauge value', () => {
      const g = registry.gauge('memory_usage', 'Memory usage');
      g.set(1024);
      expect(g.get()).toBe(1024);
    });

    it('should overwrite previous gauge values', () => {
      const g = registry.gauge('cpu_usage', 'CPU usage');
      g.set(50);
      g.set(75);
      expect(g.get()).toBe(75);
    });

    it('should increment a gauge', () => {
      const g = registry.gauge('connections', 'Active connections');
      g.set(10);
      g.inc(5);
      expect(g.get()).toBe(15);
      g.inc();
      expect(g.get()).toBe(16);
    });

    it('should decrement a gauge', () => {
      const g = registry.gauge('connections', 'Active connections');
      g.set(10);
      g.dec(3);
      expect(g.get()).toBe(7);
      g.dec();
      expect(g.get()).toBe(6);
    });

    it('should support labels', () => {
      const g = registry.gauge('temperature', 'Temperature', ['location']);
      g.set(25, { location: 'room1' });
      g.set(30, { location: 'room2' });

      expect(g.get({ location: 'room1' })).toBe(25);
      expect(g.get({ location: 'room2' })).toBe(30);
    });

    it('should return 0 for non-existent gauge', () => {
      const g = registry.gauge('test_gauge', 'Test');
      expect(g.get()).toBe(0);
    });

    it('should return the same gauge instance when called again', () => {
      const g1 = registry.gauge('test_gauge', 'Test');
      const g2 = registry.gauge('test_gauge', 'Different');
      expect(g1).toBe(g2);
    });
  });

  describe('histogram', () => {
    it('should observe values', () => {
      const h = registry.histogram('request_duration', 'Request duration');
      h.observe(0.5);
      h.observe(1.2);

      const data = h.get();
      expect(data.count).toBe(2);
      expect(data.sum).toBeCloseTo(1.7);
    });

    it('should count observations in buckets', () => {
      const h = registry.histogram('latency', 'Latency', [0.1, 0.5, 1.0, 5.0]);
      h.observe(0.05);
      h.observe(0.3);
      h.observe(2.0);

      const data = h.get();
      // 0.05 goes into 0.1 bucket
      expect(data.buckets['0.1']).toBe(1);
      // 0.3 goes into 0.5 bucket (and 0.1 bucket)
      expect(data.buckets['0.5']).toBe(2);
      // 2.0 goes into 5.0 bucket (and all lower buckets)
      expect(data.buckets['5']).toBe(3);
    });

    it('should support labels', () => {
      const h = registry.histogram('request_size', 'Request size', undefined, ['endpoint']);
      h.observe(100, { endpoint: '/api' });
      h.observe(200, { endpoint: '/api' });
      h.observe(5000, { endpoint: '/upload' });

      const api = h.get({ endpoint: '/api' });
      const upload = h.get({ endpoint: '/upload' });

      expect(api.count).toBe(2);
      expect(api.sum).toBe(300);
      expect(upload.count).toBe(1);
      expect(upload.sum).toBe(5000);
    });

    it('should return empty data for non-existent label combination', () => {
      const h = registry.histogram('test_hist', 'Test');
      h.observe(1.0);
      const data = h.get({ endpoint: '/nonexistent' });
      expect(data.count).toBe(0);
      expect(data.sum).toBe(0);
    });

    it('should return the same histogram instance when called again', () => {
      const h1 = registry.histogram('test_hist', 'Test');
      const h2 = registry.histogram('test_hist', 'Different');
      expect(h1).toBe(h2);
    });
  });

  describe('exportPrometheus', () => {
    it('should export counters in Prometheus format', () => {
      const c = registry.counter('test_total', 'Test counter');
      c.inc(3);

      const output = registry.exportPrometheus();
      expect(output).toContain('# HELP test_total Test counter');
      expect(output).toContain('# TYPE test_total counter');
      expect(output).toContain('test_total 3');
    });

    it('should export gauges in Prometheus format', () => {
      const g = registry.gauge('memory_bytes', 'Memory');
      g.set(2048);

      const output = registry.exportPrometheus();
      expect(output).toContain('# HELP memory_bytes Memory');
      expect(output).toContain('# TYPE memory_bytes gauge');
      expect(output).toContain('memory_bytes 2048');
    });

    it('should export histograms in Prometheus format', () => {
      const h = registry.histogram('latency_seconds', 'Latency', [0.1, 0.5, 1.0]);
      h.observe(0.3);

      const output = registry.exportPrometheus();
      expect(output).toContain('# HELP latency_seconds Latency');
      expect(output).toContain('# TYPE latency_seconds histogram');
      expect(output).toContain('latency_seconds_bucket{le="0.1"} 0');
      expect(output).toContain('latency_seconds_bucket{le="0.5"} 1');
      expect(output).toContain('latency_seconds_bucket{le="+Inf"} 1');
      expect(output).toContain('latency_seconds_sum 0.3');
      expect(output).toContain('latency_seconds_count 1');
    });

    it('should export labeled metrics correctly', () => {
      const c = registry.counter('http_requests_total', 'HTTP requests', ['method']);
      c.inc(1, { method: 'GET' });
      c.inc(1, { method: 'POST' });

      const output = registry.exportPrometheus();
      expect(output).toContain('http_requests_total{method="GET"} 1');
      expect(output).toContain('http_requests_total{method="POST"} 1');
    });

    it('should export empty histogram correctly', () => {
      registry.histogram('empty_hist', 'Empty histogram');
      const output = registry.exportPrometheus();
      expect(output).toContain('empty_hist');
      expect(output).toContain('_bucket');
      expect(output).toContain('_sum');
      expect(output).toContain('_count');
    });

    it('should escape double quotes in label values', () => {
      const g = registry.gauge('test_gauge', 'Test', ['key']);
      g.set(1, { key: 'value"with"quotes' });

      const output = registry.exportPrometheus();
      expect(output).toContain('key="value\\"with\\"quotes"');
    });

    it('should handle cumulative histogram buckets correctly', () => {
      const h = registry.histogram('hist', 'Histogram', [1.0, 5.0, 10.0]);
      h.observe(3.0);
      h.observe(7.0);

      const output = registry.exportPrometheus();
      // +Inf bucket should equal total count
      expect(output).toContain('hist_bucket{le="+Inf"} 2');
      // le=5 should have count 1 (value 3.0 only)
      expect(output).toContain('hist_bucket{le="5"} 1');
    });
  });

  describe('exportJSON', () => {
    it('should export counters as JSON', () => {
      const c = registry.counter('test_counter', 'Test');
      c.inc(42);

      const json = registry.exportJSON();
      const counters = json.counters as Record<string, unknown>;
      expect(counters).toBeDefined();
      const entries = counters.test_counter as Array<{ value: number }>;
      expect(entries[0].value).toBe(42);
    });

    it('should export gauges as JSON', () => {
      const g = registry.gauge('test_gauge', 'Test');
      g.set(99);

      const json = registry.exportJSON();
      const gauges = json.gauges as Record<string, unknown>;
      expect(gauges).toBeDefined();
      const entries = gauges.test_gauge as Array<{ value: number }>;
      expect(entries[0].value).toBe(99);
    });

    it('should export histograms as JSON with bucket data', () => {
      const h = registry.histogram('test_hist', 'Test', [0.5, 1.0]);
      h.observe(0.3);

      const json = registry.exportJSON();
      const histograms = json.histograms as Record<string, unknown>;
      expect(histograms).toBeDefined();
      const entries = histograms.test_hist as Array<{ count: number; sum: number; bucketCounts: number[]; buckets: number[] }>;
      expect(entries[0].count).toBe(1);
      expect(entries[0].sum).toBe(0.3);
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      const c = registry.counter('test_counter', 'Test');
      c.inc(10);
      const g = registry.gauge('test_gauge', 'Test');
      g.set(100);
      const h = registry.histogram('test_hist', 'Test');
      h.observe(1.0);

      registry.reset();

      expect(c.get()).toBe(0);
      expect(g.get()).toBe(0);
      expect(h.get().count).toBe(0);
    });
  });
});

describe('createStandardMetrics', () => {
  it('should create a registry with standard metrics', () => {
    const registry = createStandardMetrics();
    expect(registry).toBeInstanceOf(MetricsRegistry);

    // All standard metrics should be accessible
    const prom = registry.exportPrometheus();
    expect(prom).toContain('http_requests_total');
    expect(prom).toContain('http_request_duration_seconds');
    expect(prom).toContain('analysis_files_total');
    expect(prom).toContain('analysis_duration_seconds');
    expect(prom).toContain('store_nodes_total');
    expect(prom).toContain('store_edges_total');
    expect(prom).toContain('review_comments_total');
    expect(prom).toContain('tool_calls_total');
    expect(prom).toContain('memory_usage_bytes');
    expect(prom).toContain('active_connections');
  });

  it('should create usable counter with labels', () => {
    const registry = createStandardMetrics();
    const prom1 = registry.exportPrometheus();
    // Verify http_requests_total has HELP and TYPE
    expect(prom1).toContain('# HELP http_requests_total');
    expect(prom1).toContain('# TYPE http_requests_total counter');

    // Verify histogram has buckets
    expect(prom1).toContain('http_request_duration_seconds_bucket');
  });
});
