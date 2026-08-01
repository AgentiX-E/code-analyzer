// @ts-nocheck
// @code-analyzer/mcp — Trend Analysis Tool Tests

import { describe, it, expect } from 'vitest';
import type { ReviewComment } from '@code-analyzer/shared';
import {
  generateTrendData,
  computeTrendStatistics,
  identifyRecurringProblems,
  analyzeIssueFrequency,
  generateTrendRecommendations,
  trendReport,
  trendAnalysisTool,
} from '../tools/trend-analysis.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'comment-1',
    path: '/src/test.ts',
    content: 'Test issue',
    existingCode: 'const x = 1;',
    startLine: 10,
    endLine: 15,
    category: 'bug',
    severity: 'medium',
    filtered: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createHistoricalComments(): ReviewComment[] {
  const now = new Date();
  return [
    // File A — recurring bug issues
    makeComment({ id: 'c1', path: '/src/api.ts', category: 'bug', severity: 'high', createdAt: new Date(now.getTime() - 25 * 86400000).toISOString() }),
    makeComment({ id: 'c2', path: '/src/api.ts', category: 'bug', severity: 'medium', createdAt: new Date(now.getTime() - 20 * 86400000).toISOString() }),
    makeComment({ id: 'c3', path: '/src/api.ts', category: 'security', severity: 'critical', createdAt: new Date(now.getTime() - 15 * 86400000).toISOString() }),
    makeComment({ id: 'c4', path: '/src/api.ts', category: 'bug', severity: 'medium', createdAt: new Date(now.getTime() - 10 * 86400000).toISOString() }),

    // File B — recurring performance issues
    makeComment({ id: 'c5', path: '/src/db.ts', category: 'performance', severity: 'medium', createdAt: new Date(now.getTime() - 22 * 86400000).toISOString() }),
    makeComment({ id: 'c6', path: '/src/db.ts', category: 'performance', severity: 'high', createdAt: new Date(now.getTime() - 18 * 86400000).toISOString() }),
    makeComment({ id: 'c7', path: '/src/db.ts', category: 'performance', severity: 'medium', createdAt: new Date(now.getTime() - 8 * 86400000).toISOString() }),

    // File C — single issue (not recurring)
    makeComment({ id: 'c8', path: '/src/utils.ts', category: 'style', severity: 'low', createdAt: new Date(now.getTime() - 12 * 86400000).toISOString() }),

    // Recent issues
    makeComment({ id: 'c9', path: '/src/auth.ts', category: 'security', severity: 'high', createdAt: new Date(now.getTime() - 3 * 86400000).toISOString() }),
    makeComment({ id: 'c10', path: '/src/auth.ts', category: 'bug', severity: 'medium', createdAt: new Date(now.getTime() - 2 * 86400000).toISOString() }),
    makeComment({ id: 'c11', path: '/src/db.ts', category: 'maintainability', severity: 'low', createdAt: new Date(now.getTime() - 1 * 86400000).toISOString() }),
  ];
}

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('trendAnalysisTool definition', () => {
  it('should have the correct tool name', () => {
    expect(trendAnalysisTool.name).toBe('trend_analysis');
  });

  it('should have a non-empty description', () => {
    expect(trendAnalysisTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(trendAnalysisTool.inputSchema.type).toBe('object');
    expect(trendAnalysisTool.inputSchema.properties).toBeDefined();
    expect(trendAnalysisTool.inputSchema.required).toContain('projectId');
    expect(trendAnalysisTool.inputSchema.required).toContain('metric');
  });

  it('should have metric enum values', () => {
    const metricProp = trendAnalysisTool.inputSchema.properties.metric;
    expect(metricProp.enum).toContain('complexity');
    expect(metricProp.enum).toContain('churn');
    expect(metricProp.enum).toContain('findings');
    expect(metricProp.enum).toContain('coverage');
  });

  it('should have timespan enum values', () => {
    const timespanProp = trendAnalysisTool.inputSchema.properties.timespan;
    expect(timespanProp.enum).toContain('7d');
    expect(timespanProp.enum).toContain('30d');
    expect(timespanProp.enum).toContain('90d');
    expect(timespanProp.enum).toContain('1y');
  });

  it('should have a callable handler', () => {
    expect(typeof trendAnalysisTool.handler).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('trendAnalysisTool handler', () => {
  it('should generate trend data for complexity metric', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'complexity',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Trend Analysis');
    expect(result.metadata.dataPoints).toBeGreaterThan(0);
  });

  it('should generate trend data for churn metric', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'churn',
      timespan: '7d',
    });
    expect(result.metadata.timespan).toBe('7d');
    expect(result.metadata.dataPoints).toBe(8); // 7 days + today = 8 points
  });

  it('should generate trend data for findings metric', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'findings',
    });
    expect(result.content[0].text).toContain('review findings');
  });

  it('should generate trend data for coverage metric', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'coverage',
      timespan: '90d',
    });
    expect(result.content[0].text).toContain('coverage');
    expect(result.metadata.dataPoints).toBe(91);
  });

  it('should handle 1y timespan', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'complexity',
      timespan: '1y',
    });
    expect(result.metadata.dataPoints).toBe(366);
  });

  it('should use default timespan when not provided', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'complexity',
    });
    expect(result.metadata.timespan).toBe('30d');
    expect(result.metadata.dataPoints).toBe(31); // default 30d = 31 points
  });

  it('should handle review history input', async () => {
    const comments = createHistoricalComments();
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'findings',
      reviewHistory: JSON.stringify(comments),
    });
    expect(result.isError).toBeUndefined();
    expect(result.metadata.recurringProblemCount).toBeGreaterThan(0);
    expect(result.metadata.issueFrequencyPeriods).toBeGreaterThan(0);
  });

  it('should handle invalid review history gracefully', async () => {
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'findings',
      reviewHistory: 'invalid json',
    });
    // Should not error — invalid JSON is handled gracefully
    expect(result.isError).toBeUndefined();
  });

  it('should handle review history as object', async () => {
    const comments = [makeComment()];
    const result = await trendAnalysisTool.handler({
      projectId: 'test-project',
      metric: 'findings',
      reviewHistory: comments,
    });
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateTrendData
// ---------------------------------------------------------------------------

describe('generateTrendData', () => {
  it('should generate correct number of data points for 7d', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    expect(points).toHaveLength(8); // 7 days + today
  });

  it('should generate correct number of data points for 30d', () => {
    const points = generateTrendData('test', 'complexity', '30d');
    expect(points).toHaveLength(31);
  });

  it('should generate correct number of data points for 90d', () => {
    const points = generateTrendData('test', 'complexity', '90d');
    expect(points).toHaveLength(91);
  });

  it('should generate correct number of data points for 1y', () => {
    const points = generateTrendData('test', 'complexity', '1y');
    expect(points).toHaveLength(366);
  });

  it('should have ISO date format', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    for (const point of points) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('should have non-negative values', () => {
    const points = generateTrendData('test', 'findings', '30d');
    for (const point of points) {
      expect(point.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should have dates in chronological order', () => {
    const points = generateTrendData('test', 'complexity', '30d');
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.date >= points[i - 1]!.date).toBe(true);
    }
  });

  it('should handle unknown metric with defaults', () => {
    const points = generateTrendData('test', 'unknown_metric', '7d');
    expect(points).toHaveLength(8);
    expect(points[0]!.value).toBeGreaterThanOrEqual(0);
  });

  it('should handle unknown timespan with 365 default', () => {
    const points = generateTrendData('test', 'complexity', 'unknown');
    expect(points).toHaveLength(366);
  });
});

// ---------------------------------------------------------------------------
// computeTrendStatistics
// ---------------------------------------------------------------------------

describe('computeTrendStatistics', () => {
  it('should handle empty points', () => {
    const stats = computeTrendStatistics([], 'complexity');
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.stdDev).toBe(0);
    expect(stats.changePercent).toBe(0);
    expect(stats.trendDirection).toBe('stable');
  });

  it('should compute statistics for complexity (increasing = improving)', () => {
    const points = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 110 },
      { date: '2024-01-03', value: 120 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(120);
    expect(stats.changePercent).toBe(20);
    expect(stats.trendDirection).toBe('improving');
  });

  it('should compute statistics for findings (decreasing = improving)', () => {
    const points = [
      { date: '2024-01-01', value: 50 },
      { date: '2024-01-02', value: 40 },
      { date: '2024-01-03', value: 30 },
    ];
    const stats = computeTrendStatistics(points, 'findings');
    expect(stats.changePercent).toBe(-40);
    expect(stats.trendDirection).toBe('improving');
  });

  it('should detect declining trend for findings (increasing)', () => {
    const points = [
      { date: '2024-01-01', value: 30 },
      { date: '2024-01-02', value: 40 },
      { date: '2024-01-03', value: 50 },
    ];
    const stats = computeTrendStatistics(points, 'findings');
    expect(stats.trendDirection).toBe('declining');
  });

  it('should detect stable trend for small changes', () => {
    const points = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 102 },
      { date: '2024-01-03', value: 101 },
    ];
    const stats = computeTrendStatistics(points, 'coverage');
    expect(stats.trendDirection).toBe('stable');
  });

  it('should compute median correctly for odd count', () => {
    const points = [
      { date: '2024-01-01', value: 10 },
      { date: '2024-01-02', value: 30 },
      { date: '2024-01-03', value: 20 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.median).toBe(20);
  });

  it('should compute median correctly for even count', () => {
    const points = [
      { date: '2024-01-01', value: 10 },
      { date: '2024-01-02', value: 30 },
      { date: '2024-01-03', value: 20 },
      { date: '2024-01-04', value: 40 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.median).toBe(25);
  });

  it('should compute standard deviation', () => {
    const points = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 100 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.stdDev).toBe(0);
  });

  it('should handle zero first value', () => {
    const points = [
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-02', value: 10 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.changePercent).toBe(100);
  });

  it('should handle zero first value and zero last value', () => {
    const points = [
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-02', value: 0 },
    ];
    const stats = computeTrendStatistics(points, 'complexity');
    expect(stats.changePercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// identifyRecurringProblems
// ---------------------------------------------------------------------------

describe('identifyRecurringProblems', () => {
  it('should return empty for no comments', () => {
    expect(identifyRecurringProblems([])).toEqual([]);
  });

  it('should return empty for single comment', () => {
    expect(identifyRecurringProblems([makeComment()])).toEqual([]);
  });

  it('should identify recurring problems in same file', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/api.ts', category: 'bug' }),
      makeComment({ id: 'c2', path: '/src/api.ts', category: 'bug' }),
    ];
    const problems = identifyRecurringProblems(comments);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.filePath).toBe('/src/api.ts');
    expect(problems[0]!.frequency).toBe(2);
    expect(problems[0]!.category).toBe('bug');
  });

  it('should find most common category in recurring issues', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/api.ts', category: 'bug' }),
      makeComment({ id: 'c2', path: '/src/api.ts', category: 'bug' }),
      makeComment({ id: 'c3', path: '/src/api.ts', category: 'style' }),
    ];
    const problems = identifyRecurringProblems(comments);
    expect(problems[0]!.category).toBe('bug');
  });

  it('should find worst severity', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/api.ts', severity: 'low' }),
      makeComment({ id: 'c2', path: '/src/api.ts', severity: 'critical' }),
      makeComment({ id: 'c3', path: '/src/api.ts', severity: 'medium' }),
    ];
    const problems = identifyRecurringProblems(comments);
    expect(problems[0]!.severity).toBe('critical');
  });

  it('should sort by frequency then severity', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/a.ts', severity: 'low' }),
      makeComment({ id: 'c2', path: '/src/a.ts', severity: 'low' }),
      makeComment({ id: 'c3', path: '/src/b.ts', severity: 'critical' }),
      makeComment({ id: 'c4', path: '/src/b.ts', severity: 'critical' }),
      makeComment({ id: 'c5', path: '/src/c.ts', severity: 'low' }),
      makeComment({ id: 'c6', path: '/src/c.ts', severity: 'low' }),
      makeComment({ id: 'c7', path: '/src/c.ts', severity: 'low' }),
    ];
    const problems = identifyRecurringProblems(comments);
    // c.ts has 3 issues, should be first
    expect(problems[0]!.filePath).toBe('/src/c.ts');
    expect(problems[0]!.frequency).toBe(3);
  });

  it('should include occurrence dates', () => {
    const now = new Date();
    const comments = [
      makeComment({ id: 'c1', path: '/src/a.ts', createdAt: new Date(now.getTime() - 10 * 86400000).toISOString() }),
      makeComment({ id: 'c2', path: '/src/a.ts', createdAt: new Date(now.getTime() - 5 * 86400000).toISOString() }),
    ];
    const problems = identifyRecurringProblems(comments);
    expect(problems[0]!.firstOccurrence).toBeDefined();
    expect(problems[0]!.lastOccurrence).toBeDefined();
  });

  it('should limit to top 10', () => {
    const comments: ReviewComment[] = [];
    for (let i = 0; i < 20; i++) {
      comments.push(
        makeComment({ id: `c${i}`, path: `/src/file${i}.ts` }),
        makeComment({ id: `c${i}b`, path: `/src/file${i}.ts` }),
      );
    }
    const problems = identifyRecurringProblems(comments);
    expect(problems.length).toBeLessThanOrEqual(10);
  });

  it('should handle missing createdAt dates', () => {
    const comments = [
      makeComment({ id: 'c1', path: '/src/a.ts', createdAt: '' }),
      makeComment({ id: 'c2', path: '/src/a.ts', createdAt: '' }),
    ];
    const problems = identifyRecurringProblems(comments);
    expect(problems[0]!.firstOccurrence).toBe('unknown');
    expect(problems[0]!.lastOccurrence).toBe('unknown');
  });

  it('should use full historical dataset', () => {
    const comments = createHistoricalComments();
    const problems = identifyRecurringProblems(comments);
    // /src/api.ts has 4 issues, /src/db.ts has 4 issues, /src/auth.ts has 2 issues
    // /src/utils.ts has only 1 issue (not recurring)
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// analyzeIssueFrequency
// ---------------------------------------------------------------------------

describe('analyzeIssueFrequency', () => {
  it('should return empty for no comments', () => {
    expect(analyzeIssueFrequency([], '30d')).toEqual([]);
  });

  it('should create time buckets', () => {
    const comments = createHistoricalComments();
    const frequency = analyzeIssueFrequency(comments, '30d');
    expect(frequency.length).toBeGreaterThan(0);
    for (const period of frequency) {
      expect(period.period).toBeDefined();
      expect(typeof period.totalIssues).toBe('number');
      expect(period.byCategory).toBeDefined();
      expect(period.bySeverity).toBeDefined();
    }
  });

  it('should have correct total across buckets', () => {
    const comments = createHistoricalComments();
    const frequency = analyzeIssueFrequency(comments, '30d');
    const totalAcrossBuckets = frequency.reduce((sum, p) => sum + p.totalIssues, 0);
    // All 11 comments from createHistoricalComments are within 30 days
    expect(totalAcrossBuckets).toBe(11);
  });

  it('should handle different timespans', () => {
    const comments = createHistoricalComments();
    const freq7d = analyzeIssueFrequency(comments, '7d');
    const freq90d = analyzeIssueFrequency(comments, '90d');
    expect(freq7d.length).toBeGreaterThan(0);
    expect(freq90d.length).toBeGreaterThan(0);
  });

  it('should exclude comments outside timespan', () => {
    const now = new Date();
    const oldComment = makeComment({
      id: 'old',
      createdAt: new Date(now.getTime() - 40 * 86400000).toISOString(),
    });
    const recentComment = makeComment({
      id: 'recent',
      createdAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
    });
    const frequency = analyzeIssueFrequency([oldComment, recentComment], '30d');
    const total = frequency.reduce((sum, p) => sum + p.totalIssues, 0);
    // Old comment (40 days ago) should be excluded for 30d timespan
    expect(total).toBe(1);
  });

  it('should handle comments without createdAt', () => {
    const comment = makeComment({ createdAt: '' });
    const frequency = analyzeIssueFrequency([comment], '30d');
    const total = frequency.reduce((sum, p) => sum + p.totalIssues, 0);
    expect(total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generateTrendRecommendations
// ---------------------------------------------------------------------------

describe('generateTrendRecommendations', () => {
  const improvingStats = {
    min: 90, max: 110, mean: 100, median: 100, stdDev: 5,
    changePercent: 15, trendDirection: 'improving' as const,
  };
  const decliningStats = {
    min: 70, max: 100, mean: 85, median: 85, stdDev: 10,
    changePercent: -25, trendDirection: 'declining' as const,
  };
  const stableStats = {
    min: 98, max: 102, mean: 100, median: 100, stdDev: 1,
    changePercent: 2, trendDirection: 'stable' as const,
  };

  it('should generate recommendations for improving trend', () => {
    const recs = generateTrendRecommendations(improvingStats, [], [], 'complexity');
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.some((r) => r.includes('improving'))).toBe(true);
  });

  it('should generate recommendations for declining trend', () => {
    const recs = generateTrendRecommendations(decliningStats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('decline'))).toBe(true);
  });

  it('should generate recommendations for stable trend', () => {
    const recs = generateTrendRecommendations(stableStats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('stable'))).toBe(true);
  });

  it('should flag significant decline', () => {
    const recs = generateTrendRecommendations(decliningStats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('Significant decline'))).toBe(true);
  });

  it('should include recurring problem recommendations', () => {
    const problems = [
      {
        filePath: '/src/api.ts', category: 'bug', frequency: 5,
        severity: 'high', description: 'test',
        firstOccurrence: '2024-01-01', lastOccurrence: '2024-06-01',
      },
    ];
    const recs = generateTrendRecommendations(stableStats, problems, [], 'complexity');
    expect(recs.some((r) => r.includes('/src/api.ts'))).toBe(true);
  });

  it('should flag many recurring problems', () => {
    const problems = Array.from({ length: 5 }, (_, i) => ({
      filePath: `/src/file${i}.ts`,
      category: 'bug',
      frequency: 3,
      severity: 'medium' as const,
      description: 'test',
      firstOccurrence: '2024-01-01',
      lastOccurrence: '2024-06-01',
    }));
    const recs = generateTrendRecommendations(stableStats, problems, [], 'complexity');
    expect(recs.some((r) => r.includes('systemic'))).toBe(true);
  });

  it('should detect sharp increase in issue frequency', () => {
    const frequency = [
      { period: 'P1', totalIssues: 2, byCategory: {}, bySeverity: {} },
      { period: 'P2', totalIssues: 10, byCategory: {}, bySeverity: {} },
    ];
    const recs = generateTrendRecommendations(stableStats, [], frequency, 'complexity');
    expect(recs.some((r) => r.includes('increased sharply'))).toBe(true);
  });

  it('should detect consistent increasing trend', () => {
    const frequency = [
      { period: 'P1', totalIssues: 1, byCategory: {}, bySeverity: {} },
      { period: 'P2', totalIssues: 3, byCategory: {}, bySeverity: {} },
      { period: 'P3', totalIssues: 5, byCategory: {}, bySeverity: {} },
    ];
    const recs = generateTrendRecommendations(stableStats, [], frequency, 'complexity');
    expect(recs.some((r) => r.includes('consistently increasing'))).toBe(true);
  });

  it('should generate metric-specific recommendations for findings', () => {
    const stats = { ...improvingStats, changePercent: 15 };
    const recs = generateTrendRecommendations(stats, [], [], 'findings');
    expect(recs.some((r) => r.includes('CI pipeline'))).toBe(true);
  });

  it('should generate metric-specific recommendations for coverage', () => {
    const stats = { ...decliningStats, changePercent: -10 };
    const recs = generateTrendRecommendations(stats, [], [], 'coverage');
    expect(recs.some((r) => r.includes('coverage'))).toBe(true);
  });

  it('should generate metric-specific recommendations for churn', () => {
    const stats = { ...stableStats, stdDev: 20 };
    const recs = generateTrendRecommendations(stats, [], [], 'churn');
    expect(recs.some((r) => r.includes('churn'))).toBe(true);
  });

  it('should generate metric-specific recommendations for complexity', () => {
    const stats = { ...improvingStats, changePercent: 15 };
    const recs = generateTrendRecommendations(stats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('Complexity'))).toBe(true);
  });

  // --- Additional branch coverage ---
  it('should handle findings metric with changePercent > 10', () => {
    const stats = { ...decliningStats, changePercent: 15 };
    const recs = generateTrendRecommendations(stats, [], [], 'findings');
    expect(recs.some((r) => r.includes('CI pipeline'))).toBe(true);
  });

  it('should handle findings metric with changePercent <= 10', () => {
    const stats = { ...decliningStats, changePercent: 5 };
    const recs = generateTrendRecommendations(stats, [], [], 'findings');
    expect(recs.some((r) => r.includes('CI pipeline'))).toBe(false);
  });

  it('should handle coverage metric with changePercent < -5', () => {
    const stats = { ...decliningStats, changePercent: -10 };
    const recs = generateTrendRecommendations(stats, [], [], 'coverage');
    expect(recs.some((r) => r.includes('coverage'))).toBe(true);
  });

  it('should handle churn metric with stdDev > 15', () => {
    const stats = { ...stableStats, stdDev: 20 };
    const recs = generateTrendRecommendations(stats, [], [], 'churn');
    expect(recs.some((r) => r.includes('churn'))).toBe(true);
  });

  it('should handle churn metric with stdDev <= 15', () => {
    const stats = { ...stableStats, stdDev: 10 };
    const recs = generateTrendRecommendations(stats, [], [], 'churn');
    expect(recs.some((r) => r.includes('churn'))).toBe(false);
  });

  it('should handle complexity metric with changePercent > 10', () => {
    const stats = { ...improvingStats, changePercent: 15 };
    const recs = generateTrendRecommendations(stats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('Complexity is increasing'))).toBe(true);
  });

  it('should handle complexity metric with changePercent <= 10', () => {
    const stats = { ...improvingStats, changePercent: 5 };
    const recs = generateTrendRecommendations(stats, [], [], 'complexity');
    expect(recs.some((r) => r.includes('Complexity is increasing'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// trendReport
// ---------------------------------------------------------------------------

describe('trendReport', () => {
  it('should handle empty trends', () => {
    expect(trendReport([], 'complexity', '30d')).toContain('No trend data');
  });

  it('should generate report with statistics', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const report = trendReport(points, 'complexity', '7d');
    expect(report).toContain('Trend Analysis');
    expect(report).toContain('### Statistics');
    expect(report).toContain('### Recent Data Points');
  });

  it('should include recurring problems when provided', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const problems = [
      {
        filePath: '/src/bug.ts', category: 'bug', frequency: 5,
        severity: 'high', description: 'test',
        firstOccurrence: '2024-01-01', lastOccurrence: '2024-06-01',
      },
    ];
    const report = trendReport(points, 'complexity', '7d', undefined, problems);
    expect(report).toContain('### Recurring Problem Areas');
    expect(report).toContain('/src/bug.ts');
  });

  it('should include issue frequency when provided', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const frequency = [
      { period: '2024-01-01 to 2024-01-07', totalIssues: 5, byCategory: {}, bySeverity: {} },
    ];
    const report = trendReport(points, 'complexity', '7d', undefined, undefined, frequency);
    expect(report).toContain('### Issue Frequency Over Time');
    expect(report).toContain('2024-01-01');
  });

  it('should include recommendations when provided', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const report = trendReport(points, 'complexity', '7d', undefined, undefined, undefined, ['Fix all the things']);
    expect(report).toContain('### Recommendations');
    expect(report).toContain('Fix all the things');
  });

  it('should include footer', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const report = trendReport(points, 'complexity', '7d');
    expect(report).toContain('Generated by Code Analyzer');
  });

  it('should show metric-specific labels', () => {
    const points = generateTrendData('test', 'churn', '7d');
    const report = trendReport(points, 'churn', '7d');
    expect(report).toContain('files changed/week');
  });

  // --- Metric label coverage ---
  it('should show complexity label', () => {
    const points = generateTrendData('test', 'complexity', '7d');
    const report = trendReport(points, 'complexity', '7d');
    expect(report).toContain('total complexity score');
  });

  it('should show findings label', () => {
    const points = generateTrendData('test', 'findings', '7d');
    const report = trendReport(points, 'findings', '7d');
    expect(report).toContain('review findings count');
  });

  it('should show coverage label', () => {
    const points = generateTrendData('test', 'coverage', '7d');
    const report = trendReport(points, 'coverage', '7d');
    expect(report).toContain('coverage percentage');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle all metric types in generateTrendData', () => {
    for (const metric of ['complexity', 'churn', 'findings', 'coverage']) {
      const points = generateTrendData('test', metric, '7d');
      expect(points.length).toBeGreaterThan(0);
      expect(points[0]!.value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle large review history', () => {
    const comments = Array.from({ length: 1000 }, (_, i) =>
      makeComment({
        id: `c${i}`,
        path: `/src/file${i % 50}.ts`,
        category: ['bug', 'security', 'style'][i % 3] as ReviewComment['category'],
        severity: ['critical', 'high', 'medium', 'low'][i % 4] as ReviewComment['severity'],
        createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      }),
    );
    const problems = identifyRecurringProblems(comments);
    expect(problems.length).toBeLessThanOrEqual(10);

    const frequency = analyzeIssueFrequency(comments, '365d');
    expect(frequency.length).toBeGreaterThan(0);
  });

  it('should handle comments with future dates', () => {
    const futureComment = makeComment({
      createdAt: new Date(Date.now() + 10 * 86400000).toISOString(),
    });
    const frequency = analyzeIssueFrequency([futureComment], '30d');
    // Future dates should be excluded (daysAgo < 0)
    const total = frequency.reduce((sum, p) => sum + p.totalIssues, 0);
    expect(total).toBe(0);
  });
});
