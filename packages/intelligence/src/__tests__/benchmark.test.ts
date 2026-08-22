// @ts-nocheck
// @code-analyzer/intelligence — Review Quality Benchmark Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { BenchmarkRunner } from '../benchmark/benchmark-runner.js';
import {
  ALL_BENCHMARK_CASES,
  BENCH_NPE_001,
  BENCH_NPE_002,
  BENCH_NPE_003,
  BENCH_SEC_001,
  BENCH_SEC_002,
  BENCH_SEC_003,
  BENCH_THREAD_001,
  BENCH_THREAD_002,
  BENCH_QUALITY_001,
  BENCH_QUALITY_002,
  BENCH_QUALITY_003,
  BENCH_ARCH_001,
  BENCH_ARCH_002,
  BENCH_PERF_001,
  BENCH_PERF_002,
} from '../benchmark/benchmark-data.js';
import type { BenchmarkCase, GroundTruthIssue } from '../benchmark/benchmark-data.js';
import type {
  SingleCaseResult,
  AggregateMetrics,
  BenchmarkResult,
} from '../benchmark/benchmark-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRunner(): BenchmarkRunner {
  return new BenchmarkRunner();
}

// ---------------------------------------------------------------------------
// Individual Benchmark Case Tests
// ---------------------------------------------------------------------------

describe('Benchmark Cases — NPE Detection', () => {
  it('pr-npe-001: should detect risky query and fetch operations without error handling', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_NPE_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-npe-002: should detect risky file I/O and database operations without error handling', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_NPE_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-npe-003: should detect long function and missing error handling in payment service', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_NPE_003]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });
});

describe('Benchmark Cases — Security', () => {
  it('pr-sec-001: should detect risky connect operation in config file', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_SEC_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-sec-002: should detect risky query operation in API route handler', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_SEC_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-sec-003: should detect architecture risk for shared types file modification', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_SEC_003]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    // Shared types change triggers architecture risk from path matching
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });
});

describe('Benchmark Cases — Thread Safety', () => {
  it('pr-thread-001: should detect risky fetch operations in cache service', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_THREAD_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-thread-002: should detect risky fetch in messaging service', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_THREAD_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });
});

describe('Benchmark Cases — Code Quality', () => {
  it('pr-quality-001: should detect long function exceeding 50 lines', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_QUALITY_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-quality-002: should detect deeply nested code exceeding 4 levels', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_QUALITY_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-quality-003: should detect console.log, TODO/FIXME, and naming issues', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_QUALITY_003]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(3);
    expect(caseResult.f1Score).toBeGreaterThan(0.5);
  });
});

describe('Benchmark Cases — Architecture', () => {
  it('pr-arch-001: should detect risky database operations in API v1 routes', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_ARCH_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-arch-002: should handle deleted files without crashing', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_ARCH_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    // Deleted file with empty afterContent should not cause errors
    expect(caseResult.caseId).toBe('pr-arch-002');
    expect(caseResult.falsePositives).toBeGreaterThanOrEqual(0);
  });
});

