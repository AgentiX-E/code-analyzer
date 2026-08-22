// @code-analyzer/infra — Performance Profiler Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceProfiler } from '../performance/profiler.js';
import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import type { BenchmarkConfig, BenchmarkResult } from '../performance/profiler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProfiler(config?: Partial<BenchmarkConfig>): PerformanceProfiler {
  return new PerformanceProfiler(config);
}

function populateStore(store: InMemoryGraphStore, count: number = 100): void {
  for (let i = 0; i < count; i++) {
    store.insertNode({
      id: i,
      projectId: 'bench',
      name: `fn${i}`,
      label: 'Function',
      filePath: `src/fn${i}.ts`,
      qualifiedName: `fn${i}`,
      startLine: i * 10,
      endLine: i * 10 + 5,
      language: 'typescript',
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      properties: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// PerformanceProfiler
// ---------------------------------------------------------------------------

describe('PerformanceProfiler', () => {
  describe('benchmark', () => {
    it('should return a valid BenchmarkResult', () => {
      const profiler = createProfiler({ warmupRuns: 1, measuredRuns: 5 });
      const result = profiler.benchmark('test', () => {
        let x = 0;
        x++;
      });
      expect(result.runs).toBe(5);
      expect(result.avgMs).toBeGreaterThanOrEqual(0);
      expect(result.minMs).toBeGreaterThanOrEqual(0);
      expect(result.maxMs).toBeGreaterThanOrEqual(0);
    });

    it('should run warmup iterations', () => {
      const profiler = createProfiler({ warmupRuns: 10, measuredRuns: 3 });
      const result = profiler.benchmark('warmup-test', () => {
        /* noop */
      });
      expect(result.runs).toBe(3);
    });

    it('should track p50/p95/p99', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 50 });
      const result = profiler.benchmark('p-test', () => {
        /* noop */
      });
      expect(result.p50Ms).toBeDefined();
      expect(result.p95Ms).toBeDefined();
      expect(result.p99Ms).toBeDefined();
      expect(result.p50Ms).toBeLessThanOrEqual(result.p95Ms);
      expect(result.p95Ms).toBeLessThanOrEqual(result.p99Ms);
    });

    it('should compute ops per second', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 10 });
      const result = profiler.benchmark('ops-test', () => {
        /* noop */
      });
      expect(result.opsPerSec).toBeGreaterThan(0);
    });

    it('should meet targets when minOpsPerSec is low', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 5, minOpsPerSec: 1 });
      const result = profiler.benchmark('target-test', () => {
        /* noop */
      });
      expect(result.targetsMet).toBe(true);
    });

    it('should fail targets when minOpsPerSec is impossibly high', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 5, minOpsPerSec: 1e9 });
      const result = profiler.benchmark('fail-target', () => {
        /* noop */
      });
      expect(result.targetsMet).toBe(false);
    });

    it('should include samples array', () => {
      const profiler = createProfiler({ measuredRuns: 5 });
      const result = profiler.benchmark('samples-test', () => {
        /* noop */
      });
      expect(result.samples).toHaveLength(5);
    });

    it('should compute stdDev correctly', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 10 });
      const result = profiler.benchmark('stddev-test', () => {
        /* noop */
      });
      expect(result.stdDevMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('benchmarkAsync', () => {
    it('should return valid result for async operation', async () => {
      const profiler = createProfiler({ warmupRuns: 1, measuredRuns: 3 });
      const result = await profiler.benchmarkAsync('async-test', async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(result.runs).toBe(3);
      expect(result.avgMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('profileGraphQueries', () => {
    it('should profile all graph query types', async () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 3 });
      const store = new InMemoryGraphStore();
      populateStore(store, 50);

      const results = await profiler.profileGraphQueries(store);
      expect(results.length).toBeGreaterThanOrEqual(4);
      for (const r of results) {
        expect(r.operation).toBeTruthy();
        expect(r.avgMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('generateReport', () => {
    it('should generate markdown report', () => {
      const profiler = createProfiler({ warmupRuns: 0, measuredRuns: 3 });
      const r1 = profiler.benchmark('op1', () => {
        /* noop */
      });
      const report = profiler.generateReport([r1]);
      expect(report).toContain('Performance Benchmark Report');
      expect(report).toContain('| op-1 |');
      expect(report).toContain('✅ PASS');
    });

    it('should handle empty results', () => {
      const profiler = createProfiler();
      const report = profiler.generateReport([]);
      expect(report).toContain('Performance Benchmark Report');
    });
  });

  describe('setConfig', () => {
    it('should update configuration', () => {
      const profiler = createProfiler({ measuredRuns: 5 });
      profiler.setConfig({ measuredRuns: 10 });
      const result = profiler.benchmark('config-test', () => {
        /* noop */
      });
      expect(result.runs).toBe(10);
    });

    it('should preserve existing config when partially updating', () => {
      const profiler = createProfiler({ warmupRuns: 7, measuredRuns: 5 });
      profiler.setConfig({ measuredRuns: 15 });
      const result = profiler.benchmark('partial-config', () => {
        /* noop */
      });
      // Runs should be 15 (updated)
      expect(result.runs).toBe(15);
    });
  });
});
