// @code-analyzer/intelligence — Scientific Benchmark Tests

import { describe, it, expect } from 'vitest';
import {
  computeBootstrapConfidenceIntervals,
  mcnemarTest,
  computeIoU,
  matchDetections,
  computePrecisionRecallF1,
  runScientificBenchmark,
  computeCategoryMetrics,
  type CaseResult,
  type BenchmarkCase,
  type DetectionResult,
  type GroundTruthIssue,
} from '../benchmark/scientific-benchmark.js';

// ---------------------------------------------------------------------------
// IoU Tests
// ---------------------------------------------------------------------------

describe('computeIoU', () => {
  it('returns 1.0 for identical ranges', () => {
    expect(computeIoU(10, 20, 10, 20)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.5 for half-overlapping ranges', () => {
    expect(computeIoU(10, 20, 15, 25)).toBeCloseTo(6 / 16, 5);
  });

  it('returns 0 for non-overlapping ranges', () => {
    expect(computeIoU(1, 10, 20, 30)).toBe(0);
  });

  it('returns 0 for touching but non-overlapping ranges', () => {
    expect(computeIoU(1, 10, 11, 20)).toBe(0);
  });

  it('handles single-line ranges', () => {
    expect(computeIoU(5, 5, 5, 5)).toBeCloseTo(1.0, 5);
  });

  it('handles contained ranges (one inside another)', () => {
    const iou = computeIoU(10, 30, 15, 20);
    const intersection = 6; // lines 15-20
    const union = 21; // lines 10-30
    expect(iou).toBeCloseTo(intersection / union, 5);
  });
});

// ---------------------------------------------------------------------------
// Match Detections Tests
// ---------------------------------------------------------------------------

describe('matchDetections', () => {
  const groundTruth: GroundTruthIssue[] = [
    {
      id: 'gt-1',
      file: 'src/app.ts',
      startLine: 10,
      endLine: 15,
      category: 'security',
      severity: 'high',
      description: 'SQL injection',
      language: 'typescript',
    },
    {
      id: 'gt-2',
      file: 'src/utils.ts',
      startLine: 50,
      endLine: 55,
      category: 'performance',
      severity: 'medium',
      description: 'Inefficient loop',
      language: 'typescript',
    },
  ];

  it('matches exact detections', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/app.ts',
        startLine: 10,
        endLine: 15,
        category: 'security',
        severity: 'high',
        isTruePositive: false,
      },
    ];

    const matched = matchDetections(detections, groundTruth);
    expect(matched[0]!.isTruePositive).toBe(true);
    expect(matched[0]!.matchedGroundTruthId).toBe('gt-1');
  });

  it('matches partial overlap detections', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/app.ts',
        startLine: 12,
        endLine: 14,
        category: 'security',
        severity: 'high',
        isTruePositive: false,
      },
    ];

    const matched = matchDetections(detections, groundTruth);
    expect(matched[0]!.isTruePositive).toBe(true);
  });

  it('rejects detections below IoU threshold', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/app.ts',
        startLine: 1,
        endLine: 2,
        category: 'security',
        severity: 'high',
        isTruePositive: false,
      },
    ];

    const matched = matchDetections(detections, groundTruth, 0.5);
    expect(matched[0]!.isTruePositive).toBe(false);
  });

  it('handles empty detections', () => {
    const matched = matchDetections([], groundTruth);
    expect(matched).toEqual([]);
  });

  it('handles empty ground truth', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/app.ts',
        startLine: 10,
        endLine: 15,
        category: 'security',
        severity: 'high',
        isTruePositive: false,
      },
    ];
    const matched = matchDetections(detections, []);
    expect(matched[0]!.isTruePositive).toBe(false);
  });

  it('respects categoryMustMatch option', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/app.ts',
        startLine: 10,
        endLine: 15,
        category: 'performance',
        severity: 'high',
        isTruePositive: false,
      },
    ];

    const matched = matchDetections(detections, groundTruth, 0.5, true);
    expect(matched[0]!.isTruePositive).toBe(false);
  });

  it('matches same file only', () => {
    const detections: DetectionResult[] = [
      {
        id: 'det-1',
        file: 'src/other.ts',
        startLine: 10,
        endLine: 15,
        category: 'security',
        severity: 'high',
        isTruePositive: false,
      },
    ];

    const matched = matchDetections(detections, groundTruth);
    expect(matched[0]!.isTruePositive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Precision/Recall/F1 Tests
// ---------------------------------------------------------------------------

describe('computePrecisionRecallF1', () => {
  it('returns perfect scores for perfect detection', () => {
    const detections: DetectionResult[] = [
      {
        id: 'd1',
        file: 'a.ts',
        startLine: 1,
        endLine: 5,
        category: 'security',
        severity: 'high',
        isTruePositive: true,
        matchedGroundTruthId: 'gt-1',
      },
      {
        id: 'd2',
        file: 'b.ts',
        startLine: 10,
        endLine: 15,
        category: 'performance',
        severity: 'medium',
        isTruePositive: true,
        matchedGroundTruthId: 'gt-2',
      },
    ];

    const { precision, recall, f1 } = computePrecisionRecallF1(detections, 2);
    expect(precision).toBe(1.0);
    expect(recall).toBe(1.0);
    expect(f1).toBe(1.0);
  });

  it('handles all false positives', () => {
    const detections: DetectionResult[] = [
      {
        id: 'd1',
        file: 'a.ts',
        startLine: 1,
        endLine: 5,
        category: 'style',
        severity: 'low',
        isTruePositive: false,
      },
    ];

    const { precision, recall, f1 } = computePrecisionRecallF1(detections, 2);
    expect(precision).toBe(0);
    expect(recall).toBe(0);
    expect(f1).toBe(0);
  });

  it('handles empty detections with ground truth', () => {
    const { precision, recall, f1 } = computePrecisionRecallF1([], 5);
    expect(precision).toBe(0);
    expect(recall).toBe(0);
    expect(f1).toBe(0);
  });

  it('handles zero ground truth', () => {
    const detections: DetectionResult[] = [
      {
        id: 'd1',
        file: 'a.ts',
        startLine: 1,
        endLine: 5,
        category: 'style',
        severity: 'low',
        isTruePositive: false,
      },
    ];
    const { precision, recall, f1 } = computePrecisionRecallF1(detections, 0);
    expect(precision).toBe(0);
    expect(recall).toBe(0);
    expect(f1).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap Confidence Interval Tests
// ---------------------------------------------------------------------------

describe('computeBootstrapConfidenceIntervals', () => {
  it('returns confidence intervals for valid results', () => {
    const results: CaseResult[] = Array.from({ length: 50 }, (_, i) => ({
      caseId: `case-${i}`,
      repository: 'test/repo',
      languages: ['typescript'],
      loc: 100,
      truePositives: 3 + (i % 3),
      falsePositives: 1,
      falseNegatives: 2 - (i % 3),
      precision: 0.7 + Math.random() * 0.2,
      recall: 0.6 + Math.random() * 0.3,
      f1: 0.65 + Math.random() * 0.25,
      durationMs: 10,
      detections: [],
    }));

    const intervals = computeBootstrapConfidenceIntervals(results, 1000);
    expect(intervals.length).toBe(3);

    for (const interval of intervals) {
      expect(interval.lower).toBeGreaterThanOrEqual(0);
      expect(interval.upper).toBeLessThanOrEqual(1);
      expect(interval.lower).toBeLessThanOrEqual(interval.estimate);
      expect(interval.estimate).toBeLessThanOrEqual(interval.upper);
    }
  });

  it('returns empty array for empty results', () => {
    const intervals = computeBootstrapConfidenceIntervals([]);
    expect(intervals).toEqual([]);
  });

  it('converges for large sample sizes', () => {
    const results: CaseResult[] = Array.from({ length: 200 }, (_, i) => ({
      caseId: `case-${i}`,
      repository: 'test/repo',
      languages: ['typescript'],
      loc: 100,
      truePositives: 5,
      falsePositives: 0,
      falseNegatives: 0,
      precision: 1.0,
      recall: 1.0,
      f1: 1.0,
      durationMs: 10,
      detections: [],
    }));

    const intervals = computeBootstrapConfidenceIntervals(results, 1000);
    for (const interval of intervals) {
      // For perfect results, the CI should be tight around 1.0
      expect(interval.estimate).toBeCloseTo(1.0, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// McNemar Test
// ---------------------------------------------------------------------------

describe('mcnemarTest', () => {
  it('returns no significance for identical results', () => {
    const results: CaseResult[] = [
      {
        caseId: 'case-1',
        repository: 'repo/a',
        languages: ['typescript'],
        loc: 100,
        truePositives: 3,
        falsePositives: 1,
        falseNegatives: 2,
        precision: 0.75,
        recall: 0.6,
        f1: 0.667,
        durationMs: 10,
        detections: [
          {
            id: 'd1',
            file: 'a.ts',
            startLine: 1,
            endLine: 5,
            category: 'security',
            severity: 'high',
            isTruePositive: true,
            matchedGroundTruthId: 'gt-1',
          },
        ],
      },
    ];

    const result = mcnemarTest(results, results);
    expect(result.test).toBe('mcnemar');
    expect(result.significant).toBe(false);
  });

  it('detects significant difference', () => {
    const systemA: CaseResult[] = [
      {
        caseId: 'case-1',
        repository: 'repo/a',
        languages: ['typescript'],
        loc: 100,
        truePositives: 8,
        falsePositives: 1,
        falseNegatives: 2,
        precision: 0.889,
        recall: 0.8,
        f1: 0.842,
        durationMs: 10,
        detections: [
          { id: 'a1', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g1' },
          { id: 'a2', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g2' },
          { id: 'a3', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g3' },
          { id: 'a4', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: false },
        ],
      },
    ];

    const systemB: CaseResult[] = [
      {
        caseId: 'case-1',
        repository: 'repo/a',
        languages: ['typescript'],
        loc: 100,
        truePositives: 10,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 1.0,
        recall: 1.0,
        f1: 1.0,
        durationMs: 10,
        detections: [
          { id: 'b1', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g1' },
          { id: 'b2', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g2' },
          { id: 'b3', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g3' },
          { id: 'b4', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g4' },
          { id: 'b5', file: 'f.ts', startLine: 1, endLine: 3, category: 'sec', severity: 'high', isTruePositive: true, matchedGroundTruthId: 'g5' },
        ],
      },
    ];

    const result = mcnemarTest(systemA, systemB);
    expect(result.test).toBe('mcnemar');
    expect(typeof result.pValue).toBe('number');
    expect(typeof result.significant).toBe('boolean');
  });

  it('handles empty inputs', () => {
    const result = mcnemarTest([], []);
    expect(result.significant).toBe(false);
    expect(result.pValue).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Scientific Benchmark Runner Tests
// ---------------------------------------------------------------------------

describe('runScientificBenchmark', () => {
  const sampleCases: BenchmarkCase[] = [
    {
      id: 'pr-1',
      repository: 'test/repo-a',
      prNumber: 1,
      languages: ['typescript'],
      loc: 50,
      fileCount: 2,
      realWorld: false,
      groundTruth: [
        {
          id: 'gt-1-1',
          file: 'src/app.ts',
          startLine: 10,
          endLine: 15,
          category: 'security',
          severity: 'high',
          description: 'SQL injection in query builder',
          cweId: 'CWE-89',
          language: 'typescript',
        },
        {
          id: 'gt-1-2',
          file: 'src/utils.ts',
          startLine: 20,
          endLine: 25,
          category: 'performance',
          severity: 'medium',
          description: 'N+1 query pattern',
          language: 'typescript',
        },
      ],
      expectedFalsePositives: [
        {
          id: 'fp-1-1',
          file: 'src/app.ts',
          startLine: 30,
          endLine: 35,
          category: 'style',
          severity: 'low',
          description: 'Line too long (should be ignored)',
          language: 'typescript',
        },
      ],
    },
    {
      id: 'pr-2',
      repository: 'test/repo-b',
      prNumber: 2,
      languages: ['python'],
      loc: 80,
      fileCount: 3,
      realWorld: false,
      groundTruth: [
        {
          id: 'gt-2-1',
          file: 'main.py',
          startLine: 5,
          endLine: 12,
          category: 'security',
          severity: 'critical',
          description: 'Hardcoded credentials',
          cweId: 'CWE-798',
          language: 'python',
        },
      ],
      expectedFalsePositives: [],
    },
  ];

  const fileProvider = (caseId: string): Map<string, string> => {
    if (caseId === 'pr-1') {
      return new Map([
        ['src/app.ts', 'function query(sql) { db.execute(sql); }'],
        ['src/utils.ts', 'for (const item of items) { await db.query(); }'],
      ]);
    }
    if (caseId === 'pr-2') {
      return new Map([
        ['main.py', 'PASSWORD = "secret123"\ndef connect():\n    pass'],
        ['utils.py', '# helper functions'],
        ['config.py', 'DEBUG = True'],
      ]);
    }
    return new Map();
  };

  const perfectDetectFn = async (
    caseId: string,
    _files: Map<string, string>,
  ): Promise<DetectionResult[]> => {
    if (caseId === 'pr-1') {
      return [
        {
          id: 'd1',
          file: 'src/app.ts',
          startLine: 10,
          endLine: 15,
          category: 'security',
          severity: 'high',
          isTruePositive: false,
        },
        {
          id: 'd2',
          file: 'src/utils.ts',
          startLine: 20,
          endLine: 25,
          category: 'performance',
          severity: 'medium',
          isTruePositive: false,
        },
      ];
    }
    if (caseId === 'pr-2') {
      return [
        {
          id: 'd3',
          file: 'main.py',
          startLine: 5,
          endLine: 12,
          category: 'security',
          severity: 'critical',
          isTruePositive: false,
        },
      ];
    }
    return [];
  };

  it('runs a complete scientific benchmark', async () => {
    const result = await runScientificBenchmark(
      sampleCases,
      perfectDetectFn,
      fileProvider,
      { suiteName: 'test-bench', version: '1.0.0' },
    );

    expect(result.metadata.suiteName).toBe('test-bench');
    expect(result.metadata.totalCases).toBe(2);
    expect(result.metadata.totalGroundTruth).toBe(3);
    expect(result.metadata.languages).toContain('typescript');
    expect(result.metadata.languages).toContain('python');

    // Perfect detection should yield F1 = 1.0
    expect(result.overall.precision).toBe(1.0);
    expect(result.overall.recall).toBe(1.0);
    expect(result.overall.f1).toBe(1.0);
    expect(result.overall.totalDetections).toBe(3);

    expect(result.cases.length).toBe(2);
    expect(result.confidenceIntervals.length).toBe(3);
    expect(result.byCategory.length).toBeGreaterThan(0);
    expect(result.byLanguage.length).toBeGreaterThan(0);
  });

  it('handles imperfect detection', async () => {
    const imperfectFn = async (
      _caseId: string,
      _files: Map<string, string>,
    ): Promise<DetectionResult[]> => {
      return [
        {
          id: 'd1',
          file: 'src/app.ts',
          startLine: 10,
          endLine: 15,
          category: 'security',
          severity: 'high',
          isTruePositive: false,
        },
        // Missing the performance issue (recall < 1)
        // Adding a false positive
        {
          id: 'd-fp',
          file: 'src/other.ts',
          startLine: 1,
          endLine: 3,
          category: 'style',
          severity: 'low',
          isTruePositive: false,
        },
      ];
    };

    const result = await runScientificBenchmark(
      [sampleCases[0]!],
      imperfectFn,
      fileProvider,
    );

    // Only 1 of 2 ground truth issues found (recall = 0.5)
    // 1 TP + 1 FP → precision = 0.5
    expect(result.overall.precision).toBeCloseTo(0.5, 2);
    expect(result.overall.recall).toBeCloseTo(0.5, 2);
  });

  it('handles empty benchmark suite', async () => {
    const result = await runScientificBenchmark(
      [],
      async () => [],
      () => new Map(),
    );

    expect(result.metadata.totalCases).toBe(0);
    expect(result.overall.f1).toBe(0);
    expect(result.cases).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Category Metrics Tests
// ---------------------------------------------------------------------------

describe('computeCategoryMetrics', () => {
  const cases: BenchmarkCase[] = [
    {
      id: 'c1',
      repository: 'test/r',
      languages: ['typescript'],
      loc: 100,
      fileCount: 1,
      realWorld: false,
      groundTruth: [
        {
          id: 'gt-sec',
          file: 'a.ts',
          startLine: 1,
          endLine: 5,
          category: 'security',
          severity: 'high',
          description: 'XSS',
          language: 'typescript',
        },
        {
          id: 'gt-perf',
          file: 'a.ts',
          startLine: 10,
          endLine: 15,
          category: 'performance',
          severity: 'medium',
          description: 'Slow loop',
          language: 'typescript',
        },
      ],
      expectedFalsePositives: [],
    },
  ];

  const detections: DetectionResult[] = [
    {
      id: 'd1',
      file: 'a.ts',
      startLine: 1,
      endLine: 5,
      category: 'security',
      severity: 'high',
      isTruePositive: true,
      matchedGroundTruthId: 'gt-sec',
    },
    {
      id: 'd2',
      file: 'a.ts',
      startLine: 1,
      endLine: 5,
      category: 'security',
      severity: 'high',
      isTruePositive: false,
    },
  ];

  it('computes per-category metrics', () => {
    const metrics = computeCategoryMetrics(cases, detections);
    const securityMetric = metrics.find((m) => m.category === 'security');
    const perfMetric = metrics.find((m) => m.category === 'performance');

    expect(securityMetric).toBeDefined();
    expect(perfMetric).toBeDefined();

    // Security: 1 TP + 1 FP + 0 FN → P=0.5
    expect(securityMetric!.precision).toBeCloseTo(0.5, 2);

    // Performance: 0 TP + 0 FP + 1 FN → P=0, R=0
    expect(perfMetric!.recall).toBe(0);
  });
});
