import { describe, it, expect, beforeEach } from 'vitest';

import { DefaultMetricsCollector, NoopMetricsCollector, createMetrics } from '../metrics/index.js';

import type { MetricsCollector } from '../metrics/index.js';

describe('DefaultMetricsCollector', () => {
  let metrics: DefaultMetricsCollector;

  beforeEach(() => {
    metrics = new DefaultMetricsCollector();
  });

  describe('counters', () => {
    it('should increment a counter from 0', () => {
      metrics.incrementCounter('requests');
      expect(metrics.getCounter('requests')).toBe(1);
    });

    it('should increment by a custom value', () => {
      metrics.incrementCounter('requests', 5);
      expect(metrics.getCounter('requests')).toBe(5);
    });

    it('should accumulate increments', () => {
      metrics.incrementCounter('requests', 3);
      metrics.incrementCounter('requests', 2);
      expect(metrics.getCounter('requests')).toBe(5);
    });

    it('should support tags for dimensional metrics', () => {
      metrics.incrementCounter('requests', 1, { method: 'GET' });
      metrics.incrementCounter('requests', 1, { method: 'POST' });
      metrics.incrementCounter('requests', 1, { method: 'GET' });

      expect(metrics.getCounter('requests', { method: 'GET' })).toBe(2);
      expect(metrics.getCounter('requests', { method: 'POST' })).toBe(1);
    });

    it('should support multiple tags (multi-dimensional)', () => {
      metrics.incrementCounter('http', 1, { method: 'GET', status: '200' });
      metrics.incrementCounter('http', 1, { method: 'GET', status: '404' });
      metrics.incrementCounter('http', 1, { method: 'POST', status: '200' });

      expect(metrics.getCounter('http', { method: 'GET', status: '200' })).toBe(1);
      expect(metrics.getCounter('http', { method: 'GET', status: '404' })).toBe(1);
      expect(metrics.getCounter('http', { method: 'POST', status: '200' })).toBe(1);
    });

    it('should return 0 for non-existent counters', () => {
      expect(metrics.getCounter('nonexistent')).toBe(0);
    });

    it('should increment by zero (no change)', () => {
      metrics.incrementCounter('zero-inc', 0);
      expect(metrics.getCounter('zero-inc')).toBe(0);
    });

    it('should handle negative increment', () => {
      metrics.incrementCounter('neg-counter', 10);
      metrics.incrementCounter('neg-counter', -3);
      expect(metrics.getCounter('neg-counter')).toBe(7);
    });

    it('should handle large concurrent-style increments', () => {
      for (let i = 0; i < 1000; i++) {
        metrics.incrementCounter('concurrent-counter');
      }
      expect(metrics.getCounter('concurrent-counter')).toBe(1000);
    });
  });

  describe('gauges', () => {
    it('should set a gauge to a value', () => {
      metrics.setGauge('memory', 1024);
      expect(metrics.getGauge('memory')).toBe(1024);
    });

    it('should overwrite previous gauge values', () => {
      metrics.setGauge('cpu', 50);
      metrics.setGauge('cpu', 75);
      expect(metrics.getGauge('cpu')).toBe(75);
    });

    it('should support tags for gauges', () => {
      metrics.setGauge('temp', 60, { location: 'room1' });
      metrics.setGauge('temp', 70, { location: 'room2' });

      expect(metrics.getGauge('temp', { location: 'room1' })).toBe(60);
      expect(metrics.getGauge('temp', { location: 'room2' })).toBe(70);
    });

    it('should return 0 for non-existent gauges', () => {
      expect(metrics.getGauge('nonexistent')).toBe(0);
    });

    it('should handle negative gauge values', () => {
      metrics.setGauge('temperature', -10);
      expect(metrics.getGauge('temperature')).toBe(-10);
    });

    it('should handle zero gauge value', () => {
      metrics.setGauge('zero-gauge', 100);
      metrics.setGauge('zero-gauge', 0);
      expect(metrics.getGauge('zero-gauge')).toBe(0);
    });

    it('should handle fractional gauge values', () => {
      metrics.setGauge('fraction', 3.14159);
      expect(metrics.getGauge('fraction')).toBeCloseTo(3.14159);
    });
  });

  describe('histograms', () => {
    it('should record durations', () => {
      metrics.recordDuration('latency', 0.5);
      metrics.recordDuration('latency', 1.2);

      const hist = metrics.getHistogram('latency');
      expect(hist).toBeDefined();
      expect(hist!.count).toBe(2);
      expect(hist!.sum).toBeCloseTo(1.7);
      expect(hist!.values).toHaveLength(2);
    });

    it('should return undefined for non-existent histograms', () => {
      expect(metrics.getHistogram('nonexistent')).toBeUndefined();
    });

    it('should support tags for histograms', () => {
      metrics.recordDuration('latency', 0.1, { endpoint: '/api' });
      metrics.recordDuration('latency', 0.2, { endpoint: '/api' });
      metrics.recordDuration('latency', 5.0, { endpoint: '/slow' });

      const api = metrics.getHistogram('latency', { endpoint: '/api' });
      const slow = metrics.getHistogram('latency', { endpoint: '/slow' });

      expect(api!.count).toBe(2);
      expect(api!.sum).toBeCloseTo(0.3);
      expect(slow!.count).toBe(1);
      expect(slow!.sum).toBe(5.0);
    });

    it('should handle histogram boundary edge case (value exactly at boundary)', () => {
      metrics.recordDuration('boundary', 0.005);
      const hist = metrics.getHistogram('boundary');
      expect(hist).toBeDefined();
      expect(hist!.count).toBe(1);
      expect(hist!.sum).toBeCloseTo(0.005);
    });

    it('should handle histogram with very large values', () => {
      metrics.recordDuration('large', 1000000);
      const hist = metrics.getHistogram('large');
      expect(hist).toBeDefined();
      expect(hist!.count).toBe(1);
      expect(hist!.sum).toBe(1000000);
    });

    it('should handle histogram with zero duration', () => {
      metrics.recordDuration('zero-duration', 0);
      const hist = metrics.getHistogram('zero-duration');
      expect(hist).toBeDefined();
      expect(hist!.count).toBe(1);
      expect(hist!.sum).toBe(0);
    });

    it('should handle histogram with negative duration', () => {
      metrics.recordDuration('neg-duration', -1.0);
      const hist = metrics.getHistogram('neg-duration');
      expect(hist).toBeDefined();
      expect(hist!.count).toBe(1);
      expect(hist!.sum).toBe(-1.0);
    });

    it('should handle concurrent histogram observations', () => {
      for (let i = 0; i < 100; i++) {
        metrics.recordDuration('concurrent-latency', i * 0.01);
      }
      const hist = metrics.getHistogram('concurrent-latency');
      expect(hist!.count).toBe(100);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', () => {
      metrics.incrementCounter('req', 5);
      metrics.setGauge('mem', 100);
      metrics.recordDuration('lat', 1.0);

      metrics.reset();

      expect(metrics.getCounter('req')).toBe(0);
      expect(metrics.getGauge('mem')).toBe(0);
      expect(metrics.getHistogram('lat')).toBeUndefined();
    });
  });
});

