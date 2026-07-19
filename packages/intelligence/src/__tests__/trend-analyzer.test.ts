// @ts-nocheck — test file assertion patterns may access possibly-undefined
import { describe, it, expect } from 'vitest';
import { TrendAnalyzer } from '../report/trends.js';
import type { AnalysisReport, Finding } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    id: 'report-1',
    type: 'pr-review',
    title: 'Test Report',
    createdAt: '2025-01-12T10:00:00Z',
    scope: { type: 'project', projectId: 'proj-1' },
    summary: {
      overallScore: 85,
      riskLevel: 'medium',
      totalFindings: 5,
      criticalFindings: 1,
      highFindings: 2,
      mediumFindings: 1,
      lowFindings: 1,
      keyTakeaways: [],
      mergeRecommendation: 'request-changes',
      mergeRationale: '',
    },
    findings: [],
    recommendations: [],
    metrics: {
      linesChanged: 100,
      filesChanged: 5,
      symbolsAffected: 3,
      routesAffected: 0,
      testsImpacted: 2,
      complexityDelta: 3,
      coverageDelta: -2,
      complianceScore: 85,
      reviewDuration: 500,
      tokenUsage: 1000,
    },
    metadata: {
      repository: 'org/repo',
      branch: 'main',
      baseBranch: 'main',
      commitSha: 'abc',
      author: 'dev',
      reviewer: '',
      standardsApplied: [],
      rulesApplied: [],
      generatorVersion: '0.1.0',
    },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    category: 'bug',
    severity: 'high',
    title: 'Test finding',
    description: 'Description',
    filePath: 'src/file.ts',
    lineRange: [1, 1],
    evidence: 'code',
    relatedFindings: [],
    ...overrides,
  };
}

function makeEngine(): TrendAnalyzer {
  return new TrendAnalyzer();
}

// ---------------------------------------------------------------------------
// trackMetric
// ---------------------------------------------------------------------------

