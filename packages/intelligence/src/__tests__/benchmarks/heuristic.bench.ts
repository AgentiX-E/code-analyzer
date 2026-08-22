// @code-analyzer/intelligence — Heuristic Analysis Benchmarks
// Measures rule-based code analysis throughput (files/sec, rules/sec).

import { describe, it, expect } from 'vitest';
import { analyzeFileHeuristics } from '../../../src/review/heuristics.js';
import type { GraphAnalysisData } from '../../../src/review/heuristics.js';

// ---------------------------------------------------------------------------
// Simple Benchmark Helper
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  iterations: number;
}

async function bench(
  name: string,
  fn: () => Promise<void> | void,
  iterations: number = 30,
  warmupIterations: number = 3,
): Promise<BenchResult> {
  for (let i = 0; i < warmupIterations; i++) {
    await fn();
  }

  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }

  const sorted = [...durations].sort((a, b) => a - b);
  return {
    name,
    meanMs: durations.reduce((s, d) => s + d, 0) / durations.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    iterations,
  };
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function generateCodeLines(lineCount: number): string[] {
  const lines: string[] = [
    'import { readFile, writeFile } from "fs";',
    '',
    'export class UserService {',
    '  private items: string[] = [];',
    '',
    '  async fetchData() {',
    '    const result = await fetch("https://api.example.com/data");',
    '    return result.json();',
    '  }',
    '',
    '  processItems(data) {', // missing return type
    '    if (data.length > 0) {',
    '      if (data.items) {',
    '        if (data.items.length > 0) {',
    '          if (data.items[0]) {',
    '            if (data.items[0].value) {', // >4 levels nesting
    '              console.log(data.items[0].value);', // console.log
    '              // TODO: implement proper processing',
    '              return data.items.map(item => item.value);',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '    return [];',
    '  }',
    '',
    '  // Long method — 60+ lines',
    '  veryLongMethod(param1, param2, param3) {',
    ...Array.from({ length: 55 }, (_, i) => `    const line${i} = param1 + ${i};`),
    '    return "done";',
    '  }',
    '}',
  ];

  // Pad to requested line count
  while (lines.length < lineCount) {
    lines.push(`// Padding line ${lines.length}`);
  }

  return lines.slice(0, lineCount);
}

function createGraphData(): GraphAnalysisData {
  return {
    outDegree: 20, // High coupling
    inDegree: 2,
    exportedSymbolCount: 8,
    cyclicPaths: [['src/a.ts', 'src/b.ts', 'src/a.ts']],
    edgeCounts: new Map([['src/b.ts', 10]]),
  };
}

function createDiff() {
  return {
    filePath: 'src/routes/api.ts',
    oldHash: 'abc123',
    newHash: 'def456',
    changeType: 'modified' as const,
    ranges: [{ oldStart: 1, oldEnd: 5, newStart: 1, newEnd: 10, changeType: 'modified' as const }],
  };
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Heuristic Benchmarks', () => {
  it('should analyze files with low latency', { timeout: 30_000 }, async () => {
    const lines = generateCodeLines(100);
    const graphData = createGraphData();

    const result = await bench(
      'analyze-file-100lines',
      () => {
        const issues = analyzeFileHeuristics('src/services/user.ts', lines, undefined, graphData);
        expect(issues.length).toBeGreaterThan(0);
      },
      50,
      5,
    );

    console.log(
      `Analyze file (100 lines, all rules): mean=${formatMs(result.meanMs)}, ` +
        `p95=${formatMs(result.p95Ms)}`,
    );
    expect(result.meanMs).toBeLessThan(20);
  });

  it('should analyze files with diff context', { timeout: 30_000 }, async () => {
    const lines = generateCodeLines(80);
    const diff = createDiff();
    const graphData = createGraphData();

    const result = await bench(
      'analyze-file-with-diff',
      () => {
        const issues = analyzeFileHeuristics(
          'src/routes/api.ts', // triggers risky change rule
          lines,
          diff,
          graphData,
        );
        expect(issues.length).toBeGreaterThan(0);
      },
      50,
      5,
    );

    console.log(`Analyze file with diff (all rules): mean=${formatMs(result.meanMs)}`);
    expect(result.meanMs).toBeLessThan(20);
  });

  it('should process large files efficiently', { timeout: 30_000 }, async () => {
    const lines = generateCodeLines(500);

    const result = await bench(
      'analyze-file-500lines',
      () => {
        const issues = analyzeFileHeuristics('src/large-file.ts', lines);
        expect(Array.isArray(issues)).toBe(true);
      },
      30,
      3,
    );

    console.log(`Analyze file (500 lines): mean=${formatMs(result.meanMs)}`);

    // Should process at least 500 LOC / 50ms = 10K LOC/sec
    const locPerSec = 500 / (result.meanMs / 1000);
    console.log(`Throughput: ${locPerSec.toFixed(0)} LOC/sec`);
    expect(locPerSec).toBeGreaterThan(5000); // >5K LOC/sec
  });

  it('should throughput at scale (batch of files)', { timeout: 30_000 }, async () => {
    const lines = generateCodeLines(200);
    const graphData = createGraphData();

    const result = await bench(
      'analyze-batch-100-files',
      () => {
        for (let i = 0; i < 100; i++) {
          analyzeFileHeuristics(`src/module${i % 10}/service${i}.ts`, lines, undefined, graphData);
        }
      },
      10,
      2,
    );

    console.log(`Batch analyze (100 files × 200 lines = 20K LOC): mean=${formatMs(result.meanMs)}`);
  });

  it('should detect deep nesting on pathological input', { timeout: 10_000 }, async () => {
    // Pathological: deeply nested code
    const deepLines: string[] = [];
    for (let i = 0; i < 10; i++) {
      deepLines.push(`${'  '.repeat(i)}if (condition${i}) {`);
    }
    deepLines.push(`${'  '.repeat(10)}console.log("very deep");`);
    for (let i = 9; i >= 0; i--) {
      deepLines.push(`${'  '.repeat(i)}}`);
    }

    const result = await bench(
      'detect-deep-nesting',
      () => {
        const issues = analyzeFileHeuristics('src/deep.ts', deepLines);
        expect(issues.length).toBeGreaterThan(0);
      },
      100,
      10,
    );

    console.log(`Detect deep nesting (10 levels): mean=${formatMs(result.meanMs)}`);
    expect(result.meanMs).toBeLessThan(5);
  });

  it('should not regress on empty files', { timeout: 10_000 }, async () => {
    const result = await bench(
      'analyze-empty-file',
      () => {
        const issues = analyzeFileHeuristics('src/empty.ts', []);
        expect(issues.length).toBe(0);
      },
      200,
      10,
    );

    console.log(`Empty file analysis overhead: mean=${formatMs(result.meanMs)}`);
    expect(result.meanMs).toBeLessThan(1);
  });
});
