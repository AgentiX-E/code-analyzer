/**
 * CI-integrated benchmark runner for regression detection and baseline management.
 *
 * Usage:
 *   node --import tsx tests/performance/benchmark-runner.ts --baseline bench-baseline.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkResult {
  name: string;
  durationMs: number;
  opsPerSecond: number;
  memoryBytes: number;
  threshold: {
    maxMs: number;
    maxMemoryBytes: number;
  };
  passed: boolean;
}

export interface BenchmarkReport {
  timestamp: string;
  results: BenchmarkResult[];
  totalDurationMs: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
}

export interface RegressionReport {
  passed: boolean;
  totalBenchmarks: number;
  passed: number;
  failed: number;
  regressions: Array<{
    name: string;
    baselineMs: number;
    currentMs: number;
    increasePercent: number;
  }>;
}

// ---------------------------------------------------------------------------
// BenchmarkRunner
// ---------------------------------------------------------------------------

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private startTime = 0;

  /** Run a single benchmark and record the result. */
  async runSingle(
    name: string,
    fn: () => Promise<void>,
    thresholdMs: number,
    thresholdMemoryBytes = 512 * 1024 * 1024,
  ): Promise<BenchmarkResult> {
    const initialMemory = process.memoryUsage().heapUsed;
    const start = performance.now();

    try {
      await fn();
    } catch (err) {
      const duration = performance.now() - start;
      const result: BenchmarkResult = {
        name,
        durationMs: duration,
        opsPerSecond: 0,
        memoryBytes: process.memoryUsage().heapUsed - initialMemory,
        threshold: {
          maxMs: thresholdMs,
          maxMemoryBytes: thresholdMemoryBytes,
        },
        passed: false,
      };
      this.results.push(result);
      return result;
    }

    const duration = performance.now() - start;
    const endMemory = process.memoryUsage().heapUsed;
    const memoryUsed = Math.max(0, endMemory - initialMemory);

    const opsPerSecond = duration > 0 ? 1000 / duration : 0;

    const result: BenchmarkResult = {
      name,
      durationMs: Math.round(duration * 100) / 100,
      opsPerSecond: Math.round(opsPerSecond * 100) / 100,
      memoryBytes: memoryUsed,
      threshold: {
        maxMs: thresholdMs,
        maxMemoryBytes: thresholdMemoryBytes,
      },
      passed: duration < thresholdMs && memoryUsed < thresholdMemoryBytes,
    };

    this.results.push(result);
    return result;
  }

  /** Run all registered benchmarks and produce a report. */
  async runAll(
    benchmarks: Array<{
      name: string;
      fn: () => Promise<void>;
      thresholdMs: number;
      thresholdMemoryBytes?: number;
    }>,
  ): Promise<BenchmarkReport> {
    this.startTime = Date.now();

    for (const bench of benchmarks) {
      await this.runSingle(
        bench.name,
        bench.fn,
        bench.thresholdMs,
        bench.thresholdMemoryBytes,
      );
    }

    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;

    return {
      timestamp: new Date().toISOString(),
      results: this.results,
      totalDurationMs: totalDuration,
      summary: {
        total: this.results.length,
        passed,
        failed,
        skipped: 0,
      },
    };
  }

  /** Check current results against a saved baseline and detect regressions. */
  async checkBaseline(baselinePath: string): Promise<RegressionReport> {
    const absolutePath = resolve(baselinePath);

    if (!existsSync(absolutePath)) {
      throw new Error(`Baseline file not found: ${absolutePath}`);
    }

    const baselineContent = readFileSync(absolutePath, 'utf-8');
    const baseline = JSON.parse(baselineContent) as BenchmarkReport;

    const baselineMap = new Map<string, BenchmarkResult>();
    for (const r of baseline.results) {
      baselineMap.set(r.name, r);
    }

    const regressions: RegressionReport['regressions'] = [];
    let passed = 0;
    let failed = 0;

    for (const current of this.results) {
      const base = baselineMap.get(current.name);
      if (!base) continue;

      const increasePercent =
        base.durationMs > 0
          ? Math.round(
              ((current.durationMs - base.durationMs) / base.durationMs) * 100,
            )
          : 0;

      // More than 20% regression is flagged
      if (increasePercent > 20) {
        failed++;
        regressions.push({
          name: current.name,
          baselineMs: base.durationMs,
          currentMs: current.durationMs,
          increasePercent,
        });
      } else {
        passed++;
      }
    }

    return {
      passed: failed === 0,
      totalBenchmarks: this.results.length,
      passed,
      failed,
      regressions,
    };
  }

  /** Save current results as a new baseline. */
  async saveBaseline(baselinePath: string): Promise<void> {
    const absolutePath = resolve(baselinePath);
    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      results: this.results,
      totalDurationMs: Date.now() - this.startTime,
      summary: {
        total: this.results.length,
        passed: this.results.filter((r) => r.passed).length,
        failed: this.results.filter((r) => !r.passed).length,
        skipped: 0,
      },
    };

    writeFileSync(absolutePath, JSON.stringify(report, null, 2), 'utf-8');
  }
}
