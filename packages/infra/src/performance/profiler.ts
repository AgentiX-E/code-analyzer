// @code-analyzer/infra — Performance Profiler
// Query benchmark suite and hot-path optimization toolkit.
// Measures and reports query latency, throughput, and memory usage.

import { performance } from 'node:perf_hooks';
import type { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkConfig {
  /** Number of warmup iterations (results discarded) */
  warmupRuns: number;
  /** Number of measured iterations */
  measuredRuns: number;
  /** Minimum acceptable operations per second */
  minOpsPerSec?: number;
  /** Maximum acceptable p99 latency in milliseconds */
  maxP99Ms?: number;
  /** Run GC between iterations if available */
  gcBetweenRuns?: boolean;
}

export interface BenchmarkResult {
  config: BenchmarkConfig;
  /** Operations per second */
  opsPerSec: number;
  /** Average latency in milliseconds */
  avgMs: number;
  /** Median (p50) latency in milliseconds */
  p50Ms: number;
  /** p95 latency in milliseconds */
  p95Ms: number;
  /** p99 latency in milliseconds */
  p99Ms: number;
  /** Minimum latency in milliseconds */
  minMs: number;
  /** Maximum latency in milliseconds */
  maxMs: number;
  /** Standard deviation of latencies */
  stdDevMs: number;
  /** Total elapsed time for measured runs in milliseconds */
  totalMs: number;
  /** Number of runs */
  runs: number;
  /** Whether performance targets were met */
  targetsMet: boolean;
  /** Per-run latencies (for analysis) */
  samples: number[];
}

export interface QueryLatencyResult {
  operation: string;
  avgMs: number;
  p99Ms: number;
  opsPerSec: number;
  targetMs: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Default Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BenchmarkConfig = {
  warmupRuns: 3,
  measuredRuns: 20,
  gcBetweenRuns: false,
};

// ---------------------------------------------------------------------------
// Performance Profiler
// ---------------------------------------------------------------------------

export class PerformanceProfiler {
  private config: BenchmarkConfig;

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Benchmark a synchronous operation.
   */
  benchmark(_name: string, fn: () => void): BenchmarkResult {
    return this.runBenchmark(fn);
  }

  /**
   * Benchmark an asynchronous operation.
   */
  async benchmarkAsync(_name: string, fn: () => Promise<void>): Promise<BenchmarkResult> {
    return this.runBenchmarkAsync(fn);
  }

  /**
   * Profile graph store query operations across multiple query types.
   */
  async profileGraphQueries(store: InMemoryGraphStore): Promise<QueryLatencyResult[]> {
    const results: QueryLatencyResult[] = [];

    // Test: node lookup by ID
    results.push(await this.profileSingleQuery('getNode', 5, () => store.getNode(0)));

    // Test: query all nodes
    results.push(
      await this.profileSingleQuery('queryNodes', 20, () =>
        store.queryNodes({ projectId: 'bench', limit: 100, offset: 0 }),
      ),
    );

    // Test: get all nodes
    results.push(await this.profileSingleQuery('getAllNodes', 20, () => store.getAllNodes()));

    // Test: insert node
    results.push(
      await this.profileSingleQuery('insertNode', 10, () =>
        store.insertNode({
          id: Math.floor(Math.random() * 1e9),
          projectId: 'bench',
          name: `benchFn_${Math.random().toString(36).slice(2)}`,
          label: 'Function',
          filePath: 'bench.ts',
          qualifiedName: `benchFn_${Math.random().toString(36).slice(2)}_${Date.now()}`,
          startLine: 1,
          endLine: 10,
          language: 'typescript',
          signature: null,
          docstring: null,
          complexity: null,
          isExported: false,
          fingerprint: null,
          properties: { name: 'benchFn' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      ),
    );

    // Test: get edges
    results.push(
      await this.profileSingleQuery('getEdgesForNode', 10, () =>
        store.getEdgesForNode(0, undefined, 'out'),
      ),
    );

    return results;
  }

  /**
   * Generate a human-readable benchmark report.
   */
  generateReport(results: BenchmarkResult[]): string {
    const lines: string[] = [
      '# Performance Benchmark Report',
      '',
      '| Operation | Runs | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Min (ms) | Max (ms) | Ops/sec |',
      '|-----------|------|----------|----------|----------|----------|----------|----------|---------|',
    ];

    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      lines.push(
        `| op-${i + 1} | ${r.runs} | ${r.avgMs.toFixed(3)} | ${r.p50Ms.toFixed(3)} | ` +
          `${r.p95Ms.toFixed(3)} | ${r.p99Ms.toFixed(3)} | ${r.minMs.toFixed(3)} | ${r.maxMs.toFixed(3)} | ` +
          `${r.opsPerSec.toFixed(0)} |`,
      );
    }

    lines.push('');
    lines.push('## Targets');
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      lines.push(`- op-${i + 1}: ${r.targetsMet ? '✅ PASS' : '❌ FAIL'}`);
    }

    return lines.join('\n');
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<BenchmarkConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private runBenchmark(fn: () => void): BenchmarkResult {
    const samples: number[] = [];

    // Warmup
    for (let i = 0; i < this.config.warmupRuns; i++) {
      fn();
    }

    // Measured runs
    for (let i = 0; i < this.config.measuredRuns; i++) {
      if (this.config.gcBetweenRuns && global.gc) {
        global.gc();
      }
      const start = performance.now();
      fn();
      const elapsed = performance.now() - start;
      samples.push(elapsed);
    }

    return this.computeStats(samples);
  }

  private async runBenchmarkAsync(fn: () => Promise<void>): Promise<BenchmarkResult> {
    const samples: number[] = [];

    for (let i = 0; i < this.config.warmupRuns; i++) {
      await fn();
    }

    for (let i = 0; i < this.config.measuredRuns; i++) {
      if (this.config.gcBetweenRuns && global.gc) {
        global.gc();
      }
      const start = performance.now();
      await fn();
      const elapsed = performance.now() - start;
      samples.push(elapsed);
    }

    return this.computeStats(samples);
  }

  private async profileSingleQuery(
    operation: string,
    targetMs: number,
    fn: () => unknown,
  ): Promise<QueryLatencyResult> {
    const result = this.runBenchmark(fn);
    return {
      operation,
      avgMs: result.avgMs,
      p99Ms: result.p99Ms,
      opsPerSec: result.opsPerSec,
      targetMs,
      passed: result.p99Ms <= targetMs,
    };
  }

  private computeStats(samples: number[]): BenchmarkResult {
    const sorted = [...samples].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sum / n;
    const p50 = sorted[Math.floor(n * 0.5)] ?? sorted[n - 1] ?? 0;
    const p95 = sorted[Math.floor(n * 0.95)] ?? sorted[n - 1] ?? 0;
    const p99 = sorted[Math.floor(n * 0.99)] ?? sorted[n - 1] ?? 0;
    const min = sorted[0] ?? 0;
    const max = sorted[n - 1] ?? 0;
    const variance = sorted.reduce((acc, s) => acc + (s - avg) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);
    const totalMs = sum;
    const opsPerSec = n > 0 ? (n / totalMs) * 1000 : 0;

    const targetsMet =
      (this.config.minOpsPerSec === undefined || opsPerSec >= this.config.minOpsPerSec) &&
      (this.config.maxP99Ms === undefined || p99 <= this.config.maxP99Ms);

    return {
      config: { ...this.config },
      opsPerSec,
      avgMs: avg,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      minMs: min,
      maxMs: max,
      stdDevMs: stdDev,
      totalMs,
      runs: n,
      targetsMet,
      samples,
    };
  }
}