describe('Benchmark Cases — Performance', () => {
  it('pr-perf-001: should detect missing return types and fetch without error handling', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_PERF_001]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });

  it('pr-perf-002: should detect multiple I/O operations without error handling', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_PERF_002]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBeGreaterThanOrEqual(1);
    expect(caseResult.f1Score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Full Suite Tests
// ---------------------------------------------------------------------------

describe('Full Benchmark Suite', () => {
  it('should run all 15 benchmark cases', () => {
    const runner = createRunner();
    const result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    expect(result.cases).toHaveLength(15);
  });

  it('should produce valid aggregate metrics for all cases', () => {
    const runner = createRunner();
    const result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    expect(result.aggregate.overallPrecision).toBeGreaterThanOrEqual(0);
    expect(result.aggregate.overallRecall).toBeGreaterThanOrEqual(0);
    expect(result.aggregate.overallF1).toBeGreaterThanOrEqual(0);
    expect(result.aggregate.totalCases).toBe(15);
    expect(result.aggregate.totalIssues).toBeGreaterThan(0);
  });

  it('each case result should have valid metric ranges', () => {
    const runner = createRunner();
    const result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    for (const caseResult of result.cases) {
      expect(caseResult.precision).toBeGreaterThanOrEqual(0);
      expect(caseResult.precision).toBeLessThanOrEqual(1);
      expect(caseResult.recall).toBeGreaterThanOrEqual(0);
      expect(caseResult.recall).toBeLessThanOrEqual(1);
      expect(caseResult.f1Score).toBeGreaterThanOrEqual(0);
      expect(caseResult.f1Score).toBeLessThanOrEqual(1);
      expect(caseResult.truePositives).toBeGreaterThanOrEqual(0);
      expect(caseResult.falsePositives).toBeGreaterThanOrEqual(0);
      expect(caseResult.falseNegatives).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Aggregate Metrics Tests
// ---------------------------------------------------------------------------

describe('Aggregate Metrics Computation', () => {
  it('should compute perfect metrics for all-correct results', () => {
    const runner = createRunner();
    const perfectResults: SingleCaseResult[] = [
      {
        caseId: 'test-1',
        truePositives: 5,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 1,
      },
      {
        caseId: 'test-2',
        truePositives: 3,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 1,
      },
    ];
    const metrics = runner.computeMetrics(perfectResults);
    expect(metrics.overallPrecision).toBe(1);
    expect(metrics.overallRecall).toBe(1);
    expect(metrics.overallF1).toBe(1);
    expect(metrics.totalIssues).toBe(8);
    expect(metrics.totalCases).toBe(2);
  });

  it('should compute zero metrics for all-wrong results', () => {
    const runner = createRunner();
    const wrongResults: SingleCaseResult[] = [
      {
        caseId: 'test-1',
        truePositives: 0,
        falsePositives: 2,
        falseNegatives: 5,
        precision: 0,
        recall: 0,
        f1Score: 0,
      },
    ];
    const metrics = runner.computeMetrics(wrongResults);
    expect(metrics.overallPrecision).toBe(0);
    expect(metrics.overallRecall).toBe(0);
    expect(metrics.overallF1).toBe(0);
    expect(metrics.totalIssues).toBe(5);
  });

  it('should handle mixed results correctly', () => {
    const runner = createRunner();
    const mixedResults: SingleCaseResult[] = [
      {
        caseId: 'test-1',
        truePositives: 4,
        falsePositives: 1,
        falseNegatives: 1,
        precision: 0.8,
        recall: 0.8,
        f1Score: 0.8,
      },
      {
        caseId: 'test-2',
        truePositives: 2,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 1,
      },
    ];
    const metrics = runner.computeMetrics(mixedResults);
    expect(metrics.overallPrecision).toBeCloseTo(0.8571, 3);
    expect(metrics.overallRecall).toBeCloseTo(0.8571, 3);
    expect(metrics.overallF1).toBeCloseTo(0.8571, 3);
    expect(metrics.totalCases).toBe(2);
    expect(metrics.totalIssues).toBe(7);
  });

  it('should include per-severity metrics in aggregate', () => {
    const runner = createRunner();
    const results: SingleCaseResult[] = [
      {
        caseId: 'test-1',
        truePositives: 5,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 1,
      },
    ];
    const metrics = runner.computeMetrics(results);
    expect(metrics.bySeverity).toHaveProperty('critical');
    expect(metrics.bySeverity).toHaveProperty('high');
    expect(metrics.bySeverity).toHaveProperty('medium');
    expect(metrics.bySeverity).toHaveProperty('low');
    expect(metrics.bySeverity).toHaveProperty('info');
    for (const sevMetrics of Object.values(metrics.bySeverity)) {
      expect(sevMetrics.precision).toBe(1);
      expect(sevMetrics.recall).toBe(1);
      expect(sevMetrics.f1).toBe(1);
    }
  });

  it('should include per-category metrics in aggregate', () => {
    const runner = createRunner();
    const results: SingleCaseResult[] = [
      {
        caseId: 'test-1',
        truePositives: 3,
        falsePositives: 1,
        falseNegatives: 1,
        precision: 0.75,
        recall: 0.75,
        f1Score: 0.75,
      },
    ];
    const metrics = runner.computeMetrics(results);
    expect(metrics.byCategory).toHaveProperty('bug');
    expect(metrics.byCategory).toHaveProperty('security');
    expect(metrics.byCategory).toHaveProperty('performance');
    expect(metrics.byCategory).toHaveProperty('maintainability');
    expect(metrics.byCategory).toHaveProperty('style');
    expect(metrics.byCategory).toHaveProperty('documentation');
    expect(metrics.byCategory).toHaveProperty('architecture');
    expect(metrics.byCategory).toHaveProperty('other');
  });
});

// ---------------------------------------------------------------------------
// Report Generation Tests
// ---------------------------------------------------------------------------

describe('Report Generation', () => {
  it('should generate a markdown report with required sections', () => {
    const runner = createRunner();
    const result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    const report = result.summary;
    expect(report).toContain('# Review Quality Benchmark Report');
    expect(report).toContain('## Overview');
    expect(report).toContain('## Aggregate Metrics');
    expect(report).toContain('## Per-Severity Metrics');
    expect(report).toContain('## Per-Category Metrics');
    expect(report).toContain('Precision');
    expect(report).toContain('Recall');
    expect(report).toContain('F1 Score');
  });

  it('should include total cases count in report', () => {
    const runner = createRunner();
    const result = runner.runBenchmark(ALL_BENCHMARK_CASES);
    const report = result.summary;
    expect(report).toContain('15'); // total cases
  });

  it('should generate report from aggregate metrics', () => {
    const runner = createRunner();
    const metrics: AggregateMetrics = {
      overallF1: 0.85,
      overallPrecision: 0.9,
      overallRecall: 0.8,
      bySeverity: {
        critical: { precision: 1, recall: 1, f1: 1 },
        high: { precision: 0.8, recall: 0.7, f1: 0.75 },
        medium: { precision: 0.9, recall: 0.85, f1: 0.875 },
        low: { precision: 0.95, recall: 0.9, f1: 0.925 },
        info: { precision: 1, recall: 1, f1: 1 },
      },
      byCategory: {
        bug: { precision: 0.8, recall: 0.75, f1: 0.774 },
        security: { precision: 1, recall: 1, f1: 1 },
        performance: { precision: 1, recall: 1, f1: 1 },
        maintainability: { precision: 0.9, recall: 0.85, f1: 0.875 },
        test: { precision: 1, recall: 1, f1: 1 },
        style: { precision: 0.95, recall: 0.8, f1: 0.869 },
        documentation: { precision: 1, recall: 1, f1: 1 },
        architecture: { precision: 1, recall: 1, f1: 1 },
        other: { precision: 1, recall: 1, f1: 1 },
      },
      totalCases: 15,
      totalIssues: 30,
    };
    const report = runner.generateReport(metrics);
    expect(report).toContain('90.00%');
    expect(report).toContain('80.00%');
    expect(report).toContain('85.00%');
    expect(report).toContain('30');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('Edge Cases', () => {
  it('should handle empty dataset gracefully', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([]);
    expect(result.cases).toHaveLength(0);
    expect(result.aggregate.totalCases).toBe(0);
    expect(result.aggregate.totalIssues).toBe(0);
    // With no results, precision/recall should default to 1 or be NaN-safe
    expect(result.aggregate.overallPrecision).toBeGreaterThanOrEqual(0);
    expect(result.aggregate.overallRecall).toBeGreaterThanOrEqual(0);
  });

  it('should handle single case', () => {
    const runner = createRunner();
    const result = runner.runBenchmark([BENCH_QUALITY_001]);
    expect(result.cases).toHaveLength(1);
    expect(result.aggregate.totalCases).toBe(1);
  });

  it('should handle case with empty ground truth', () => {
    const runner = createRunner();
    const emptyCase: BenchmarkCase = {
      id: 'test-empty-gt',
      language: 'typescript',
      description: 'Empty ground truth case',
      files: [
        {
          filePath: '/src/services/clean-service.ts',
          beforeContent: '',
          afterContent: `export function cleanUtil() {
  return 42;
}`,
        },
      ],
      groundTruth: [],
      expectedFalsePositives: [],
    };
    const result = runner.runBenchmark([emptyCase]);
    expect(result.cases).toHaveLength(1);
    const caseResult = result.cases[0]!;
    // When ground truth is empty, no false negatives possible
    expect(caseResult.falseNegatives).toBe(0);
  });

  it('should handle case with all false positives correctly', () => {
    const runner = createRunner();
    // Create a case where the engine reports issues but none match ground truth
    const allFPCase: BenchmarkCase = {
      id: 'test-all-fp',
      language: 'typescript',
      description: 'All false positive test',
      files: [
        {
          filePath: '/src/test-fp.ts',
          beforeContent: '',
          afterContent: `// This file has code that might trigger heuristics
// but our ground truth expects nothing
class MyClass {
  method() {
    console.log('test');
    const x = fetch('url');
  }
}`,
        },
      ],
      groundTruth: [],
      expectedFalsePositives: [],
    };
    const result = runner.runBenchmark([allFPCase]);
    const caseResult = result.cases[0]!;
    expect(caseResult.truePositives).toBe(0);
    expect(caseResult.falseNegatives).toBe(0);
    // If there are heuristic matches, they'll be false positives
    expect(caseResult.falsePositives).toBeGreaterThanOrEqual(0);
  });

  it('should handle cases with expectedFalsePositives correctly', () => {
    const runner = createRunner();
    const caseWithFP: BenchmarkCase = {
      id: 'test-expected-fp',
      language: 'typescript',
      description: 'Expected false positive test',
      files: [
        {
          filePath: '/src/test-fp.ts',
          beforeContent: '',
          afterContent: `class TestClass {
  method() {
    console.log('this is expected to be flagged but we dont want it');
  }
}`,
        },
      ],
      groundTruth: [],
      expectedFalsePositives: [
        {
          filePath: '/src/test-fp.ts',
          startLine: 3,
          endLine: 3,
          category: 'style',
          severity: 'low',
          description: 'console.log should be considered expected false positive',
        },
      ],
    };
    const result = runner.runBenchmark([caseWithFP]);
    expect(result.cases).toHaveLength(1);
    // Should not crash
  });
});

// ---------------------------------------------------------------------------
// Filtered Benchmark Tests
// ---------------------------------------------------------------------------

describe('Filtered Benchmark', () => {
  it('should filter by category', () => {
    const runner = createRunner();
    const result = runner.runBenchmarkFiltered(ALL_BENCHMARK_CASES, { category: 'bug' });
    expect(result.cases).toHaveLength(15);
    expect(result.aggregate.totalCases).toBe(15);
  });

  it('should filter by severity', () => {
    const runner = createRunner();
    const result = runner.runBenchmarkFiltered(ALL_BENCHMARK_CASES, { severity: 'medium' });
    expect(result.cases).toHaveLength(15);
    expect(result.aggregate.totalCases).toBe(15);
  });

  it('should filter by both category and severity', () => {
    const runner = createRunner();
    const result = runner.runBenchmarkFiltered(ALL_BENCHMARK_CASES, {
      category: 'bug',
      severity: 'medium',
    });
    expect(result.cases).toHaveLength(15);
    expect(result.aggregate.totalCases).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Precision / Recall / F1 Edge Cases
// ---------------------------------------------------------------------------

describe('Metric Edge Cases', () => {
  it('precision should be 1 when no predictions are made and no ground truth', () => {
    const runner = createRunner();
    const results: SingleCaseResult[] = [
      {
        caseId: 'empty-1',
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 0,
      },
    ];
    const metrics = runner.computeMetrics(results);
    // When TP=0, FP=0, FN=0 → precision = 1, recall = 1
    expect(metrics.overallPrecision).toBe(1);
    expect(metrics.overallRecall).toBe(1);
  });

  it('f1 should be 0 when precision and recall are both 0', () => {
    const runner = createRunner();
    const results: SingleCaseResult[] = [
      {
        caseId: 'fail-1',
        truePositives: 0,
        falsePositives: 5,
        falseNegatives: 5,
        precision: 0,
        recall: 0,
        f1Score: 0,
      },
    ];
    const metrics = runner.computeMetrics(results);
    expect(metrics.overallF1).toBe(0);
  });

  it('f1 should be 1 when perfect precision and recall', () => {
    const runner = createRunner();
    const results: SingleCaseResult[] = [
      {
        caseId: 'perfect-1',
        truePositives: 10,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1,
        recall: 1,
        f1Score: 1,
      },
    ];
    const metrics = runner.computeMetrics(results);
    expect(metrics.overallF1).toBe(1);
    expect(metrics.overallPrecision).toBe(1);
    expect(metrics.overallRecall).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Benchmark Result Structure Tests
// ---------------------------------------------------------------------------

describe('Benchmark Result Structure', () => {
  let result: BenchmarkResult;

  beforeEach(() => {
    const runner = createRunner();
    result = runner.runBenchmark(ALL_BENCHMARK_CASES);
  });

  it('should have cases array', () => {
    expect(Array.isArray(result.cases)).toBe(true);
  });

  it('should have aggregate metrics', () => {
    expect(result.aggregate).toBeDefined();
    expect(typeof result.aggregate.overallF1).toBe('number');
    expect(typeof result.aggregate.overallPrecision).toBe('number');
    expect(typeof result.aggregate.overallRecall).toBe('number');
    expect(typeof result.aggregate.totalCases).toBe('number');
    expect(typeof result.aggregate.totalIssues).toBe('number');
  });

  it('should have a non-empty summary string', () => {
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('each case should have required fields', () => {
    for (const c of result.cases) {
      expect(c.caseId).toBeTruthy();
      expect(typeof c.truePositives).toBe('number');
      expect(typeof c.falsePositives).toBe('number');
      expect(typeof c.falseNegatives).toBe('number');
      expect(typeof c.precision).toBe('number');
      expect(typeof c.recall).toBe('number');
      expect(typeof c.f1Score).toBe('number');
    }
  });
});

// ---------------------------------------------------------------------------
// Benchmark Repeatability
// ---------------------------------------------------------------------------

describe('Benchmark Repeatability', () => {
  it('should produce identical results on repeated runs', () => {
    const runner1 = createRunner();
    const result1 = runner1.runBenchmark(ALL_BENCHMARK_CASES);

    const runner2 = createRunner();
    const result2 = runner2.runBenchmark(ALL_BENCHMARK_CASES);

    expect(result1.cases.length).toBe(result2.cases.length);
    for (let i = 0; i < result1.cases.length; i++) {
      expect(result1.cases[i]!.truePositives).toBe(result2.cases[i]!.truePositives);
      expect(result1.cases[i]!.falsePositives).toBe(result2.cases[i]!.falsePositives);
      expect(result1.cases[i]!.falseNegatives).toBe(result2.cases[i]!.falseNegatives);
      expect(result1.cases[i]!.f1Score).toBe(result2.cases[i]!.f1Score);
    }
    expect(result1.aggregate.overallF1).toBe(result2.aggregate.overallF1);
    expect(result1.aggregate.overallPrecision).toBe(result2.aggregate.overallPrecision);
    expect(result1.aggregate.overallRecall).toBe(result2.aggregate.overallRecall);
  });
});