describe('NoopMetricsCollector', () => {
  let metrics: NoopMetricsCollector;

  beforeEach(() => {
    metrics = new NoopMetricsCollector();
  });

  it('should not increment counters', () => {
    metrics.incrementCounter('requests', 10);
    expect(metrics.getCounter('requests')).toBe(0);
  });

  it('should not record durations', () => {
    metrics.recordDuration('latency', 5.0);
    expect(metrics.getHistogram('latency')).toBeUndefined();
  });

  it('should not set gauges', () => {
    metrics.setGauge('memory', 1024);
    expect(metrics.getGauge('memory')).toBe(0);
  });

  it('should handle reset gracefully', () => {
    metrics.reset();
    // No throw
  });

  it('should satisfy MetricsCollector interface', () => {
    const collector: MetricsCollector = metrics;
    expect(collector).toBeDefined();
  });
});

describe('createMetrics', () => {
  it('should return a DefaultMetricsCollector instance', () => {
    const metrics = createMetrics();
    expect(metrics).toBeInstanceOf(DefaultMetricsCollector);
  });

  it('should satisfy MetricsCollector interface', () => {
    const metrics = createMetrics();
    // Verify it has all interface methods
    expect(typeof metrics.incrementCounter).toBe('function');
    expect(typeof metrics.recordDuration).toBe('function');
    expect(typeof metrics.setGauge).toBe('function');
    expect(typeof metrics.getCounter).toBe('function');
    expect(typeof metrics.getGauge).toBe('function');
    expect(typeof metrics.getHistogram).toBe('function');
    expect(typeof metrics.reset).toBe('function');
  });
});
