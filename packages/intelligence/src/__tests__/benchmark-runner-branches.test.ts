// @code-analyzer/intelligence — Benchmark Runner Branch Tests
// Exercises the matching helpers (matchGroundTruth / matchFalsePositive), the
// changeType ternary, the f1Score zero path, and the report category filter
// that the happy-path benchmark fixtures do not reach.

import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from '../benchmark/benchmark-runner.js';
import type { AggregateMetrics } from '../benchmark/benchmark-runner.js';
import type { BenchmarkCase, GroundTruthIssue, FileContent } from '../benchmark/benchmark-data.js';

function makeCase(
  id: string,
  file: FileContent,
  groundTruth: GroundTruthIssue[],
  expectedFalsePositives: GroundTruthIssue[] = [],
): BenchmarkCase {
  return {
    id,
    language: 'typescript',
    description: 'branch coverage fixture',
    files: [file],
    groundTruth,
    expectedFalsePositives,
  };
}

function styleIssue(filePath: string, startLine: number, endLine = startLine): GroundTruthIssue {
  return {
    filePath,
    startLine,
    endLine,
    category: 'style',
    severity: 'low',
    description: 'console.log left in code',
  };
}

describe('matchGroundTruth — file path and overlap guards', () => {
  it('skips a ground-truth entry whose file path differs (returns -1)', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([makeCase('c1', file, [styleIssue('/src/other.ts', 1)])]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(0);
    expect(c.falsePositives).toBe(1);
    expect(c.falseNegatives).toBe(1);
  });

  it('skips a same-path ground-truth entry whose lines do not overlap (returns -1)', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([makeCase('c2', file, [styleIssue('/src/a.ts', 50)])]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(0);
    expect(c.falsePositives).toBe(1);
    expect(c.falseNegatives).toBe(1);
  });
});

describe('matchFalsePositive — file path, category, and overlap guards', () => {
  it('does not suppress a result when the expected-FP path differs', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([
      makeCase('c3', file, [styleIssue('/src/a.ts', 1)], [styleIssue('/src/other.ts', 1)]),
    ]);
    const c = result.cases[0]!;
    // The result correctly matches ground truth (not an expected false positive).
    expect(c.truePositives).toBe(1);
    expect(c.falsePositives).toBe(0);
  });

  it('does not suppress a result when the expected-FP category differs', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([
      makeCase(
        'c4',
        file,
        [styleIssue('/src/a.ts', 1)],
        [{ ...styleIssue('/src/a.ts', 1), category: 'bug' }],
      ),
    ]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(1);
    expect(c.falsePositives).toBe(0);
  });

  it('does not suppress a result when the expected-FP lines do not overlap', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([
      makeCase('c5', file, [styleIssue('/src/a.ts', 1)], [styleIssue('/src/a.ts', 50)]),
    ]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(1);
    expect(c.falsePositives).toBe(0);
  });
});

describe('changeType ternary — added and modified files', () => {
  it('treats a file with empty beforeContent as added and still produces results', () => {
    const file: FileContent = {
      filePath: '/src/services/added.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([
      makeCase('c-added', file, [styleIssue('/src/services/added.ts', 1)]),
    ]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(1);
    expect(c.falsePositives).toBe(0);
    expect(c.falseNegatives).toBe(0);
  });

  it('treats a file with both before and after content as modified', () => {
    const file: FileContent = {
      filePath: '/src/mod.ts',
      beforeContent: 'const old = 1;',
      afterContent: 'const old = 1;\nconsole.log("x");',
    };
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark([makeCase('c6', file, [styleIssue('/src/mod.ts', 2)])]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(1);
    expect(c.falsePositives).toBe(0);
    expect(c.falseNegatives).toBe(0);
  });
});

describe('metric edge case — zero precision and recall', () => {
  it('computes f1 = 0 when precision and recall are both zero', () => {
    const file: FileContent = {
      filePath: '/src/a.ts',
      beforeContent: '',
      afterContent: `console.log('x');`,
    };
    const runner = new BenchmarkRunner();
    // A single style result that matches no ground-truth entry (category
    // mismatch) yields TP=0, FP=1, FN=1 -> precision 0, recall 0.
    const result = runner.runBenchmark([
      makeCase('c7', file, [{ ...styleIssue('/src/a.ts', 1), category: 'documentation' }]),
    ]);
    const c = result.cases[0]!;
    expect(c.truePositives).toBe(0);
    expect(c.precision).toBe(0);
    expect(c.recall).toBe(0);
    expect(c.f1Score).toBe(0);
  });
});

describe('generateReport — category filter for zero metrics', () => {
  it('omits every category when overall and per-category metrics are all zero', () => {
    const metrics: AggregateMetrics = {
      overallF1: 0,
      overallPrecision: 0,
      overallRecall: 0,
      bySeverity: {
        critical: { precision: 0, recall: 0, f1: 0 },
        high: { precision: 0, recall: 0, f1: 0 },
        medium: { precision: 0, recall: 0, f1: 0 },
        low: { precision: 0, recall: 0, f1: 0 },
        info: { precision: 0, recall: 0, f1: 0 },
      },
      byCategory: {
        zerocat: { precision: 0, recall: 0, f1: 0 },
        otherzero: { precision: 0, recall: 0, f1: 0 },
      },
      totalCases: 1,
      totalIssues: 1,
    };
    const runner = new BenchmarkRunner();
    const report = runner.generateReport(metrics);
    // Both categories have zero precision and recall, so the skip branch omits
    // every per-category table row.
    expect(report).not.toContain('zerocat');
    expect(report).not.toContain('otherzero');
  });

  it('omits a category whose f1 is positive but precision and recall are zero', () => {
    const metrics: AggregateMetrics = {
      overallF1: 0,
      overallPrecision: 0,
      overallRecall: 0,
      bySeverity: {
        critical: { precision: 0, recall: 0, f1: 0 },
        high: { precision: 0, recall: 0, f1: 0 },
        medium: { precision: 0, recall: 0, f1: 0 },
        low: { precision: 0, recall: 0, f1: 0 },
        info: { precision: 0, recall: 0, f1: 0 },
      },
      byCategory: {
        f1only: { precision: 0, recall: 0, f1: 0.5 },
        realcat: { precision: 0.8, recall: 0.8, f1: 0.8 },
      },
      totalCases: 1,
      totalIssues: 1,
    };
    const runner = new BenchmarkRunner();
    const report = runner.generateReport(metrics);
    // A positive f1 no longer keeps a zero-precision/zero-recall category alive
    // (the redundant `|| m.f1 > 0` term was removed); a category with real
    // precision/recall is still emitted.
    expect(report).not.toContain('f1only');
    expect(report).toContain('realcat');
  });
});
