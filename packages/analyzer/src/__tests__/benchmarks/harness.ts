// @code-analyzer/analyzer — Benchmark Harness
// Provides reusable benchmarking primitives: timed execution, throughput measurement,
// memory tracking, statistical aggregation (mean, stddev, p50/p95/p99), and report generation.

import { performance } from 'node:perf_hooks';
import { memoryUsage } from 'node:process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a single benchmark case */
export interface BenchmarkCase {
  /** Unique identifier for this benchmark case */
  name: string;
  /** Category (parse, graph, search, embed, etc.) */
  category: BenchmarkCategory;
  /** Number of warm-up iterations (excluded from results) */
  warmupIterations?: number;
  /** Number of measured iterations */
  iterations: number;
  /** The function to benchmark — receives the iteration index */
  fn: (iteration: number) => Promise<void> | void;
  /** Optional setup — runs once before warmup */
  setup?: () => Promise<void> | void;
  /** Optional teardown — runs once after all iterations */
  teardown?: () => Promise<void> | void;
}

/** Supported benchmark categories */
export type BenchmarkCategory =
  'parse' | 'graph' | 'scope' | 'embed' | 'search' | 'heuristic' | 'review' | 'pipeline' | 'io';

/** Result of a single benchmark iteration */
export interface IterationResult {
  iteration: number;
  durationMs: number;
  /** RSS memory delta in MB since measurement start */
  memoryDeltaMB: number;
}

/** Aggregated statistics for a benchmark case */
export interface BenchmarkStats {
  name: string;
  category: BenchmarkCategory;
  iterations: number;
  duration: {
    min: number;
    max: number;
    mean: number;
    stddev: number;
    p50: number;
    p95: number;
    p99: number;
    total: number;
  };
  throughput: {
    /** Operations per second (based on mean duration and work units) */
    opsPerSec: number;
    /** Total work units */
    workUnits: number;
  };
  memory: {
    /** Peak RSS delta in MB */
    peakDeltaMB: number;
    /** Mean RSS delta in MB */
    meanDeltaMB: number;
  };
  raw: IterationResult[];
}

/** Complete benchmark suite report */
export interface BenchmarkReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemoryGB: number;
  cases: BenchmarkStats[];
  summary: {
    totalDurationMs: number;
    categoriesTested: BenchmarkCategory[];
    casesPassed: number;
    casesWithRegressions: number;
  };
}

// ---------------------------------------------------------------------------
// Statistical Helpers
// ---------------------------------------------------------------------------

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function computeStddev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Memory Tracking
// ---------------------------------------------------------------------------

/** Snapshot of current memory usage */
interface MemorySnapshot {
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
}

