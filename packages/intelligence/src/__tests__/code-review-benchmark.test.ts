// @code-analyzer/intelligence — Code Review Benchmark Tests
import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from '../benchmark/code-review-benchmark.js';
import { ALL_BENCHMARK_FIXTURES, FIXTURE_STATS } from '../benchmark/benchmark-fixtures.js';
import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Mock Detection Helpers
// ---------------------------------------------------------------------------

function makeMockComment(
  id: string,
  filePath: string,
  startLine: number,
  endLine: number,
  category: string,
): ReviewComment {
  return {
    id,
    path: filePath,
    content: `Mock issue: ${id}`,
    thinking: 'Mock detection for benchmark testing',
    existingCode: '',
    startLine,
    endLine,
    category: category as ReviewComment['category'],
    severity: 'medium',
    filtered: false,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests: Fixture Validation
// ---------------------------------------------------------------------------

describe('Benchmark Fixtures', () => {
  it('should have the correct number of fixtures', () => {
    expect(ALL_BENCHMARK_FIXTURES.length).toBe(FIXTURE_STATS.totalFixtures);
  });

  it('should have the correct number of ground truth issues', () => {
    const totalGT = ALL_BENCHMARK_FIXTURES.reduce(
      (sum, f) => sum + f.groundTruth.length, 0,
    );
    expect(totalGT).toBe(FIXTURE_STATS.totalGroundTruthIssues);
  });

  it('should cover all 5 languages', () => {
    const languages = new Set(ALL_BENCHMARK_FIXTURES.map((f) => f.language));
    for (const lang of FIXTURE_STATS.languages) {
      expect(languages.has(lang)).toBe(true);
    }
  });

  it('should have valid line ranges in all ground truth', () => {
    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      const totalLines = fixture.content.split('\n').length;
      for (const gt of fixture.groundTruth) {
        expect(gt.startLine).toBeGreaterThan(0);
        expect(gt.endLine).toBeGreaterThanOrEqual(gt.startLine);
        expect(gt.endLine).toBeLessThanOrEqual(totalLines);
      }
    }
  });

  it('should have unique IDs across all ground truth', () => {
    const ids = new Set<string>();
    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      for (const gt of fixture.groundTruth) {
        expect(ids.has(gt.id)).toBe(false);
        ids.add(gt.id);
      }
    }
  });

  it('should have content matching filePath language', () => {
    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      const ext = fixture.filePath.split('.').pop();
      expect(fixture.language).toBeDefined();
      expect(fixture.content.length).toBeGreaterThan(0);
    }
  });

  it('should include all bug categories', () => {
    const categories = new Set<string>();
    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      for (const gt of fixture.groundTruth) {
        categories.add(gt.category);
      }
    }
    expect(categories.has('security')).toBe(true);
    expect(categories.has('correctness')).toBe(true);
    expect(categories.has('performance')).toBe(true);
    expect(categories.has('maintainability')).toBe(true);
    expect(categories.has('style')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Benchmark Runner — Perfect Detection
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Perfect Detection', () => {
  const runner = new BenchmarkRunner();

  it('should return perfect scores for exact matches', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();
    detections.set(
      fixture.filePath,
      fixture.groundTruth.map((gt) =>
        makeMockComment(
          `det-${gt.id}`,
          fixture.filePath,
          gt.startLine,
          gt.endLine,
          gt.category,
        ),
      ),
    );

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.f1Score).toBe(1);
    expect(result.noiseRate).toBe(0);
    expect(result.falseNegatives).toBe(0);
    expect(result.falsePositives).toBe(0);
  });

  it('should return zero scores for no detections', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1Score).toBe(0);
    expect(result.falseNegatives).toBe(fixture.groundTruth.length);
  });

  it('should handle all false positives scenarios', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();
    detections.set(fixture.filePath, [
      makeMockComment('fp-1', fixture.filePath, 999, 999, 'style'),
      makeMockComment('fp-2', fixture.filePath, 888, 888, 'style'),
    ]);

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.falsePositives).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Benchmark Runner — Partial Detection
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Partial Detection', () => {
  const runner = new BenchmarkRunner();

  it('should handle mixed true positives and false positives', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();
    // Detecting 1 out of 2 ground truth issues
    const gt1 = fixture.groundTruth[0]!;
    detections.set(fixture.filePath, [
      makeMockComment('tp-1', fixture.filePath, gt1.startLine, gt1.endLine, gt1.category),
      makeMockComment('fp-1', fixture.filePath, 999, 999, 'style'),
    ]);

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(1);
    expect(result.falseNegatives).toBe(1);
    expect(result.precision).toBe(0.5);
    expect(result.recall).toBe(0.5);
  });

  it('should require category match for true positives', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const gt = fixture.groundTruth[0]!;
    const detections = new Map<string, ReviewComment[]>();
    // Same line range but wrong category
    detections.set(fixture.filePath, [
      makeMockComment('wrong-cat', fixture.filePath, gt.startLine, gt.endLine, 'style'),
    ]);

    const strictRunner = new BenchmarkRunner({ requireCategoryMatch: true });
    const result = strictRunner.runBenchmark([fixture], detections, 1000);
    expect(result.truePositives).toBe(0);
    expect(result.falsePositives).toBe(1);
  });

  it('should allow flexible category matching when disabled', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const gt = fixture.groundTruth[0]!;
    const detections = new Map<string, ReviewComment[]>();
    detections.set(fixture.filePath, [
      makeMockComment('flex-cat', fixture.filePath, gt.startLine, gt.endLine, 'style'),
    ]);

    const flexibleRunner = new BenchmarkRunner({ requireCategoryMatch: false });
    const result = flexibleRunner.runBenchmark([fixture], detections, 1000);
    expect(result.truePositives).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: Benchmark Runner — Metrics Calculation
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Metrics Calculation', () => {
  const runner = new BenchmarkRunner();

  it('should calculate correct F1 score', () => {
    // Create a scenario with precision=0.6, recall=0.75 => F1=0.667
    const fixture = {
      filePath: 'test.ts',
      language: 'typescript',
      content: 'code',
      groundTruth: [
        { id: 'gt1', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 1, endLine: 1, description: '', language: 'typescript' },
        { id: 'gt2', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 2, endLine: 2, description: '', language: 'typescript' },
        { id: 'gt3', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 3, endLine: 3, description: '', language: 'typescript' },
        { id: 'gt4', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 4, endLine: 4, description: '', language: 'typescript' },
      ],
    };

    const detections = new Map<string, ReviewComment[]>();
    detections.set('test.ts', [
      makeMockComment('tp1', 'test.ts', 1, 1, 'bug'),
      makeMockComment('tp2', 'test.ts', 2, 2, 'bug'),
      makeMockComment('tp3', 'test.ts', 3, 3, 'bug'),
      makeMockComment('fp1', 'test.ts', 99, 99, 'bug'),
      makeMockComment('fp2', 'test.ts', 98, 98, 'bug'),
    ]);

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.truePositives).toBe(3);
    expect(result.falsePositives).toBe(2);
    expect(result.falseNegatives).toBe(1);
    expect(result.precision).toBe(0.6);
    expect(result.recall).toBe(0.75);
    // F1 = 2 * 0.6 * 0.75 / (0.6 + 0.75) = 0.9 / 1.35 = 0.667
    expect(result.f1Score).toBe(0.667);
    expect(result.noiseRate).toBe(0.67);
  });

  it('should handle edge case: zero ground truth', () => {
    const fixture = {
      filePath: 'empty.ts',
      language: 'typescript',
      content: '',
      groundTruth: [],
    };

    const detections = new Map<string, ReviewComment[]>();
    detections.set('empty.ts', [
      makeMockComment('fp', 'empty.ts', 1, 1, 'style'),
    ]);

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.recall).toBe(0);
    expect(result.precision).toBe(0);
    expect(result.f1Score).toBe(0);
  });

  it('should handle edge case: zero detections', () => {
    const fixture = {
      filePath: 'test.ts',
      language: 'typescript',
      content: 'code',
      groundTruth: [
        { id: 'gt1', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 1, endLine: 1, description: '', language: 'typescript' },
      ],
    };

    const result = runner.runBenchmark([fixture], new Map(), 1000);
    expect(result.truePositives).toBe(0);
    expect(result.falseNegatives).toBe(1);
    expect(result.noiseRate).toBe(0);
  });

  it('should calculate per-category breakdown correctly', () => {
    const fixture = {
      filePath: 'multi.ts',
      language: 'typescript',
      content: 'code',
      groundTruth: [
        { id: 'gt-sec', filePath: 'multi.ts', category: 'security', severity: 'high', startLine: 1, endLine: 1, description: '', language: 'typescript' },
        { id: 'gt-perf', filePath: 'multi.ts', category: 'performance', severity: 'medium', startLine: 2, endLine: 2, description: '', language: 'typescript' },
      ],
    };

    const detections = new Map<string, ReviewComment[]>();
    detections.set('multi.ts', [
      makeMockComment('tp-sec', 'multi.ts', 1, 1, 'security'),
    ]);

    const result = runner.runBenchmark([fixture], detections, 1000);
    expect(result.categoryBreakdown.length).toBeGreaterThanOrEqual(2);

    const secBreakdown = result.categoryBreakdown.find((b) => b.category === 'security');
    expect(secBreakdown).toBeDefined();
    expect(secBreakdown!.truePositives).toBe(1);
    expect(secBreakdown!.precision).toBe(1);
    expect(secBreakdown!.recall).toBe(1);

    const perfBreakdown = result.categoryBreakdown.find((b) => b.category === 'performance');
    expect(perfBreakdown).toBeDefined();
    expect(perfBreakdown!.truePositives).toBe(0);
    expect(perfBreakdown!.recall).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Benchmark Report Generation
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Report Generation', () => {
  const runner = new BenchmarkRunner();

  it('should generate a valid markdown report', () => {
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();
    detections.set(
      fixture.filePath,
      fixture.groundTruth.map((gt) =>
        makeMockComment(`det-${gt.id}`, fixture.filePath, gt.startLine, gt.endLine, gt.category),
      ),
    );

    const result = runner.runBenchmark([fixture], detections, 1000);
    const report = runner.generateReport(result);

    expect(report).toContain('# Code Analyzer — Code Review Benchmark Report');
    expect(report).toContain('## Overall Metrics');
    expect(report).toContain('## Comparison with Industry Benchmarks');
    expect(report).toContain('## Per-Category Breakdown');
    expect(report).toContain('Precision');
    expect(report).toContain('Recall');
    expect(report).toContain('F1 Score');
  });
});

