#!/usr/bin/env node
/**
 * CI benchmark regression checker.
 *
 * Reads bench-results.json produced by `vitest bench --run --reporter=json`
 * and compares against a stored baseline. Fails the build if any benchmark
 * exceeds its threshold by more than 20%.
 *
 * Usage:
 *   node scripts/check-benchmarks.js
 *   node scripts/check-benchmarks.js --baseline bench-baseline.json
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RESULTS_FILE = resolve(process.cwd(), 'bench-results.json');
const BASELINE_FILE = resolve(
  process.cwd(),
  process.argv.includes('--baseline')
    ? process.argv[process.argv.indexOf('--baseline') + 1]
    : 'bench-baseline.json',
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  if (!existsSync(RESULTS_FILE)) {
    console.error(`Error: benchmark results not found at ${RESULTS_FILE}`);
    console.error('Run "pnpm bench:ci" first to generate benchmark results.');
    exit(1);
  }

  const resultsData = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));

  // Parse vitest bench JSON output format
  const benchmarks = parseVitestResults(resultsData);

  if (benchmarks.length === 0) {
    console.warn('Warning: No benchmark results found. Skipping check.');
    exit(0);
  }

  // Load or create baseline
  let baseline: Map<string, number>;
  if (existsSync(BASELINE_FILE)) {
    baseline = loadBaseline(BASELINE_FILE);
    console.log(`Loaded baseline from ${BASELINE_FILE}`);
  } else {
    console.log(`No baseline found at ${BASELINE_FILE}. Creating new baseline from current results.`);
    baseline = new Map();
  }

  // Compare
  const regressions: Array<{ name: string; baselineMs: number; currentMs: number; increasePercent: number }> = [];
  let passCount = 0;
  let failCount = 0;

  for (const bench of benchmarks) {
    const baselineMs = baseline.get(bench.name);

    if (baselineMs === undefined) {
      // New benchmark — record baseline
      baseline.set(bench.name, bench.durationMs);
      console.log(`  NEW  ${bench.name}: ${bench.durationMs.toFixed(2)}ms`);
      passCount++;
      continue;
    }

    const increasePercent =
      baselineMs > 0
        ? ((bench.durationMs - baselineMs) / baselineMs) * 100
        : 0;

    if (increasePercent > 20) {
      regressions.push({
        name: bench.name,
        baselineMs,
        currentMs: bench.durationMs,
        increasePercent: Math.round(increasePercent * 100) / 100,
      });
      failCount++;
      console.log(
        `  FAIL ${bench.name}: ${bench.durationMs.toFixed(2)}ms (was ${baselineMs.toFixed(2)}ms, +${increasePercent.toFixed(1)}%)`,
      );
    } else {
      passCount++;
      console.log(
        `  PASS ${bench.name}: ${bench.durationMs.toFixed(2)}ms (baseline ${baselineMs.toFixed(2)}ms)`,
      );
    }
  }

  // Save updated baseline
  saveBaseline(BASELINE_FILE, baseline);

  // Report
  console.log('\n--- Regression Check Summary ---');
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total:  ${passCount + failCount}`);

  if (regressions.length > 0) {
    console.log('\n  Regressions:');
    for (const r of regressions) {
      console.log(
        `    ${r.name}: ${r.currentMs.toFixed(2)}ms vs ${r.baselineMs.toFixed(2)}ms (+${r.increasePercent}%)`,
      );
    }
    console.log(`\nError: ${regressions.length} performance regression(s) detected.`);
    exit(1);
  }

  console.log('\nAll benchmarks pass. No regressions detected.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchEntry {
  name: string;
  durationMs: number;
}

function parseVitestResults(data: unknown): BenchEntry[] {
  const entries: BenchEntry[] = [];

  // vitest bench JSON reporter format: { testResults: [ { assertionResults: [...], ... } ] }
  // or simplified: { benchmarks: [...] }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Direct benchmarks array
    if (Array.isArray(obj.benchmarks)) {
      for (const b of obj.benchmarks as Array<Record<string, unknown>>) {
        entries.push({
          name: String(b.name ?? ''),
          durationMs: Number(b.durationMs ?? 0),
        });
      }
    }

    // vitest testResults format
    if (Array.isArray(obj.testResults)) {
      for (const tr of obj.testResults as Array<Record<string, unknown>>) {
        if (Array.isArray(tr.assertionResults)) {
          for (const ar of tr.assertionResults as Array<Record<string, unknown>>) {
            entries.push({
              name: String(ar.fullName ?? ar.title ?? ''),
              durationMs: Number(ar.duration ?? 0),
            });
          }
        }
      }
    }

    // vitest bench single-level format
    if (Array.isArray(obj.files)) {
      for (const file of obj.files as Array<Record<string, unknown>>) {
        if (Array.isArray(file.tasks)) {
          for (const task of file.tasks as Array<Record<string, unknown>>) {
            entries.push({
              name: String(task.name ?? ''),
              durationMs: Number(task.result?.mean ?? task.result?.duration ?? 0),
            });
          }
        }
      }
    }
  }

  return entries;
}

function loadBaseline(filePath: string): Map<string, number> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const map = new Map<string, number>();

    if (Array.isArray(data)) {
      for (const entry of data as Array<{ name: string; durationMs: number }>) {
        map.set(entry.name, entry.durationMs);
      }
    } else if (data && typeof data === 'object') {
      // Try results format
      const results = data.results ?? data;
      if (Array.isArray(results)) {
        for (const entry of results as Array<{ name: string; durationMs: number }>) {
          map.set(entry.name, entry.durationMs);
        }
      }
    }

    return map;
  } catch {
    return new Map();
  }
}

function saveBaseline(filePath: string, baseline: Map<string, number>): void {
  const entries: Array<{ name: string; durationMs: number }> = [];
  for (const [name, durationMs] of baseline) {
    entries.push({ name, durationMs });
  }

  writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

main();