function takeMemorySnapshot(): MemorySnapshot {
  const usage = memoryUsage();
  return {
    rssMB: usage.rss / (1024 * 1024),
    heapUsedMB: usage.heapUsed / (1024 * 1024),
    heapTotalMB: usage.heapTotal / (1024 * 1024),
    externalMB: usage.external / (1024 * 1024),
  };
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

export class BenchmarkRunner {
  private results: BenchmarkStats[] = [];
  private baselineRssMB: number = 0;

  constructor(private readonly config: { verbose?: boolean } = {}) {
    this.baselineRssMB = takeMemorySnapshot().rssMB;
  }

  /**
   * Run a single benchmark case and collect statistics.
   */
  async runCase(benchCase: BenchmarkCase): Promise<BenchmarkStats> {
    const { name, category, warmupIterations = 3, iterations, fn, setup, teardown } = benchCase;

    if (this.config.verbose) {
      console.log(
        `\n[bench] ${category}/${name} — ${iterations} iterations (${warmupIterations} warmup)...`,
      );
    }

    // Run setup
    if (setup) {
      await setup();
    }

    // Force GC if available (Node.js --expose-gc)
    if (global.gc) {
      global.gc();
    }

    // Record baseline memory
    const baseline = takeMemorySnapshot();

    // Warm-up iterations
    for (let i = 0; i < warmupIterations; i++) {
      await fn(i);
    }

    // Measured iterations
    const iterationResults: IterationResult[] = [];
    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Force GC before each iteration if available
      if (global.gc) {
        global.gc();
      }

      const memBefore = takeMemorySnapshot();
      const startTime = performance.now();

      await fn(i);

      const endTime = performance.now();
      const memAfter = takeMemorySnapshot();

      const durationMs = endTime - startTime;
      const memoryDeltaMB = memAfter.rssMB - memBefore.rssMB;

      durations.push(durationMs);
      iterationResults.push({ iteration: i, durationMs, memoryDeltaMB });

      if (
        this.config.verbose &&
        iterations > 10 &&
        i % Math.max(1, Math.floor(iterations / 10)) === 0
      ) {
        console.log(`  iter ${i}/${iterations}: ${formatMs(durationMs)}`);
      }
    }

    // Run teardown
    if (teardown) {
      await teardown();
    }

    // Compute statistics
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const meanDur = computeMean(durations);
    const stddevDur = computeStddev(durations, meanDur);

    const memoryDeltas = iterationResults.map((r) => r.memoryDeltaMB);
    const peakMemoryMB = Math.max(...memoryDeltas, 0);
    const meanMemoryMB = computeMean(memoryDeltas);

    const stats: BenchmarkStats = {
      name,
      category,
      iterations,
      duration: {
        min: sortedDurations[0] ?? 0,
        max: sortedDurations[sortedDurations.length - 1] ?? 0,
        mean: meanDur,
        stddev: stddevDur,
        p50: computePercentile(sortedDurations, 50),
        p95: computePercentile(sortedDurations, 95),
        p99: computePercentile(sortedDurations, 99),
        total: durations.reduce((s, d) => s + d, 0),
      },
      throughput: {
        opsPerSec: meanDur > 0 ? 1000 / meanDur : 0,
        workUnits: 1,
      },
      memory: {
        peakDeltaMB: peakMemoryMB,
        meanDeltaMB: meanMemoryMB,
      },
      raw: iterationResults,
    };

    this.results.push(stats);

    // Print immediate result
    console.log(
      `  ${name}: mean=${formatMs(meanDur)}, p50=${formatMs(stats.duration.p50)}, ` +
        `p95=${formatMs(stats.duration.p95)}, peakRSS+${peakMemoryMB.toFixed(1)}MB`,
    );

    return stats;
  }

  /**
   * Run multiple benchmark cases sequentially.
   */
  async runSuite(cases: BenchmarkCase[]): Promise<BenchmarkStats[]> {
    const all: BenchmarkStats[] = [];
    for (const c of cases) {
      all.push(await this.runCase(c));
    }
    return all;
  }

  /**
   * Generate a comprehensive benchmark report.
   */
  generateReport(previousReport?: BenchmarkReport): BenchmarkReport {
    const os = awaitImportOs();
    const platform = os.platform();
    const arch = os.arch();
    const cpuCount = os.cpus().length;
    const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);

    // Detect regressions by comparing with previous report
    let casesWithRegressions = 0;
    if (previousReport) {
      for (const current of this.results) {
        const prev = previousReport.cases.find(
          (p) => p.name === current.name && p.category === current.category,
        );
        if (prev) {
          const regression = current.duration.mean > prev.duration.mean * 1.15; // >15% slower
          if (regression) casesWithRegressions++;
        }
      }
    }

    return {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform,
      arch,
      cpuCount,
      totalMemoryGB: Math.round(totalMemoryGB * 10) / 10,
      cases: this.results,
      summary: {
        totalDurationMs: this.results.reduce((s, c) => s + c.duration.total, 0),
        categoriesTested: [...new Set(this.results.map((c) => c.category))],
        casesPassed: this.results.length - casesWithRegressions,
        casesWithRegressions,
      },
    };
  }

  /**
   * Print a human-readable summary table.
   */
  printSummary(stats: BenchmarkStats[]): void {
    const rows = stats as BenchmarkStats[];
    console.log('\n' + '='.repeat(100));
    console.log('BENCHMARK SUMMARY');
    console.log('='.repeat(100));
    console.log(
      'Category'.padEnd(14) +
        'Name'.padEnd(30) +
        'Mean'.padEnd(12) +
        'P50'.padEnd(12) +
        'P95'.padEnd(12) +
        'P99'.padEnd(12) +
        'StdDev'.padEnd(12) +
        'RSS+'.padEnd(10),
    );
    console.log('-'.repeat(100));

    for (const row of rows) {
      console.log(
        row.category.padEnd(14) +
          row.name.padEnd(30) +
          formatMs(row.duration.mean).padEnd(12) +
          formatMs(row.duration.p50).padEnd(12) +
          formatMs(row.duration.p95).padEnd(12) +
          formatMs(row.duration.p99).padEnd(12) +
          `${((row.duration.stddev / (row.duration.mean || 1)) * 100).toFixed(1)}%`.padEnd(12) +
          `${row.memory.peakDeltaMB.toFixed(1)}MB`.padEnd(10),
      );
    }

    console.log('-'.repeat(100));
  }
}

// ---------------------------------------------------------------------------
// Lazy os import (avoids import side-effects in test environment)
// ---------------------------------------------------------------------------

function awaitImportOs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:os') as typeof import('node:os');
}

// ---------------------------------------------------------------------------
// Quick Benchmark Helper
// ---------------------------------------------------------------------------

/**
 * Run a quick timing benchmark against a single function.
 * Returns the mean execution time in milliseconds.
 */
export async function quickBench(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 50,
): Promise<{ name: string; meanMs: number; p50Ms: number; p95Ms: number }> {
  const durations: number[] = [];

  // Warm-up (3 iterations)
  for (let i = 0; i < 3; i++) {
    await fn();
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const mean = computeMean(durations);

  return {
    name,
    meanMs: mean,
    p50Ms: computePercentile(sorted, 50),
    p95Ms: computePercentile(sorted, 95),
  };
}

// ---------------------------------------------------------------------------
// Baseline Utilities
// ---------------------------------------------------------------------------

/**
 * Get current memory statistics.
 */
export function getMemoryStats(): {
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
} {
  const snap = takeMemorySnapshot();
  return {
    rssMB: snap.rssMB,
    heapUsedMB: snap.heapUsedMB,
    heapTotalMB: snap.heapTotalMB,
  };
}