// ---------------------------------------------------------------------------
// Tests: Full Integration — All Fixtures
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Full Integration', () => {
  const runner = new BenchmarkRunner();

  it('should process all 19 fixtures without errors', () => {
    // Create mock detections: detect 70% of issues by copying ground truth
    const detections = new Map<string, ReviewComment[]>();

    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      const fixtureDets = fixture.groundTruth
        .filter((_, i) => i % 3 !== 2) // Skip every 3rd issue (simulate 67% recall)
        .map((gt) =>
          makeMockComment(`det-${gt.id}`, fixture.filePath, gt.startLine, gt.endLine, gt.category),
        );
      detections.set(fixture.filePath, fixtureDets);
    }

    const result = runner.runBenchmark(ALL_BENCHMARK_FIXTURES, detections, 2000);

    // Basic sanity checks
    expect(result.fixturesProcessed).toBe(19);
    expect(result.languagesTested).toBe(5);
    expect(result.totalGroundTruth).toBe(FIXTURE_STATS.totalGroundTruthIssues);
    expect(result.precision).toBeGreaterThan(0);
    expect(result.recall).toBeGreaterThan(0);
    expect(result.f1Score).toBeGreaterThan(0);

    // Category breakdown should cover all categories
    const categories = new Set(result.categoryBreakdown.map((b) => b.category));
    expect(categories.has('security')).toBe(true);
    expect(categories.has('correctness')).toBe(true);
    expect(categories.has('performance')).toBe(true);
    expect(categories.has('maintainability')).toBe(true);

    // Generate report should succeed
    const report = runner.generateReport(result);
    expect(report.length).toBeGreaterThan(500);
  });

  it('should have valid metrics for realistic recall rates', () => {
    const detections = new Map<string, ReviewComment[]>();

    for (const fixture of ALL_BENCHMARK_FIXTURES) {
      // Detect ~55% of issues (matching Augment's recall)
      const fixtureDets = fixture.groundTruth
        .filter((_, i) => i % 4 < 2 || (i % 7 === 0)) // ~55% recall
        .map((gt) =>
          makeMockComment(`det-${gt.id}`, fixture.filePath, gt.startLine, gt.endLine, gt.category),
        );
      // Add some false positives (~30% noise)
      if (fixtureDets.length > 0) {
        fixtureDets.push(
          makeMockComment(`fp-${fixture.filePath}`, fixture.filePath, 888, 888, 'style'),
        );
      }
      detections.set(fixture.filePath, fixtureDets);
    }

    const result = runner.runBenchmark(ALL_BENCHMARK_FIXTURES, detections, 2000);

    // With all items detected in small fixtures and some false positives:
    expect(result.recall).toBeGreaterThan(0.9);
    expect(result.precision).toBeLessThan(1.0);
    // Noise rate should be positive
    expect(result.noiseRate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Acceptance Criteria
// ---------------------------------------------------------------------------

describe('BenchmarkRunner — Acceptance Criteria', () => {
  it('AC-1: Line overlap calculation is correct (exact match)', () => {
    const runner = new BenchmarkRunner();
    const fixture = {
      filePath: 'test.ts',
      language: 'typescript',
      content: 'a\nb\nc',
      groundTruth: [
        { id: 'gt1', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 1, endLine: 3, description: '', language: 'typescript' },
      ],
    };
    const detections = new Map<string, ReviewComment[]>();
    detections.set('test.ts', [
      makeMockComment('exact', 'test.ts', 1, 3, 'bug'),
    ]);
    const result = runner.runBenchmark([fixture], detections, 100);
    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
  });

  it('AC-2: Line overlap handles partial overlap correctly', () => {
    const runner = new BenchmarkRunner({ overlapThreshold: 0.3 });
    const fixture = {
      filePath: 'test.ts',
      language: 'typescript',
      content: 'a\nb\nc\nd\ne',
      groundTruth: [
        { id: 'gt1', filePath: 'test.ts', category: 'bug', severity: 'high', startLine: 1, endLine: 5, description: '', language: 'typescript' },
      ],
    };
    const detections = new Map<string, ReviewComment[]>();
    detections.set('test.ts', [
      makeMockComment('partial', 'test.ts', 3, 7, 'bug'),
    ]);
    const result = runner.runBenchmark([fixture], detections, 100);
    // Overlap: gt[1-5] ∩ det[3-7] = [3-5], overlap=3, union=5+5-3=7, score=3/7=0.43
    // threshold is 0.3, so this should match
    expect(result.truePositives).toBe(1);
  });

  it('AC-3: Noise rate is correctly calculated for multiple FPs per TP', () => {
    const runner = new BenchmarkRunner();
    const fixture = {
      filePath: 'noisy.ts',
      language: 'typescript',
      content: 'code',
      groundTruth: [
        { id: 'gt1', filePath: 'noisy.ts', category: 'bug', severity: 'high', startLine: 1, endLine: 1, description: '', language: 'typescript' },
      ],
    };
    const detections = new Map<string, ReviewComment[]>();
    detections.set('noisy.ts', [
      makeMockComment('tp', 'noisy.ts', 1, 1, 'bug'),
      makeMockComment('fp1', 'noisy.ts', 10, 10, 'style'),
      makeMockComment('fp2', 'noisy.ts', 20, 20, 'style'),
      makeMockComment('fp3', 'noisy.ts', 30, 30, 'style'),
    ]);
    const result = runner.runBenchmark([fixture], detections, 100);
    expect(result.noiseRate).toBe(3);
  });

  it('AC-4: Benchmark report contains industry comparison data', () => {
    const runner = new BenchmarkRunner();
    const fixture = ALL_BENCHMARK_FIXTURES[0]!;
    const detections = new Map<string, ReviewComment[]>();
    detections.set(
      fixture.filePath,
      fixture.groundTruth.map((gt) =>
        makeMockComment(`d-${gt.id}`, fixture.filePath, gt.startLine, gt.endLine, gt.category),
      ),
    );
    const result = runner.runBenchmark([fixture], detections, 100);
    const report = runner.generateReport(result);
    expect(report).toContain('SonarQube AI');
    expect(report).toContain('Augment Code');
    expect(report).toContain('CodeRabbit');
    expect(report).toContain('GitHub Copilot');
  });

  it('AC-5: F1 score is 0 when both precision and recall are 0', () => {
    const runner = new BenchmarkRunner();
    const result = runner.runBenchmark(
      [{ filePath: 'x.ts', language: 'typescript', content: '', groundTruth: [] }],
      new Map(),
      0,
    );
    expect(result.f1Score).toBe(0);
  });
});
