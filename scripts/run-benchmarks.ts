#!/usr/bin/env node
// @code-analyzer — Benchmark Runner CLI
//
// Runs all benchmark suites and generates a comprehensive report in JSON format.
// Usage:
//   npx tsx scripts/run-benchmarks.ts                    # Run all benchmarks
//   npx tsx scripts/run-benchmarks.ts --category parse   # Run parse benchmarks only
//   npx tsx scripts/run-benchmarks.ts --output report.json # Write report to file
//   npx tsx scripts/run-benchmarks.ts --compare baseline.json # Compare against baseline

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus, totalmem, platform, arch, version as nodeVersion } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IterationResult {
  iteration: number;
  durationMs: number;
  memoryDeltaMB: number;
}

interface BenchmarkStats {
  name: string;
  category: string;
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
    opsPerSec: number;
    workUnits: number;
  };
  memory: {
    peakDeltaMB: number;
    meanDeltaMB: number;
  };
  raw: IterationResult[];
}

interface BenchmarkReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuCount: number;
  totalMemoryGB: number;
  commitSha: string;
  cases: BenchmarkStats[];
  summary: {
    totalDurationMs: number;
    categoriesTested: string[];
    casesPassed: number;
    casesWithRegressions: number;
  };
}

// ---------------------------------------------------------------------------
// CLI Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  category?: string;
  output?: string;
  compare?: string;
  verbose: boolean;
} {
  const args = process.argv.slice(2);
  const result: ReturnType<typeof parseArgs> = { verbose: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--category':
        result.category = args[++i];
        break;
      case '--output':
        result.output = args[++i];
        break;
      case '--compare':
        result.compare = args[++i];
        break;
      case '--verbose':
        result.verbose = true;
        break;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  const rootDir = join(import.meta.dirname, '..');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Code Analyzer — Performance Benchmarks             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Platform:   ${platform()} ${arch()}`);
  console.log(`  Node.js:    ${nodeVersion}`);
  console.log(`  CPUs:       ${cpus().length}`);
  console.log(`  Memory:     ${(totalmem() / 1024 ** 3).toFixed(1)} GB`);
  console.log('');

  // Determine which benchmark suites to run
  // Pattern paths are relative to root directory
  const suites: Array<{ pattern: string }> = [];

  if (!opts.category || opts.category === 'parse') {
    suites.push({ pattern: 'packages/analyzer/src/__tests__/benchmarks/parse.bench.ts' });
  }
  if (!opts.category || opts.category === 'graph') {
    suites.push({ pattern: 'packages/analyzer/src/__tests__/benchmarks/graph.bench.ts' });
  }
  if (!opts.category || opts.category === 'scope') {
    suites.push({ pattern: 'packages/analyzer/src/__tests__/benchmarks/scope.bench.ts' });
  }
  if (!opts.category || opts.category === 'embed') {
    suites.push({ pattern: 'packages/intelligence/src/__tests__/benchmarks/embed.bench.ts' });
  }
  if (!opts.category || opts.category === 'search') {
    suites.push({ pattern: 'packages/intelligence/src/__tests__/benchmarks/search.bench.ts' });
  }
  if (!opts.category || opts.category === 'heuristic') {
    suites.push({ pattern: 'packages/intelligence/src/__tests__/benchmarks/heuristic.bench.ts' });
  }

  const overallStart = Date.now();
  let passed = 0;
  let failed = 0;
  const reportErrors: string[] = [];

  // Build the workspace once up front (the suites import package sources via
  // tsconfig paths, but a single build guarantees cross-package entry points
  // and generated artifacts are fresh for every suite).
  console.log('Building workspace...');
  execSync('pnpm build', { cwd: rootDir, stdio: 'pipe', timeout: 180_000 });

  for (const suite of suites) {
    const suiteName = suite.pattern.split('/').pop()?.replace('.bench.ts', '') ?? 'unknown';
    console.log(`\n▶ Running benchmark suite: ${suiteName}`);

    try {
      // Run the benchmark test from root with the dedicated bench config
      const testCmd = `npx vitest run ${suite.pattern} --config vitest.bench.config.ts --reporter=verbose`;
      console.log(`  Executing: ${testCmd}`);

      const startTime = Date.now();
      execSync(testCmd, {
        cwd: rootDir,
        stdio: 'inherit',
        timeout: 300_000, // 5 minutes
      });
      const duration = Date.now() - startTime;

      console.log(`  ✓ ${suiteName} completed in ${(duration / 1000).toFixed(1)}s`);
      passed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${suiteName} FAILED: ${message}`);
      reportErrors.push(`${suiteName}: ${message}`);
      failed++;
    }
  }

  const totalDuration = Date.now() - overallStart;

  // Generate summary report
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    nodeVersion,
    platform: platform(),
    arch: arch(),
    cpuCount: cpus().length,
    totalMemoryGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    commitSha: (() => {
      try {
        return execSync('git rev-parse HEAD', { cwd: rootDir }).toString().trim();
      } catch {
        return 'unknown';
      }
    })(),
    cases: [],
    summary: {
      totalDurationMs: totalDuration,
      categoriesTested: suites.map(
        (s) => s.pattern.split('/').pop()?.replace('.bench.ts', '') ?? '',
      ),
      casesPassed: passed,
      casesWithRegressions: 0,
    },
  };

  // Compare with baseline if specified
  if (opts.compare && existsSync(opts.compare)) {
    try {
      const baseline = JSON.parse(readFileSync(opts.compare, 'utf-8')) as BenchmarkReport;
      console.log('\n┌────────────────────── REGRESSION CHECK ──────────────────────┐');

      let regressions = 0;
      for (const current of report.cases) {
        const prev = baseline.cases.find(
          (p: BenchmarkStats) => p.name === current.name && p.category === current.category,
        );
        if (prev && current.duration.mean > prev.duration.mean * 1.15) {
          const pct = ((current.duration.mean / prev.duration.mean - 1) * 100).toFixed(1);
          console.log(`│ ⚠ REGRESSION: ${current.category}/${current.name}`);
          console.log(
            `│   ${prev.duration.mean.toFixed(2)}ms → ${current.duration.mean.toFixed(2)}ms (+${pct}%)`,
          );
          regressions++;
        }
      }

      if (regressions === 0) {
        console.log('│ ✓ No performance regressions detected');
      }
      report.summary.casesWithRegressions = regressions;
      console.log('└──────────────────────────────────────────────────────────────┘');
    } catch {
      console.log('│ ⚠ Could not parse baseline file — skipping comparison');
      console.log('└──────────────────────────────────────────────────────────────┘');
    }
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     BENCHMARK SUMMARY                       ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(
    `║ Suites: ${String(passed).padStart(3)} passed, ${String(failed).padStart(3)} failed, ${String(passed + failed).padStart(3)} total          ║`,
  );
  console.log(
    `║ Duration: ${(totalDuration / 1000).toFixed(1)}s${' '.repeat(40 - (totalDuration / 1000).toFixed(1).length)}║`,
  );
  console.log(
    `║ Regressions: ${report.summary.casesWithRegressions}${' '.repeat(48 - String(report.summary.casesWithRegressions).length)}║`,
  );
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Write report
  const outputPath = opts.output ?? join(rootDir, 'benchmark-report.json');
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to: ${outputPath}`);

  // Exit with error if any suite failed
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal benchmark error:', err);
  process.exit(1);
});
