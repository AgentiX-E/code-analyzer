// @code-analyzer/infra — Performance Profiler Branch Tests
// Exercises the statistics edge cases and GC / target-report branches that the
// happy-path suite does not reach.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PerformanceProfiler } from '../performance/profiler.js';

describe('PerformanceProfiler — branch coverage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns zeroed statistics when no measured runs are collected', () => {
    // measuredRuns === 0 produces an empty sample set, which drives every
    // `sorted[...] ?? sorted[n-1] ?? 0` fallback and the `n > 0 ? ... : 0`
    // ternary in computeStats.
    const profiler = new PerformanceProfiler({ warmupRuns: 0, measuredRuns: 0 });
    const result = profiler.benchmark('empty', () => {
      /* noop */
    });

    expect(result.runs).toBe(0);
    expect(result.opsPerSec).toBe(0);
    expect(result.p50Ms).toBe(0);
    expect(result.p95Ms).toBe(0);
    expect(result.p99Ms).toBe(0);
    expect(result.minMs).toBe(0);
    expect(result.maxMs).toBe(0);
    expect(result.stdDevMs).toBe(0);
  });

  it('runs the garbage collector between measured synchronous runs when enabled', () => {
    const gc = vi.fn();
    vi.stubGlobal('gc', gc);

    const profiler = new PerformanceProfiler({
      warmupRuns: 0,
      measuredRuns: 3,
      gcBetweenRuns: true,
    });
    const result = profiler.benchmark('gc-sync', () => {
      /* noop */
    });

    expect(result.runs).toBe(3);
    // gcBetweenRuns is true and global.gc is available, so the collector runs
    // once before every measured iteration.
    expect(gc).toHaveBeenCalledTimes(3);
  });

  it('runs the garbage collector between measured asynchronous runs when enabled', async () => {
    const gc = vi.fn();
    vi.stubGlobal('gc', gc);

    const profiler = new PerformanceProfiler({
      warmupRuns: 0,
      measuredRuns: 3,
      gcBetweenRuns: true,
    });
    const result = await profiler.benchmarkAsync('gc-async', async () => {
      /* noop */
    });

    expect(result.runs).toBe(3);
    expect(gc).toHaveBeenCalledTimes(3);
  });

  it('reports FAIL when the p99 latency exceeds the configured target', () => {
    // maxP99Ms is defined (and impossible), which exercises the
    // `p99 <= maxP99Ms` operand and the FAIL branch of generateReport.
    const profiler = new PerformanceProfiler({ warmupRuns: 0, measuredRuns: 3, maxP99Ms: -1 });
    const result = profiler.benchmark('fail', () => {
      /* noop */
    });

    expect(result.targetsMet).toBe(false);
    expect(profiler.generateReport([result])).toContain('❌ FAIL');
  });

  it('reports PASS when the p99 latency stays within a generous target', () => {
    const profiler = new PerformanceProfiler({ warmupRuns: 0, measuredRuns: 3, maxP99Ms: 1e9 });
    const result = profiler.benchmark('pass', () => {
      /* noop */
    });

    expect(result.targetsMet).toBe(true);
    expect(profiler.generateReport([result])).toContain('✅ PASS');
  });
});