describe('TrendAnalyzer — trackMetric', () => {
  const analyzer = makeEngine();

  it('should track a metric over multiple reports', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, overallScore: 70 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, overallScore: 75 } }),
      makeReport({ createdAt: '2025-01-12T00:00:00Z', summary: { ...makeReport().summary, overallScore: 85 } }),
    ];

    const trend = analyzer.trackMetric(reports, 'summary.overallScore');
    expect(trend.values).toEqual([70, 75, 85]);
    expect(trend.timestamps).toHaveLength(3);
    expect(trend.direction).toBe('improving');
    expect(trend.changeRate).toBeGreaterThan(0);
  });

  it('should detect degrading trends', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, overallScore: 90 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, overallScore: 80 } }),
      makeReport({ createdAt: '2025-01-12T00:00:00Z', summary: { ...makeReport().summary, overallScore: 60 } }),
    ];

    const trend = analyzer.trackMetric(reports, 'summary.overallScore');
    expect(trend.direction).toBe('degrading');
    expect(trend.changeRate).toBeLessThan(0);
  });

  it('should detect stable trends (within 2% change)', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, overallScore: 85 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, overallScore: 85.5 } }),
      makeReport({ createdAt: '2025-01-12T00:00:00Z', summary: { ...makeReport().summary, overallScore: 85.1 } }),
    ];

    const trend = analyzer.trackMetric(reports, 'summary.overallScore');
    expect(trend.direction).toBe('stable');
  });

  it('should handle empty reports', () => {
    const trend = analyzer.trackMetric([], 'summary.overallScore');
    expect(trend.values).toHaveLength(0);
    expect(trend.direction).toBe('stable');
  });

  it('should handle single report', () => {
    const trend = analyzer.trackMetric(
      [makeReport()],
      'summary.overallScore',
    );
    expect(trend.values).toHaveLength(1);
    expect(trend.direction).toBe('stable');
    expect(trend.changeRate).toBe(0);
  });

  it('should track nested metric paths', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', metrics: { ...makeReport().metrics, complianceScore: 80 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', metrics: { ...makeReport().metrics, complianceScore: 90 } }),
    ];

    const trend = analyzer.trackMetric(reports, 'metrics.complianceScore');
    expect(trend.values).toEqual([80, 90]);
    expect(trend.direction).toBe('improving');
  });

  it('should sort reports chronologically', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-12T00:00:00Z', summary: { ...makeReport().summary, totalFindings: 5 } }),
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, totalFindings: 10 } }),
    ];

    const trend = analyzer.trackMetric(reports, 'summary.totalFindings');
    expect(trend.values[0]).toBe(10);
    expect(trend.values[1]).toBe(5);
  });

  it('should return null-padded values for missing paths', () => {
    const reports = [makeReport()];
    const trend = analyzer.trackMetric(reports, 'nonexistent.path');
    expect(trend.values).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// compareReports
// ---------------------------------------------------------------------------

describe('TrendAnalyzer — compareReports', () => {
  const analyzer = makeEngine();

  it('should detect added and removed findings', () => {
    const reportA = makeReport({
      id: 'report-a',
      createdAt: '2025-01-10T00:00:00Z',
      findings: [makeFinding({ id: 'old-bug', title: 'Old bug' })],
    });

    const reportB = makeReport({
      id: 'report-b',
      createdAt: '2025-01-12T00:00:00Z',
      findings: [makeFinding({ id: 'new-bug', title: 'New bug' })],
    });

    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.addedFindings).toHaveLength(1);
    expect(comparison.addedFindings[0].id).toBe('new-bug');
    expect(comparison.removedFindings).toHaveLength(1);
    expect(comparison.removedFindings[0].id).toBe('old-bug');
  });

  it('should compute metric deltas', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      metrics: { ...makeReport().metrics, linesChanged: 100 },
    });

    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      metrics: { ...makeReport().metrics, linesChanged: 150 },
    });

    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.metricDeltas['metrics.linesChanged']).toBe(50);
  });

  it('should detect improvement when critical findings are removed', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      findings: [makeFinding({ id: 'f-critical', severity: 'critical' })],
    });

    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      findings: [],
    });

    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('improved');
  });

  it('should detect degradation when critical findings are added', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      findings: [],
    });

    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      findings: [makeFinding({ id: 'f-critical', severity: 'critical' })],
    });

    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('degraded');
  });

  it('should detect unchanged when findings are identical', () => {
    const finding = makeFinding({ id: 'same' });
    const reportA = makeReport({ id: 'a', createdAt: '2025-01-10T00:00:00Z', findings: [finding] });
    const reportB = makeReport({ id: 'b', createdAt: '2025-01-12T00:00:00Z', findings: [finding] });

    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('unchanged');
    expect(comparison.addedFindings).toHaveLength(0);
    expect(comparison.removedFindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('TrendAnalyzer — edge cases', () => {
  const analyzer = makeEngine();

  it('should handle comparison with different report types', () => {
    const reportA = makeReport({ id: 'a', type: 'pr-review', createdAt: '2025-01-10T00:00:00Z' });
    const reportB = makeReport({ id: 'b', type: 'codebase-audit', createdAt: '2025-01-12T00:00:00Z' });
    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('unchanged');
  });

  it('should produce stable direction when values are identical', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, overallScore: 90 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, overallScore: 90 } }),
    ];
    const trend = analyzer.trackMetric(reports, 'summary.overallScore');
    expect(trend.direction).toBe('stable');
    expect(trend.changeRate).toBe(0);
  });

  it('should handle first value being 0 for direction computation', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, totalFindings: 0 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, totalFindings: 5 } }),
    ];
    const trend = analyzer.trackMetric(reports, 'summary.totalFindings');
    // When first value is 0 and last > 0, direction should be improving
    expect(trend.direction).toBe('improving');
    expect(trend.changeRate).toBe(0);
  });

  it('should handle first value being 0 and last value being 0', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', summary: { ...makeReport().summary, criticalFindings: 0 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', summary: { ...makeReport().summary, criticalFindings: 0 } }),
    ];
    const trend = analyzer.trackMetric(reports, 'summary.criticalFindings');
    expect(trend.direction).toBe('stable');
  });

  it('should track metrics.complexityDelta', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', metrics: { ...makeReport().metrics, complexityDelta: 5 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', metrics: { ...makeReport().metrics, complexityDelta: 2 } }),
    ];
    const trend = analyzer.trackMetric(reports, 'metrics.complexityDelta');
    expect(trend.values).toEqual([5, 2]);
    expect(trend.direction).toBe('degrading');
  });

  it('should track metrics.coverageDelta', () => {
    const reports = [
      makeReport({ createdAt: '2025-01-10T00:00:00Z', metrics: { ...makeReport().metrics, coverageDelta: 2 } }),
      makeReport({ createdAt: '2025-01-11T00:00:00Z', metrics: { ...makeReport().metrics, coverageDelta: 5 } }),
    ];
    const trend = analyzer.trackMetric(reports, 'metrics.coverageDelta');
    expect(trend.direction).toBe('improving');
  });

  it('should compare reports and detect high severity finding changes', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      findings: [
        makeFinding({ id: 'f-high', severity: 'high' }),
        makeFinding({ id: 'f-low', severity: 'low' }),
      ],
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      findings: [makeFinding({ id: 'f-low', severity: 'low' })],
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    // Removed high finding = improved
    expect(comparison.overallChange).toBe('improved');
  });

  it('should compare reports with overallScore delta', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      summary: { ...makeReport().summary, overallScore: 80 },
      findings: [],
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      summary: { ...makeReport().summary, overallScore: 90 },
      findings: [],
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    // Score improved > 1 = improved
    expect(comparison.overallChange).toBe('improved');
  });

  it('should compare reports with complianceScore delta', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      metrics: { ...makeReport().metrics, complianceScore: 70 },
      findings: [],
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      metrics: { ...makeReport().metrics, complianceScore: 90 },
      findings: [],
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('improved');
  });

  it('should detect degradation with overallScore delta', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      summary: { ...makeReport().summary, overallScore: 90 },
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      summary: { ...makeReport().summary, overallScore: 80 },
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('degraded');
  });

  it('should detect degradation with complianceScore delta', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-10T00:00:00Z',
      metrics: { ...makeReport().metrics, complianceScore: 90 },
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-12T00:00:00Z',
      metrics: { ...makeReport().metrics, complianceScore: 70 },
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    expect(comparison.overallChange).toBe('degraded');
  });

  it('should handle getValueAtPath with null intermediate', () => {
    // scope.projectId exists but then hitting non-object
    const reports = [makeReport({ scope: { type: 'pr', prNumber: null } })];
    const trend = analyzer.trackMetric(reports, 'scope.prNumber.x');
    expect(trend.values).toHaveLength(0);
  });

  it('should compare reports with reversed chronological order', () => {
    const reportA = makeReport({
      id: 'a',
      createdAt: '2025-01-12T00:00:00Z', // newer
      findings: [makeFinding({ id: 'new' })],
    });
    const reportB = makeReport({
      id: 'b',
      createdAt: '2025-01-10T00:00:00Z', // older
      findings: [makeFinding({ id: 'old' })],
    });
    const comparison = analyzer.compareReports(reportA, reportB);
    // Should handle reversed order correctly
    expect(comparison.addedFindings).toHaveLength(1);
    expect(comparison.addedFindings[0].id).toBe('new');
  });
});
