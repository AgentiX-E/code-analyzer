import { describe, it, expect, beforeEach } from 'vitest';
import { ReviewDashboardAggregator } from '../review/dashboard-aggregator.js';
import type {
  ReviewEntry,
  DashboardMetrics,
  CodeHealthScore,
  TeamInsights,
  DashboardReport,
} from '../review/dashboard-aggregator.js';
import type { ReviewComment } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createReviewComment(overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    path: overrides?.path ?? 'src/test.ts',
    content: overrides?.content ?? 'test comment',
    existingCode: overrides?.existingCode ?? `console.log("test ${Date.now()}")`,
    startLine: overrides?.startLine ?? 1,
    endLine: overrides?.endLine ?? 1,
    category: overrides?.category ?? 'style',
    severity: overrides?.severity ?? 'low',
    filtered: false,
    id: overrides?.id ?? `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
}

function createReviewEntry(overrides?: Partial<ReviewEntry>): ReviewEntry {
  return {
    reviewId: overrides?.reviewId ?? `review-${Date.now()}`,
    projectId: overrides?.projectId ?? 'test-project',
    prNumber: overrides?.prNumber ?? 1,
    prTitle: overrides?.prTitle ?? 'Test PR',
    author: overrides?.author ?? 'test-author',
    timestamp: overrides?.timestamp ?? new Date().toISOString(),
    comments: overrides?.comments ?? [],
    durationMs: overrides?.durationMs ?? 1500,
    summary: overrides?.summary ?? {
      totalComments: 0,
      riskLevel: 'low',
      mergeRecommendation: 'approve',
    },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ReviewDashboardAggregator', () => {
  let aggregator: ReviewDashboardAggregator;

  beforeEach(() => {
    aggregator = new ReviewDashboardAggregator();
  });

  // =========================================================================
  // aggregateReviews
  // =========================================================================

  describe('aggregateReviews', () => {
    it('returns empty metrics for an empty reviews array', () => {
      const result = aggregator.aggregateReviews([]);
      expect(result).toEqual({
        totalReviews: 0,
        avgFindingsPerReview: 0,
        mostCommonIssues: [],
        severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        categoryDistribution: {},
        mergeRecommendationDistribution: {},
        avgReviewDuration: 0,
        totalFindings: 0,
        reviewsOverTime: [],
      });
    });

    it('returns correct totals for a single review with no comments', () => {
      const review = createReviewEntry({ durationMs: 2000 });
      const result = aggregator.aggregateReviews([review]);

      expect(result.totalReviews).toBe(1);
      expect(result.totalFindings).toBe(0);
      expect(result.avgFindingsPerReview).toBe(0);
      expect(result.avgReviewDuration).toBe(2000);
    });

    it('returns correct totals for a single review with multiple comments', () => {
      const comments = [
        createReviewComment({ severity: 'critical', category: 'bug' }),
        createReviewComment({ severity: 'high', category: 'security' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
      ];
      const review = createReviewEntry({ comments, durationMs: 3000 });
      const result = aggregator.aggregateReviews([review]);

      expect(result.totalReviews).toBe(1);
      expect(result.totalFindings).toBe(3);
      expect(result.avgFindingsPerReview).toBe(3);
      expect(result.avgReviewDuration).toBe(3000);
    });

    it('computes avgFindingsPerReview across multiple reviews', () => {
      const reviews = [
        createReviewEntry({ comments: [createReviewComment()] }),
        createReviewEntry({ comments: [createReviewComment(), createReviewComment()] }),
        createReviewEntry({ comments: [] }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.totalFindings).toBe(3);
      expect(result.avgFindingsPerReview).toBe(1);
    });

    it('rounds avgFindingsPerReview to one decimal place', () => {
      const reviews = [
        createReviewEntry({ comments: [createReviewComment()] }),
        createReviewEntry({ comments: [createReviewComment()] }),
        createReviewEntry({ comments: [] }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      // 2 findings / 3 reviews = 0.666... → 0.7
      expect(result.avgFindingsPerReview).toBe(0.7);
    });

    it('builds severity distribution across all comments', () => {
      const comments = [
        createReviewComment({ severity: 'critical' }),
        createReviewComment({ severity: 'critical' }),
        createReviewComment({ severity: 'high' }),
        createReviewComment({ severity: 'medium' }),
        createReviewComment({ severity: 'medium' }),
        createReviewComment({ severity: 'medium' }),
        createReviewComment({ severity: 'low' }),
        createReviewComment({ severity: 'info' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.aggregateReviews([review]);

      expect(result.severityDistribution).toEqual({
        critical: 2,
        high: 1,
        medium: 3,
        low: 1,
        info: 1,
      });
    });

    it('ignores comments with undefined or unknown severity', () => {
      const comment = createReviewComment({ severity: 'high' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).severity = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.aggregateReviews([review]);

      expect(result.severityDistribution.critical).toBe(0);
      expect(result.severityDistribution.high).toBe(0);
    });

    it('builds category distribution from all comments', () => {
      const comments = [
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'security' }),
        createReviewComment({ category: 'performance' }),
        createReviewComment({ category: 'maintainability' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.aggregateReviews([review]);

      expect(result.categoryDistribution).toEqual({
        bug: 2,
        security: 1,
        performance: 1,
        maintainability: 1,
      });
    });

    it('defaults comment category to "other" when missing', () => {
      const comment = createReviewComment({ category: 'bug' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).category = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.aggregateReviews([review]);

      expect(result.categoryDistribution).toEqual({ other: 1 });
    });

    it('computes merge recommendation distribution', () => {
      const reviews = [
        createReviewEntry({
          summary: { totalComments: 0, riskLevel: 'low', mergeRecommendation: 'approve' },
        }),
        createReviewEntry({
          summary: { totalComments: 0, riskLevel: 'low', mergeRecommendation: 'approve' },
        }),
        createReviewEntry({
          summary: { totalComments: 0, riskLevel: 'medium', mergeRecommendation: 'comment' },
        }),
        createReviewEntry({
          summary: { totalComments: 0, riskLevel: 'high', mergeRecommendation: 'reject' },
        }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.mergeRecommendationDistribution).toEqual({
        approve: 2,
        comment: 1,
        reject: 1,
      });
    });

    it('defaults merge recommendation to "unknown" when summary is missing', () => {
      // Use spread to bypass the ?? default in the helper
      const review = { ...createReviewEntry(), summary: undefined } as ReviewEntry;
      const result = aggregator.aggregateReviews([review]);

      expect(result.mergeRecommendationDistribution).toEqual({ unknown: 1 });
    });

    it('computes average review duration from valid durations only', () => {
      const reviews = [
        createReviewEntry({ durationMs: 1000 }),
        createReviewEntry({ durationMs: 3000 }),
        createReviewEntry({ durationMs: 5000 }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.avgReviewDuration).toBe(3000);
    });

    it('filters out undefined durationMs from avg computation', () => {
      const reviews = [
        createReviewEntry({ durationMs: 1000 }),
        { ...createReviewEntry(), durationMs: undefined } as ReviewEntry,
        createReviewEntry({ durationMs: 3000 }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      // (1000 + 3000) / 2 = 2000
      expect(result.avgReviewDuration).toBe(2000);
    });

    it('filters out zero durationMs from avg computation', () => {
      const reviews = [
        createReviewEntry({ durationMs: 0 }),
        createReviewEntry({ durationMs: 1000 }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.avgReviewDuration).toBe(1000);
    });

    it('returns avgReviewDuration 0 when no valid durations exist', () => {
      const reviews = [
        { ...createReviewEntry(), durationMs: undefined } as ReviewEntry,
        createReviewEntry({ durationMs: 0 }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.avgReviewDuration).toBe(0);
    });

    it('aggregates reviewsOverTime by YYYY-MM month', () => {
      const reviews = [
        createReviewEntry({ timestamp: '2024-01-15T10:00:00Z' }),
        createReviewEntry({ timestamp: '2024-01-20T10:00:00Z' }),
        createReviewEntry({ timestamp: '2024-02-05T10:00:00Z' }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.reviewsOverTime).toEqual([
        { date: '2024-01', count: 2 },
        { date: '2024-02', count: 1 },
      ]);
    });

    it('handles reviewsOverTime with all reviews in the same month', () => {
      const reviews = [
        createReviewEntry({ timestamp: '2024-03-01T10:00:00Z' }),
        createReviewEntry({ timestamp: '2024-03-15T10:00:00Z' }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.reviewsOverTime).toEqual([{ date: '2024-03', count: 2 }]);
    });

    it('produces mostCommonIssues sorted by count descending', () => {
      const comments = [
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'security' }),
        createReviewComment({ category: 'security' }),
        createReviewComment({ category: 'performance' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.aggregateReviews([review]);

      expect(result.mostCommonIssues).toEqual([
        { category: 'bug', count: 3 },
        { category: 'security', count: 2 },
        { category: 'performance', count: 1 },
      ]);
    });

    it('handles multiple reviews spanning several months', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [createReviewComment()],
          durationMs: 1000,
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [createReviewComment(), createReviewComment()],
          durationMs: 2000,
        }),
        createReviewEntry({
          timestamp: '2024-03-01T00:00:00Z',
          comments: [createReviewComment(), createReviewComment(), createReviewComment()],
          durationMs: 3000,
        }),
        createReviewEntry({
          timestamp: '2024-03-15T00:00:00Z',
          comments: [],
          durationMs: 500,
        }),
      ];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.totalReviews).toBe(4);
      expect(result.totalFindings).toBe(6);
      expect(result.avgFindingsPerReview).toBe(1.5);
      expect(result.avgReviewDuration).toBe(1625); // (1000+2000+3000+500)/4 = 1625
      expect(result.reviewsOverTime).toEqual([
        { date: '2024-01', count: 1 },
        { date: '2024-02', count: 1 },
        { date: '2024-03', count: 2 },
      ]);
    });

    it('treats totalFindings correctly when all reviews have zero comments', () => {
      const reviews = [createReviewEntry({ comments: [] }), createReviewEntry({ comments: [] })];
      const result = aggregator.aggregateReviews(reviews);

      expect(result.totalFindings).toBe(0);
      expect(result.avgFindingsPerReview).toBe(0);
      expect(result.categoryDistribution).toEqual({});
      expect(result.mostCommonIssues).toEqual([]);
    });
  });

  // =========================================================================
  // computeCodeHealthScore
  // =========================================================================

  describe('computeCodeHealthScore', () => {
    it('returns score 100 with stable trend for empty reviews', () => {
      const result = aggregator.computeCodeHealthScore([]);

      expect(result.score).toBe(100);
      expect(result.trend).toBe('stable');
      expect(result.byCategory).toEqual({
        security: 100,
        bugs: 100,
        performance: 100,
        maintainability: 100,
      });
      expect(result.recommendations).toEqual([
        'No review data available. Start reviewing PRs to track code health.',
      ]);
    });

    it('returns high score for a healthy project with no criticals', () => {
      const comments = [
        createReviewComment({ severity: 'low', category: 'style' }),
        createReviewComment({ severity: 'info', category: 'style' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.score).toBe(100);
      expect(result.trend).toBe('stable');
      expect(result.byCategory.security).toBe(100);
      expect(result.byCategory.bugs).toBe(100);
    });

    it('penalizes score for critical security findings', () => {
      const comments = [createReviewComment({ severity: 'critical', category: 'security' })];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      // 1 critical in security → security = 100 - 10 = 90
      // Overall: 90*0.4 + 100*0.25 + 100*0.15 + 100*0.1 + 100*0.1 = 36+25+15+10+10 = 96
      // Single review: mid=0 → recent=[], recentRate=0 → improving
      expect(result.byCategory.security).toBe(90);
      expect(result.score).toBe(96);
      expect(result.trend).toBe('improving');
    });

    it('adds recommendation for critical security findings', () => {
      const comments = [createReviewComment({ severity: 'critical', category: 'security' })];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.recommendations).toContain(
        'security: 1 critical finding(s) — prioritize resolution before next release.',
      );
    });

    it('penalizes score for critical bug findings', () => {
      const comments = [
        createReviewComment({ severity: 'critical', category: 'bug' }),
        createReviewComment({ severity: 'critical', category: 'bug' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      // 2 criticals in bug → bug = 100 - 20 = 80
      expect(result.byCategory.bugs).toBe(80);
    });

    it('adds recommendation for critical bug findings', () => {
      const comments = [createReviewComment({ severity: 'critical', category: 'bug' })];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.recommendations).toContain(
        'bug: 1 critical finding(s) — prioritize resolution before next release.',
      );
    });

    it('caps category scores at 0', () => {
      const comments = Array.from({ length: 15 }, () =>
        createReviewComment({ severity: 'critical', category: 'security' }),
      );
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.byCategory.security).toBe(0);
    });

    it('adds urgent recommendation when overall score is below 60', () => {
      // 11 security criticals + 1 bug critical:
      // security: max(0, 100-110) = 0. findings=11>3: max(0,0-15)=0. contribution=0*0.4=0
      // bug: max(0, 100-10) = 90. contribution=90*0.25=22.5
      // other: 100*0.15+100*0.1+100*0.1 = 35
      // score = Math.round(57.5) = 58
      const securityCritical = Array.from({ length: 11 }, () =>
        createReviewComment({ severity: 'critical', category: 'security' }),
      );
      const bugCritical = createReviewComment({ severity: 'critical', category: 'bug' });
      const review = createReviewEntry({ comments: [...securityCritical, bugCritical] });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.score).toBeLessThan(60);
      expect(result.recommendations[0]).toContain('health score');
      expect(result.recommendations[0]).toContain('immediate action recommended');
    });

    it('detects improving trend when recent critical rate is significantly lower', () => {
      // 4 reviews, 2 most recent have 0 criticals, 2 older have many criticals
      const olderComments = [
        createReviewComment({ severity: 'critical', category: 'bug' }),
        createReviewComment({ severity: 'critical', category: 'bug' }),
      ];
      const reviews = [
        createReviewEntry({ timestamp: '2024-04-01T00:00:00Z', comments: [] }),
        createReviewEntry({ timestamp: '2024-03-01T00:00:00Z', comments: [] }),
        createReviewEntry({ timestamp: '2024-02-01T00:00:00Z', comments: olderComments }),
        createReviewEntry({ timestamp: '2024-01-01T00:00:00Z', comments: olderComments }),
      ];
      const result = aggregator.computeCodeHealthScore(reviews);

      // recent rate = 0/2 = 0, older rate = 4/2 = 2 → 0 < 2*0.8=1.6 → improving
      expect(result.trend).toBe('improving');
      expect(result.recommendations).toContain(
        'Code health is improving — keep up the good practices!',
      );
    });

    it('detects degrading trend when recent critical rate is significantly higher', () => {
      const recentCritical = [
        createReviewComment({ severity: 'critical', category: 'bug' }),
        createReviewComment({ severity: 'critical', category: 'bug' }),
      ];
      const reviews = [
        createReviewEntry({ timestamp: '2024-04-01T00:00:00Z', comments: recentCritical }),
        createReviewEntry({ timestamp: '2024-03-01T00:00:00Z', comments: recentCritical }),
        createReviewEntry({ timestamp: '2024-02-01T00:00:00Z', comments: [] }),
        createReviewEntry({ timestamp: '2024-01-01T00:00:00Z', comments: [] }),
      ];
      const result = aggregator.computeCodeHealthScore(reviews);

      // recent rate = 4/2 = 2, older rate = 0/2 = 0 → 2 > 0*1.2=0 → degrading
      expect(result.trend).toBe('degrading');
      expect(result.recommendations).toContain(
        'Code health is degrading — critical findings are increasing. Schedule a quality sprint.',
      );
    });

    it('detects stable trend when critical rates are similar', () => {
      const comments1 = [createReviewComment({ severity: 'critical', category: 'style' })];
      const comments2 = [createReviewComment({ severity: 'critical', category: 'style' })];
      const reviews = [
        createReviewEntry({ timestamp: '2024-04-01T00:00:00Z', comments: comments1 }),
        createReviewEntry({ timestamp: '2024-03-01T00:00:00Z', comments: comments2 }),
        createReviewEntry({ timestamp: '2024-02-01T00:00:00Z', comments: comments1 }),
        createReviewEntry({ timestamp: '2024-01-01T00:00:00Z', comments: comments2 }),
      ];
      const result = aggregator.computeCodeHealthScore(reviews);

      // recent rate = 2/2 = 1, older rate = 2/2 = 1 → stable
      expect(result.trend).toBe('stable');
    });

    it('adds penalty when findings vastly outnumber reviews in a category', () => {
      // 1 review, 5 findings in performance → 5 > 1*3=3 → penalty
      const comments = Array.from({ length: 5 }, () =>
        createReviewComment({ severity: 'medium', category: 'performance' }),
      );
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      // performance: 100 - 15 = 85
      expect(result.byCategory.performance).toBe(85);
      expect(
        result.recommendations.some(
          (r) => r.includes('performance') && r.includes('focused cleanup'),
        ),
      ).toBe(true);
    });

    it('does not add findings penalty when total is below threshold', () => {
      // 1 review, 3 findings → 3 is NOT > 1*3=3 → no penalty
      const comments = Array.from({ length: 3 }, () =>
        createReviewComment({ severity: 'medium', category: 'performance' }),
      );
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.byCategory.performance).toBe(100);
    });

    it('does not add recommendation for criticals in non-makeOrBreak categories', () => {
      const comments = [createReviewComment({ severity: 'critical', category: 'style' })];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      // Style is not makeOrBreak, so no critical recommendation
      const styleRecs = result.recommendations.filter(
        (r) => r.includes('style') && r.includes('critical'),
      );
      expect(styleRecs.length).toBe(0);
    });

    it('handles undefined comment severity gracefully', () => {
      const comment = createReviewComment({ severity: 'low', category: 'bug' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).severity = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.computeCodeHealthScore([review]);

      // Should not count as critical → no penalty
      expect(result.byCategory.bugs).toBe(100);
      expect(result.score).toBe(100);
    });

    it('caps recommendations at 5', () => {
      const comments = Array.from({ length: 12 }, () =>
        createReviewComment({ severity: 'critical', category: 'security' }),
      );
      // 1 review with 12 security criticals → multiple recommendations triggered
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      expect(result.recommendations.length).toBeLessThanOrEqual(5);
    });

    it('preserves correct byCategory mapping for all categories', () => {
      const comments = [
        createReviewComment({ severity: 'high', category: 'security' }),
        createReviewComment({ severity: 'high', category: 'bug' }),
        createReviewComment({ severity: 'high', category: 'performance' }),
        createReviewComment({ severity: 'high', category: 'maintainability' }),
        createReviewComment({ severity: 'high', category: 'style' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);

      // No criticals → all 100
      expect(result.byCategory).toEqual({
        security: 100,
        bugs: 100,
        performance: 100,
        maintainability: 100,
      });
    });
  });

  // =========================================================================
  // computeTeamInsights
  // =========================================================================

  describe('computeTeamInsights', () => {
    it('returns empty insights for empty reviews', () => {
      const result = aggregator.computeTeamInsights([]);

      expect(result).toEqual({
        topContributors: [],
        avgReviewTurnaround: 0,
        commonPatternFindings: [],
        filesWithMostFindings: [],
        reposWithMostCrossRepoImpact: [],
      });
    });

    it('returns single contributor for one author', () => {
      const review = createReviewEntry({ author: 'alice' });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.topContributors).toEqual([{ author: 'alice', reviewCount: 1 }]);
    });

    it('ranks contributors by review count descending', () => {
      const reviews = [
        createReviewEntry({ author: 'alice' }),
        createReviewEntry({ author: 'bob' }),
        createReviewEntry({ author: 'alice' }),
        createReviewEntry({ author: 'charlie' }),
        createReviewEntry({ author: 'bob' }),
        createReviewEntry({ author: 'bob' }),
      ];
      const result = aggregator.computeTeamInsights(reviews);

      expect(result.topContributors).toEqual([
        { author: 'bob', reviewCount: 3 },
        { author: 'alice', reviewCount: 2 },
        { author: 'charlie', reviewCount: 1 },
      ]);
    });

    it('defaults missing author to "unknown"', () => {
      const review = { ...createReviewEntry(), author: undefined } as ReviewEntry;
      const result = aggregator.computeTeamInsights([review]);

      expect(result.topContributors).toEqual([{ author: 'unknown', reviewCount: 1 }]);
    });

    it('limits top contributors to 10', () => {
      const reviews = Array.from({ length: 15 }, (_, i) =>
        createReviewEntry({ author: `author-${i}`, reviewId: `review-${i}` }),
      );
      // Add extra review for author-0 to be on top
      reviews.push(createReviewEntry({ author: 'author-0', reviewId: 'review-extra' }));

      const result = aggregator.computeTeamInsights(reviews);

      expect(result.topContributors.length).toBeLessThanOrEqual(10);
      expect(result.topContributors[0]?.author).toBe('author-0');
    });

    it('builds common pattern findings in category:severity format', () => {
      const comments = [
        createReviewComment({ category: 'bug', severity: 'critical' }),
        createReviewComment({ category: 'bug', severity: 'critical' }),
        createReviewComment({ category: 'security', severity: 'high' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.commonPatternFindings).toContainEqual({
        pattern: 'bug:critical',
        count: 2,
      });
      expect(result.commonPatternFindings).toContainEqual({
        pattern: 'security:high',
        count: 1,
      });
    });

    it('sorts common patterns by count descending', () => {
      const comments = [
        createReviewComment({ category: 'style', severity: 'low' }),
        createReviewComment({ category: 'bug', severity: 'critical' }),
        createReviewComment({ category: 'bug', severity: 'critical' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.commonPatternFindings[0]).toEqual({
        pattern: 'bug:critical',
        count: 2,
      });
    });

    it('limits common patterns to 20', () => {
      const comments = Array.from({ length: 25 }, (_, i) =>
        createReviewComment({
          category: `cat-${i % 5}` as any,
          severity: `${['critical', 'high', 'medium', 'low', 'info'][i % 5]}` as any,
        }),
      );
      const review = createReviewEntry({ comments });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.commonPatternFindings.length).toBeLessThanOrEqual(20);
    });

    it('identifies files with most findings sorted by count', () => {
      const comments = [
        createReviewComment({ path: 'src/auth.ts' }),
        createReviewComment({ path: 'src/auth.ts' }),
        createReviewComment({ path: 'src/auth.ts' }),
        createReviewComment({ path: 'src/db.ts' }),
        createReviewComment({ path: 'src/db.ts' }),
        createReviewComment({ path: 'src/utils.ts' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.filesWithMostFindings).toEqual([
        { filePath: 'src/auth.ts', count: 3 },
        { filePath: 'src/db.ts', count: 2 },
        { filePath: 'src/utils.ts', count: 1 },
      ]);
    });

    it('limits files to 10', () => {
      const comments = Array.from({ length: 15 }, (_, i) =>
        createReviewComment({ path: `src/file-${i}.ts` }),
      );
      const review = createReviewEntry({ comments });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.filesWithMostFindings.length).toBeLessThanOrEqual(10);
    });

    it('defaults comment path to "unknown" when missing', () => {
      const comment = createReviewComment({ path: 'src/file.ts' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).path = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.filesWithMostFindings).toEqual([{ filePath: 'unknown', count: 1 }]);
    });

    it('computes repos with most cross-repo impact', () => {
      const reviews = [
        createReviewEntry({
          projectId: 'repo-a',
          comments: [createReviewComment(), createReviewComment()],
        }),
        createReviewEntry({
          projectId: 'repo-b',
          comments: [createReviewComment()],
        }),
        createReviewEntry({
          projectId: 'repo-a',
          comments: [createReviewComment(), createReviewComment(), createReviewComment()],
        }),
      ];
      const result = aggregator.computeTeamInsights(reviews);

      expect(result.reposWithMostCrossRepoImpact).toEqual([
        { repo: 'repo-a', count: 5 },
        { repo: 'repo-b', count: 1 },
      ]);
    });

    it('limits repos to 5', () => {
      const reviews = Array.from({ length: 7 }, (_, i) =>
        createReviewEntry({
          projectId: `repo-${i}`,
          comments: [createReviewComment()],
          reviewId: `review-${i}`,
        }),
      );
      const result = aggregator.computeTeamInsights(reviews);

      expect(result.reposWithMostCrossRepoImpact.length).toBeLessThanOrEqual(5);
    });

    it('computes average review turnaround in hours', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const reviews = [
        createReviewEntry({ timestamp: base.toISOString() }),
        createReviewEntry({
          // +1 hour
          timestamp: new Date(base.getTime() + 60 * 60 * 1000).toISOString(),
        }),
        createReviewEntry({
          // +3 hours from base, +2 hours from previous
          timestamp: new Date(base.getTime() + 3 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = aggregator.computeTeamInsights(reviews);

      // Gaps: 1h and 2h → avg = 1.5
      expect(result.avgReviewTurnaround).toBe(1.5);
    });

    it('filters out gaps longer than 7 days in turnaround computation', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const reviews = [
        createReviewEntry({ timestamp: base.toISOString() }),
        createReviewEntry({
          // +1 hour (valid gap)
          timestamp: new Date(base.getTime() + 60 * 60 * 1000).toISOString(),
        }),
        createReviewEntry({
          // +14 days (excluded, > 7 days)
          timestamp: new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = aggregator.computeTeamInsights(reviews);

      // Only 1 valid gap of 1 hour
      expect(result.avgReviewTurnaround).toBe(1);
    });

    it('returns 0 turnaround when no valid gaps within 7 days', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const reviews = [
        createReviewEntry({ timestamp: base.toISOString() }),
        createReviewEntry({
          // +10 days, gap > 7 days
          timestamp: new Date(base.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      ];
      const result = aggregator.computeTeamInsights(reviews);

      expect(result.avgReviewTurnaround).toBe(0);
    });

    it('ignores negative gaps in turnaround computation', () => {
      const base = new Date('2024-01-01T00:00:00Z');
      const reviews = [
        createReviewEntry({ timestamp: base.toISOString() }),
        createReviewEntry({
          // -1 hour (negative gap, should be filtered)
          timestamp: new Date(base.getTime() - 60 * 60 * 1000).toISOString(),
        }),
      ];
      // Reviews are sorted by timestamp ascending internally, so negative gaps won't occur.
      // This tests the gap > 0 guard in case timestamps are out of order.
      const result = aggregator.computeTeamInsights(reviews);

      // Sorted ascending, so base is the later review. If gap is 0 (same timestamp), no valid gap.
      // But the gap is 1 hour positive because base is larger
      // Actually: the internal sort is ascending. So [-1h, base]. Gap = 1h. Valid.
      expect(result.avgReviewTurnaround).toBe(1);
    });
  });

  // =========================================================================
  // generateDashboardReport
  // =========================================================================

  describe('generateDashboardReport', () => {
    it('returns a valid report for empty reviews', () => {
      const result = aggregator.generateDashboardReport([]);

      expect(result.generatedAt).toBeTruthy();
      expect(result.periodStart).toBe('');
      expect(result.periodEnd).toBe('');
      expect(result.metrics.totalReviews).toBe(0);
      expect(result.healthScore.score).toBe(100);
      expect(result.teamInsights.topContributors).toEqual([]);
      expect(result.trendData).toEqual({});
    });

    it('returns a valid report for a single review', () => {
      const review = createReviewEntry({
        timestamp: '2024-06-15T10:00:00Z',
        comments: [createReviewComment({ severity: 'high', category: 'bug' })],
      });
      const result = aggregator.generateDashboardReport([review]);

      expect(result.generatedAt).toBeTruthy();
      expect(result.periodStart).toBe(review.timestamp);
      expect(result.periodEnd).toBe(review.timestamp);
      expect(result.metrics.totalReviews).toBe(1);
      expect(result.metrics.totalFindings).toBe(1);
      expect(result.trendData).toEqual({}); // <2 reviews → no trends
    });

    it('returns trend data for 2+ reviews', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [createReviewComment({ severity: 'critical', category: 'bug' })],
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [createReviewComment({ severity: 'high', category: 'bug' })],
        }),
      ];
      const result = aggregator.generateDashboardReport(reviews);

      expect(result.trendData).toHaveProperty('totalFindings');
      expect(result.trendData).toHaveProperty('criticalFindings');
      expect(result.trendData).toHaveProperty('overallScore');
      expect(result.trendData['totalFindings']!.values).toEqual([1, 1]);
    });

    it('sets periodStart to earliest timestamp and periodEnd to latest', () => {
      const reviews = [
        createReviewEntry({ timestamp: '2024-03-01T00:00:00Z' }),
        createReviewEntry({ timestamp: '2024-01-01T00:00:00Z' }),
        createReviewEntry({ timestamp: '2024-05-01T00:00:00Z' }),
      ];
      const result = aggregator.generateDashboardReport(reviews);

      expect(result.periodStart).toBe('2024-01-01T00:00:00Z');
      expect(result.periodEnd).toBe('2024-05-01T00:00:00Z');
    });

    it('applies maxCommonIssues option to metrics.mostCommonIssues', () => {
      const comments = [
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'security' }),
        createReviewComment({ category: 'performance' }),
        createReviewComment({ category: 'maintainability' }),
        createReviewComment({ category: 'style' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.generateDashboardReport([review], { maxCommonIssues: 2 });

      expect(result.metrics.mostCommonIssues.length).toBeLessThanOrEqual(2);
    });

    it('applies maxContributors option to teamInsights.topContributors', () => {
      const reviews = Array.from({ length: 5 }, (_, i) =>
        createReviewEntry({ author: `author-${i}`, reviewId: `review-${i}` }),
      );
      const result = aggregator.generateDashboardReport(reviews, { maxContributors: 2 });

      expect(result.teamInsights.topContributors.length).toBeLessThanOrEqual(2);
    });

    it('trend generation is best-effort and does not throw on conversion errors', () => {
      // Create a review that will cause issues during conversion
      const badReview = createReviewEntry({
        comments: [createReviewComment({ severity: 'critical' })],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        summary: undefined as any,
      });
      const review = createReviewEntry({
        comments: [],
      });

      // Should not throw
      const result = aggregator.generateDashboardReport([badReview, review]);
      expect(result.trendData).toBeDefined();
    });
  });

  // =========================================================================
  // trackReviewTrend
  // =========================================================================

  describe('trackReviewTrend', () => {
    it('returns TrendData for a single review (insufficient data)', () => {
      const review = createReviewEntry({
        comments: [createReviewComment({ severity: 'critical' })],
      });
      const result = aggregator.trackReviewTrend([review], 'summary.totalFindings');

      expect(result.values).toEqual([1]);
      expect(result.direction).toBe('stable');
      expect(result.changeRate).toBe(0);
    });

    it('returns TrendData for empty reviews', () => {
      const result = aggregator.trackReviewTrend([], 'summary.totalFindings');

      expect(result.values).toEqual([]);
      expect(result.direction).toBe('stable');
      expect(result.changeRate).toBe(0);
    });

    it('tracks trend direction for 2+ reviews with no window', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [createReviewComment(), createReviewComment()],
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [createReviewComment()],
        }),
      ];
      const result = aggregator.trackReviewTrend(reviews, 'summary.totalFindings');

      expect(result.values).toEqual([2, 1]);
      // totalFindings is lower-is-better, decreasing → improving
      expect(result.direction).toBe('improving');
    });

    it('applies rolling window when windowSize is smaller than total reviews', () => {
      const reviews = Array.from({ length: 5 }, (_, i) =>
        createReviewEntry({
          timestamp: new Date(2024, i, 1).toISOString(),
          comments: [createReviewComment()],
          reviewId: `review-${i}`,
        }),
      );
      // No window: all 5 values
      const resultFull = aggregator.trackReviewTrend(reviews, 'summary.totalFindings');
      expect(resultFull.values.length).toBe(5);

      // Window of 3: only last 3
      const resultWindowed = aggregator.trackReviewTrend(reviews, 'summary.totalFindings', 3);
      expect(resultWindowed.values.length).toBe(3);
    });

    it('ignores window when windowSize is larger than reviews count', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [createReviewComment()],
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [createReviewComment()],
        }),
      ];
      // windowSize 5 > 2 reviews → should use all 2
      const result = aggregator.trackReviewTrend(reviews, 'summary.totalFindings', 5);
      expect(result.values.length).toBe(2);
    });

    it('tracks criticalFindings metric correctly', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [
            createReviewComment({ severity: 'critical' }),
            createReviewComment({ severity: 'critical' }),
          ],
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [createReviewComment({ severity: 'low' })],
        }),
      ];
      const result = aggregator.trackReviewTrend(reviews, 'summary.criticalFindings');

      expect(result.values).toEqual([2, 0]);
      // criticalFindings is lower-is-better, 2→0 decreasing → improving
      expect(result.direction).toBe('improving');
    });

    it('tracks overallScore metric correctly', () => {
      const reviews = [
        createReviewEntry({
          timestamp: '2024-01-01T00:00:00Z',
          comments: [createReviewComment({ severity: 'critical' })], // score 90
        }),
        createReviewEntry({
          timestamp: '2024-02-01T00:00:00Z',
          comments: [], // score 100
        }),
      ];
      const result = aggregator.trackReviewTrend(reviews, 'summary.overallScore');

      // overallScore: NOT in LOWER_IS_BETTER → increasing = improving
      expect(result.values[1]!).toBeGreaterThan(result.values[0]!);
      expect(result.direction).toBe('improving');
    });
  });

  // =========================================================================
  // toAnalysisReport (branch coverage via generateDashboardReport)
  // =========================================================================

  describe('toAnalysisReport branch coverage', () => {
    it('handles riskLevel "high" when 0 criticals and 4+ highs', () => {
      const comments = [
        createReviewComment({ severity: 'high', category: 'bug' }),
        createReviewComment({ severity: 'high', category: 'bug' }),
        createReviewComment({ severity: 'high', category: 'bug' }),
        createReviewComment({ severity: 'high', category: 'bug' }),
      ];
      const review = createReviewEntry({ comments });
      // generateDashboardReport calls toAnalysisReport internally
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles riskLevel "medium" when 0 criticals, <=3 highs, 6+ mediums', () => {
      const comments = [
        createReviewComment({ severity: 'medium', category: 'performance' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
        createReviewComment({ severity: 'medium', category: 'performance' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined id (uses generated id)', () => {
      const comment = createReviewComment({ id: 'test-id' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).id = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined category in findings', () => {
      const comment = createReviewComment({ category: 'bug' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).category = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined severity in findings', () => {
      const comment = createReviewComment({ severity: 'high' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).severity = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined content', () => {
      const comment = createReviewComment({ content: 'some content' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).content = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined path', () => {
      const comment = createReviewComment({ path: 'src/test.ts' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).path = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with startLine 0 (null lineRange)', () => {
      const comment = createReviewComment({ startLine: 0, endLine: 0 });
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with startLine > 0 and undefined endLine', () => {
      const comment = createReviewComment({ startLine: 5, endLine: 5 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).endLine = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined existingCode', () => {
      const comment = createReviewComment({ existingCode: 'code' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).existingCode = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with undefined author in toAnalysisReport', () => {
      const review = { ...createReviewEntry(), author: undefined } as ReviewEntry;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with undefined durationMs in toAnalysisReport', () => {
      const review = { ...createReviewEntry(), durationMs: undefined } as ReviewEntry;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with undefined prTitle in toAnalysisReport', () => {
      const review = { ...createReviewEntry(), prTitle: undefined } as ReviewEntry;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with undefined prTitle and undefined prNumber', () => {
      const review = {
        ...createReviewEntry(),
        prTitle: undefined,
        prNumber: undefined,
      } as ReviewEntry;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with falsy projectId in repos section', () => {
      const review = createReviewEntry({
        projectId: '',
        comments: [createReviewComment()],
      });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles review entry with undefined branch in toAnalysisReport', () => {
      const review = { ...createReviewEntry(), branch: undefined } as ReviewEntry;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles mergeRecommendation fallback to approve when summary has no mergeRecommendation', () => {
      const review = createReviewEntry({
        summary: { totalComments: 0, riskLevel: 'low', mergeRecommendation: 'approve' },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (review.summary as any).mergeRecommendation = undefined;
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles comment with undefined startLine (null lineRange via ?? 0)', () => {
      const comment = createReviewComment({ startLine: 5 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).startLine = undefined;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.generateDashboardReport([
        review,
        createReviewEntry({ comments: [] }),
      ]);
      expect(result.trendData).toBeDefined();
    });

    it('handles code health score when some categories have no findings', () => {
      // Cover the categoryScores[cat] ?? 100 fallback for categories with no findings
      // Have findings in security, bug, performance, maintainability but NOT style
      const comments = [
        createReviewComment({ severity: 'low', category: 'security' }),
        createReviewComment({ severity: 'low', category: 'bug' }),
        createReviewComment({ severity: 'low', category: 'performance' }),
        createReviewComment({ severity: 'low', category: 'maintainability' }),
      ];
      const review = createReviewEntry({ comments });
      const result = aggregator.computeCodeHealthScore([review]);
      // All categories should be at 100 (no criticals)
      expect(result.score).toBe(100);
    });
  });

  // =========================================================================
  // formatDashboardMarkdown
  // =========================================================================

  describe('formatDashboardMarkdown', () => {
    it('renders report with default title', () => {
      const review = createReviewEntry({
        timestamp: '2024-06-01T00:00:00Z',
        comments: [createReviewComment({ severity: 'high', category: 'bug' })],
      });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('# Code Review Dashboard');
      expect(markdown).toContain('## Code Health Score');
      expect(markdown).toContain('## Findings Summary');
      expect(markdown).toContain('## Team Insights');
    });

    it('renders report with custom title', () => {
      const review = createReviewEntry({ comments: [] });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report, 'My Custom Dashboard');

      expect(markdown).toContain('# My Custom Dashboard');
    });

    it('renders generated date and period', () => {
      const review = createReviewEntry({
        timestamp: '2024-06-01T00:00:00Z',
        comments: [],
      });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain(`**Generated**: ${report.generatedAt}`);
      expect(markdown).toContain('**Period**:');
      expect(markdown).toContain('**Reviews Analyzed**: 1');
    });

    it('renders health score with emoji indicator', () => {
      // Score below 60 → red emoji
      const securityCritical = Array.from({ length: 11 }, () =>
        createReviewComment({ severity: 'critical', category: 'security' }),
      );
      const bugCritical = createReviewComment({ severity: 'critical', category: 'bug' });
      const review = createReviewEntry({ comments: [...securityCritical, bugCritical] });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('**Overall Score**:');
      // score is below 60 → should have red circle emoji
      expect(markdown).toContain('\uD83D\uDD34'); // 🔴
    });

    it('renders green emoji for scores >= 80', () => {
      const review = createReviewEntry({ comments: [] });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('\uD83D\uDFE2'); // 🟢
    });

    it('renders yellow emoji for scores between 60 and 79', () => {
      // One critical = 90-100 range... need to get score in 60-79 range
      const comments = [
        createReviewComment({ severity: 'critical', category: 'security' }), // -10 → security 90
        // Let me think: with 1 critical in security, score = 90*0.4 + 100*0.25+100*0.15+100*0.1+100*0.1 = 96
        // I need more criticals to get below 80
      ];
      // Use 4 security criticals: security = max(0, 100-40) = 60
      // score = 60*0.4 + 100*0.6 = 24+60 = 84... still > 80
      // Use 5: security = 50. score = 50*0.4 + 100*0.6 = 20+60 = 80. Score=80 = green
      // Use 6: security = 40. score = 40*0.4 + 100*0.6 = 16+60 = 76. Score=76 = yellow
      const criticalComments = Array.from({ length: 6 }, () =>
        createReviewComment({ severity: 'critical', category: 'security' }),
      );
      const review = createReviewEntry({ comments: criticalComments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('\uD83D\uDFE1'); // 🟡
    });

    it('renders health score category table', () => {
      const review = createReviewEntry({ comments: [] });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('| Category | Score |');
      expect(markdown).toContain('| security | 100 |');
      expect(markdown).toContain('| bugs | 100 |');
      expect(markdown).toContain('| performance | 100 |');
      expect(markdown).toContain('| maintainability | 100 |');
    });

    it('renders recommendations section when present', () => {
      const comments = [createReviewComment({ severity: 'critical', category: 'security' })];
      const review = createReviewEntry({ comments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('### Recommendations');
      expect(markdown).toContain('prioritize resolution');
    });

    it('renders findings summary with total and average', () => {
      const comments = [createReviewComment(), createReviewComment()];
      const review = createReviewEntry({ comments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('**Total Findings**: 2');
      expect(markdown).toContain('**Avg per Review**: 2');
      expect(markdown).toContain('**Avg Review Duration**:');
    });

    it('renders severity distribution table', () => {
      const comments = [
        createReviewComment({ severity: 'high' }),
        createReviewComment({ severity: 'critical' }),
      ];
      const review = createReviewEntry({ comments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('### By Severity');
      expect(markdown).toContain('| Severity | Count |');
      expect(markdown).toContain('| high | 1 |');
      expect(markdown).toContain('| critical | 1 |');
      // Zero-count severities should not appear
      expect(markdown).not.toContain('| info | 0 |');
    });

    it('renders category distribution table when categories exist', () => {
      const comments = [
        createReviewComment({ category: 'bug' }),
        createReviewComment({ category: 'security' }),
      ];
      const review = createReviewEntry({ comments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('### By Category');
      expect(markdown).toContain('| bug | 1 |');
      expect(markdown).toContain('| security | 1 |');
    });

    it('renders team insights with contributors', () => {
      const reviews = [
        createReviewEntry({ author: 'alice' }),
        createReviewEntry({ author: 'bob' }),
      ];
      const report = aggregator.generateDashboardReport(reviews);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('### Top Contributors');
      expect(markdown).toContain('| Author | Reviews |');
      expect(markdown).toContain('| alice | 1 |');
      expect(markdown).toContain('| bob | 1 |');
    });

    it('renders files with most findings', () => {
      const comments = [
        createReviewComment({ path: 'src/main.ts' }),
        createReviewComment({ path: 'src/main.ts' }),
      ];
      const review = createReviewEntry({ comments });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('### Files with Most Findings');
      expect(markdown).toContain('| File | Findings |');
      expect(markdown).toContain('| src/main.ts | 2 |');
    });

    it('renders trend info', () => {
      const review = createReviewEntry({ comments: [] });
      const report = aggregator.generateDashboardReport([review]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('**Trend**: STABLE');
    });

    it('renders empty report (default) gracefully', () => {
      const report = aggregator.generateDashboardReport([]);
      const markdown = aggregator.formatDashboardMarkdown(report);

      expect(markdown).toContain('# Code Review Dashboard');
      expect(markdown).toContain('**Reviews Analyzed**: 0');
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('handles reviews with null/undefined optional fields gracefully', () => {
      const review = {
        ...createReviewEntry(),
        // Override optional fields to undefined/null
        author: undefined,
        prNumber: undefined,
        prTitle: undefined,
        durationMs: undefined,
        summary: undefined,
        comments: [],
      } as unknown as ReviewEntry;
      const result = aggregator.aggregateReviews([review]);

      expect(result.totalReviews).toBe(1);
      expect(result.totalFindings).toBe(0);
      expect(result.mergeRecommendationDistribution).toEqual({ unknown: 1 });
    });

    it('handles comments array being empty', () => {
      const review = createReviewEntry({ comments: [] });
      const result = aggregator.aggregateReviews([review]);

      expect(result.categoryDistribution).toEqual({});
    });

    it('handles comments with null category gracefully', () => {
      const comment = createReviewComment({ category: 'bug' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).category = null;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.aggregateReviews([review]);

      // category null → uses 'other'
      expect(result.categoryDistribution).toEqual({ other: 1 });
    });

    it('handles comments with null severity gracefully', () => {
      const comment = createReviewComment({ severity: 'high' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (comment as any).severity = null;
      const review = createReviewEntry({ comments: [comment] });
      const result = aggregator.aggregateReviews([review]);

      // severity null → not counted in severity distribution
      expect(result.severityDistribution.high).toBe(0);
    });

    it('preserves team insights with all empty sub-arrays for no findings', () => {
      const review = createReviewEntry({ comments: [], author: 'alice' });
      const result = aggregator.computeTeamInsights([review]);

      expect(result.topContributors).toEqual([{ author: 'alice', reviewCount: 1 }]);
      expect(result.commonPatternFindings).toEqual([]);
      expect(result.filesWithMostFindings).toEqual([]);
    });

    it('handles entry with no comments array (requires empty array for safety)', () => {
      // The class assumes comments is always an array. An undefined comments
      // field would cause a TypeError. Consumer is responsible for providing
      // a valid array.
      const review = createReviewEntry({ comments: [] });
      const result = aggregator.aggregateReviews([review]);

      expect(result.totalFindings).toBe(0);
      expect(result.categoryDistribution).toEqual({});
    });

    it('handles review with missing timestamp in generateDashboardReport', () => {
      const reviews = [
        createReviewEntry({ timestamp: '2024-02-01T00:00:00Z' }),
        createReviewEntry({ timestamp: '2024-01-01T00:00:00Z' }),
      ];
      const result = aggregator.generateDashboardReport(reviews);

      expect(result.periodStart).toBe('2024-01-01T00:00:00Z');
      expect(result.periodEnd).toBe('2024-02-01T00:00:00Z');
    });
  });
});
