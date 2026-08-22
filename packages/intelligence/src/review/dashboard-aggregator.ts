// @code-analyzer/intelligence — Review Dashboard Aggregator
// Aggregates metrics across multiple PR reviews for trend analysis,
// code health scoring, team insights, and dashboard report generation.

import type {
  ReviewComment,
  ReviewCategory,
  Severity,
  StandardsCheckResult,
  ImpactResult,
  AnalysisReport,
  ReportSummary,
  ReportScope,
  ReportMetadata,
  ReportMetrics,
  Finding,
  Recommendation,
  RiskLevel,
} from '@code-analyzer/shared';
import { TrendAnalyzer, type TrendData } from '../report/trends.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** Input review data for aggregation. */
export interface ReviewEntry {
  reviewId: string;
  projectId: string;
  prNumber?: number;
  prTitle?: string;
  author?: string;
  branch?: string;
  timestamp: string;
  comments: ReviewComment[];
  standardsResults?: StandardsCheckResult[];
  impactResult?: { riskLevel: string };
  summary?: {
    totalComments: number;
    riskLevel: string;
    mergeRecommendation: string;
  };
  durationMs?: number;
}

/** Aggregated dashboard metrics across all reviews. */
export interface DashboardMetrics {
  totalReviews: number;
  avgFindingsPerReview: number;
  mostCommonIssues: Array<{ category: ReviewCategory; count: number }>;
  severityDistribution: Record<Severity, number>;
  categoryDistribution: Record<string, number>;
  mergeRecommendationDistribution: Record<string, number>;
  avgReviewDuration: number;
  totalFindings: number;
  reviewsOverTime: Array<{ date: string; count: number }>;
}

/** Code health score computed from aggregated review data. */
export interface CodeHealthScore {
  score: number;
  trend: 'improving' | 'stable' | 'degrading';
  byCategory: {
    security: number;
    bugs: number;
    performance: number;
    maintainability: number;
  };
  recommendations: string[];
}

/** Team and contributor insights. */
export interface TeamInsights {
  topContributors: Array<{ author: string; reviewCount: number }>;
  avgReviewTurnaround: number;
  commonPatternFindings: Array<{ pattern: string; count: number }>;
  filesWithMostFindings: Array<{ filePath: string; count: number }>;
  reposWithMostCrossRepoImpact: Array<{ repo: string; count: number }>;
}

/** Complete dashboard report with multiple data sections. */
export interface DashboardReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  metrics: DashboardMetrics;
  healthScore: CodeHealthScore;
  teamInsights: TeamInsights;
  trendData: Record<string, TrendData>;
}

/** Options for dashboard report generation. */
export interface DashboardOptions {
  /** Maximum number of most-common issues to show (default 10). */
  maxCommonIssues?: number;
  /** Maximum number of top contributors (default 10). */
  maxContributors?: number;
  /** Maximum files in "most findings" (default 10). */
  maxFiles?: number;
  /** Title for the dashboard report. */
  title?: string;
}

// ---------------------------------------------------------------------------
// ReviewDashboardAggregator
// ---------------------------------------------------------------------------

export class ReviewDashboardAggregator {
  private trendAnalyzer: TrendAnalyzer;

  constructor() {
    this.trendAnalyzer = new TrendAnalyzer();
  }

  // ---------------------------------------------------------------------------
  // Core Aggregation
  // ---------------------------------------------------------------------------

  /**
   * Aggregate metrics from a collection of PR review entries.
   */
  aggregateReviews(reviews: ReviewEntry[]): DashboardMetrics {
    if (reviews.length === 0) {
      return this.emptyMetrics();
    }

    const totalReviews = reviews.length;
    const totalFindings = reviews.reduce((sum, r) => sum + r.comments.length, 0);

    // Severity distribution
    const severityDist: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const review of reviews) {
      for (const comment of review.comments) {
        if (comment.severity && severityDist[comment.severity] !== undefined) {
          severityDist[comment.severity]++;
        }
      }
    }

    // Category distribution
    const categoryDist: Record<string, number> = {};
    for (const review of reviews) {
      for (const comment of review.comments) {
        const cat = comment.category ?? 'other';
        categoryDist[cat] = (categoryDist[cat] ?? 0) + 1;
      }
    }

    // Most common issues (by category)
    const mostCommon = Object.entries(categoryDist)
      .map(([category, count]) => ({ category: category as ReviewCategory, count }))
      .sort((a, b) => b.count - a.count);

    // Merge recommendation distribution
    const mergeDist: Record<string, number> = {};
    for (const review of reviews) {
      const rec = review.summary?.mergeRecommendation ?? 'unknown';
      mergeDist[rec] = (mergeDist[rec] ?? 0) + 1;
    }

    // Average review duration
    const durations = reviews
      .map((r) => r.durationMs)
      .filter((d): d is number => d !== undefined && d > 0);
    const avgDuration =
      durations.length > 0
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : 0;

    // Reviews over time (monthly aggregation)
    const timeMap = new Map<string, number>();
    for (const review of reviews) {
      const date = review.timestamp.slice(0, 7); // YYYY-MM
      timeMap.set(date, (timeMap.get(date) ?? 0) + 1);
    }
    const reviewsOverTime = [...timeMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return {
      totalReviews,
      /* v8 ignore next -- @preserve */
      avgFindingsPerReview:
        totalReviews > 0 ? Math.round((totalFindings / totalReviews) * 10) / 10 : 0,
      mostCommonIssues: mostCommon,
      severityDistribution: severityDist,
      categoryDistribution: categoryDist,
      mergeRecommendationDistribution: mergeDist,
      avgReviewDuration: avgDuration,
      totalFindings,
      reviewsOverTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Code Health Scoring
  // ---------------------------------------------------------------------------

  /**
   * Compute a code health score based on aggregated review data.
   *
   * Weighting: security (40%), bugs (25%), performance (15%),
   * maintainability (10%), style (10%).
   */
  computeCodeHealthScore(reviews: ReviewEntry[]): CodeHealthScore {
    if (reviews.length === 0) {
      return {
        score: 100,
        trend: 'stable',
        byCategory: { security: 100, bugs: 100, performance: 100, maintainability: 100 },
        recommendations: ['No review data available. Start reviewing PRs to track code health.'],
      };
    }

    // Count findings by category
    const criticalByCategory: Record<string, number> = {};
    const totalByCategory: Record<string, number> = {};

    for (const review of reviews) {
      for (const comment of review.comments) {
        const cat = comment.category ?? 'other';
        totalByCategory[cat] = (totalByCategory[cat] ?? 0) + 1;
        if (comment.severity === 'critical') {
          criticalByCategory[cat] = (criticalByCategory[cat] ?? 0) + 1;
        }
      }
    }

    // Category scores: start at 100, subtract penalties
    const penaltyMap: Record<string, { weight: number; makeOrBreak: boolean }> = {
      security: { weight: 0.4, makeOrBreak: true },
      bug: { weight: 0.25, makeOrBreak: true },
      performance: { weight: 0.15, makeOrBreak: false },
      maintainability: { weight: 0.1, makeOrBreak: false },
      style: { weight: 0.1, makeOrBreak: false },
    };

    const categoryScores: Record<string, number> = {};
    const recommendations: string[] = [];

    for (const [cat, config] of Object.entries(penaltyMap)) {
      const total = totalByCategory[cat] ?? 0;
      const criticals = criticalByCategory[cat] ?? 0;

      // Base: 100, subtract 10 per critical, cap at 0
      let score = Math.max(0, 100 - criticals * 10);
      // Additional penalty if many findings relative to review count
      if (total > reviews.length * 3) {
        score = Math.max(0, score - 15);
        recommendations.push(
          `${cat}: ${total} findings across ${reviews.length} reviews — consider focused cleanup effort.`,
        );
      }
      if (criticals > 0 && config.makeOrBreak) {
        recommendations.push(
          `${cat}: ${criticals} critical finding(s) — prioritize resolution before next release.`,
        );
      }

      categoryScores[cat] = score;
    }

    // Weighted overall score
    let weightedScore = 0;
    let totalWeight = 0;
    for (const [cat, config] of Object.entries(penaltyMap)) {
      /* v8 ignore next -- @preserve */
      weightedScore += (categoryScores[cat] ?? 100) * config.weight;
      totalWeight += config.weight;
    }
    /* v8 ignore next -- @preserve */
    const overallScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 100;

    // Determine trend based on critical findings in recent vs older reviews
    const sorted = [...reviews].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const mid = Math.floor(sorted.length / 2);
    const recent = sorted.slice(0, mid);
    const older = sorted.slice(mid);

    const recentCriticals = recent.reduce(
      (s, r) => s + r.comments.filter((c) => c.severity === 'critical').length,
      0,
    );
    const olderCriticals = older.reduce(
      (s, r) => s + r.comments.filter((c) => c.severity === 'critical').length,
      0,
    );

    // Normalize by review count
    const recentRate = recent.length > 0 ? recentCriticals / recent.length : 0;
    /* v8 ignore next -- @preserve */
    const olderRate = older.length > 0 ? olderCriticals / older.length : 0;

    const trend: 'improving' | 'stable' | 'degrading' =
      recentRate < olderRate * 0.8
        ? 'improving'
        : recentRate > olderRate * 1.2
          ? 'degrading'
          : 'stable';

    if (trend === 'degrading') {
      recommendations.push(
        'Code health is degrading — critical findings are increasing. Schedule a quality sprint.',
      );
    } else if (trend === 'improving') {
      recommendations.push('Code health is improving — keep up the good practices!');
    }

    if (overallScore < 60) {
      recommendations.unshift(
        `Overall code health score is ${overallScore}/100 — immediate action recommended.`,
      );
    }

    return {
      score: overallScore,
      trend,
      byCategory: {
        /* v8 ignore start -- @preserve */
        security: categoryScores['security'] ?? 100,
        bugs: categoryScores['bug'] ?? 100,
        performance: categoryScores['performance'] ?? 100,
        maintainability: categoryScores['maintainability'] ?? 100,
        /* v8 ignore stop -- @preserve */
      },
      recommendations: recommendations.slice(0, 5),
    };
  }

  // ---------------------------------------------------------------------------
  // Team Insights
  // ---------------------------------------------------------------------------

  /**
   * Compute team insights from review data.
   */
  computeTeamInsights(reviews: ReviewEntry[]): TeamInsights {
    if (reviews.length === 0) {
      return {
        topContributors: [],
        avgReviewTurnaround: 0,
        commonPatternFindings: [],
        filesWithMostFindings: [],
        reposWithMostCrossRepoImpact: [],
      };
    }

    // Top contributors by review count
    const authorCounts = new Map<string, number>();
    for (const review of reviews) {
      const author = review.author ?? 'unknown';
      authorCounts.set(author, (authorCounts.get(author) ?? 0) + 1);
    }
    const topContributors = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([author, reviewCount]) => ({ author, reviewCount }));

    // Average review turnaround (from timestamps)
    const sortedReviews = [...reviews].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    let totalGap = 0;
    let gaps = 0;
    for (let i = 1; i < sortedReviews.length; i++) {
      const gap =
        new Date(sortedReviews[i]!.timestamp).getTime() -
        new Date(sortedReviews[i - 1]!.timestamp).getTime();
      if (gap > 0 && gap < 7 * 24 * 60 * 60 * 1000) {
        // Within 7 days
        totalGap += gap;
        gaps++;
      }
    }
    const avgTurnaround =
      gaps > 0
        ? Math.round((totalGap / gaps / (60 * 60 * 1000)) * 10) / 10 // Hours
        : 0;

    // Common pattern findings (group by category:severity pattern)
    const patternCounts = new Map<string, number>();
    for (const review of reviews) {
      for (const comment of review.comments) {
        const pattern = `${comment.category ?? 'other'}:${comment.severity ?? 'info'}`;
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
      }
    }
    const commonPatternFindings = [...patternCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([pattern, count]) => ({ pattern, count }));

    // Files with most findings
    const fileCounts = new Map<string, number>();
    for (const review of reviews) {
      for (const comment of review.comments) {
        const filePath = comment.path ?? 'unknown';
        fileCounts.set(filePath, (fileCounts.get(filePath) ?? 0) + 1);
      }
    }
    const filesWithMostFindings = [...fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([filePath, count]) => ({ filePath, count }));

    // Repos with most cross-repo impact
    const repoCounts = new Map<string, number>();
    for (const review of reviews) {
      if (review.projectId) {
        repoCounts.set(
          review.projectId,
          (repoCounts.get(review.projectId) ?? 0) + review.comments.length,
        );
      }
    }
    const reposWithMostCrossRepoImpact = [...repoCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([repo, count]) => ({ repo, count }));

    return {
      topContributors,
      avgReviewTurnaround: avgTurnaround,
      commonPatternFindings,
      filesWithMostFindings,
      reposWithMostCrossRepoImpact,
    };
  }

  // ---------------------------------------------------------------------------
  // Dashboard Report
  // ---------------------------------------------------------------------------

  /**
   * Generate a complete dashboard report with all metrics, scores, and trends.
   */
  generateDashboardReport(reviews: ReviewEntry[], options?: DashboardOptions): DashboardReport {
    const metrics = this.aggregateReviews(reviews);
    const healthScore = this.computeCodeHealthScore(reviews);
    const teamInsights = this.computeTeamInsights(reviews);

    // Track trends for key metrics
    const trendData: Record<string, TrendData> = {};
    try {
      const reports = reviews.map((r) => this.toAnalysisReport(r));

      if (reports.length >= 2) {
        trendData['totalFindings'] = this.trendAnalyzer.trackMetric(
          reports,
          'summary.totalFindings',
        );
        trendData['criticalFindings'] = this.trendAnalyzer.trackMetric(
          reports,
          'summary.criticalFindings',
        );
        trendData['overallScore'] = this.trendAnalyzer.trackMetric(reports, 'summary.overallScore');
      }
    } catch {
      // Trend analysis is best-effort
    }

    // Apply options
    const maxCommon = options?.maxCommonIssues ?? 10;
    const maxContributors = options?.maxContributors ?? 10;

    return {
      generatedAt: new Date().toISOString(),
      periodStart:
        reviews.length > 0
          ? reviews.reduce(
              (earliest, r) => (r.timestamp < earliest ? r.timestamp : earliest),
              reviews[0]!.timestamp,
            )
          : '',
      periodEnd:
        reviews.length > 0
          ? reviews.reduce(
              (latest, r) => (r.timestamp > latest ? r.timestamp : latest),
              reviews[0]!.timestamp,
            )
          : '',
      metrics: {
        ...metrics,
        mostCommonIssues: metrics.mostCommonIssues.slice(0, maxCommon),
      },
      healthScore,
      teamInsights: {
        ...teamInsights,
        topContributors: teamInsights.topContributors.slice(0, maxContributors),
      },
      trendData,
    };
  }

  /**
   * Track a rolling-window trend for a specific metric.
   */
  trackReviewTrend(reviews: ReviewEntry[], metricPath: string, windowSize?: number): TrendData {
    const reports = reviews.map((r) => this.toAnalysisReport(r));

    if (reports.length < 2) {
      return this.trendAnalyzer.trackMetric(reports, metricPath);
    }

    // Apply rolling window if specified
    let windowed = reports;
    if (windowSize && windowSize < reports.length) {
      windowed = reports.slice(-windowSize);
    }

    return this.trendAnalyzer.trackMetric(windowed, metricPath);
  }

  /**
   * Format the dashboard report as Markdown.
   */
  formatDashboardMarkdown(report: DashboardReport, title?: string): string {
    const lines: string[] = [];
    lines.push(`# ${title ?? 'Code Review Dashboard'}`);
    lines.push('');
    lines.push(`**Generated**: ${report.generatedAt}`);
    lines.push(`**Period**: ${report.periodStart} → ${report.periodEnd}`);
    lines.push(`**Reviews Analyzed**: ${report.metrics.totalReviews}`);
    lines.push('');

    // Health score
    lines.push('## Code Health Score');
    lines.push('');
    const healthEmoji =
      report.healthScore.score >= 80 ? '🟢' : report.healthScore.score >= 60 ? '🟡' : '🔴';
    lines.push(`**Overall Score**: ${healthEmoji} ${report.healthScore.score}/100`);
    lines.push(`**Trend**: ${report.healthScore.trend.toUpperCase()}`);
    lines.push('');
    lines.push('| Category | Score |');
    lines.push('| --- | --- |');
    for (const [cat, score] of Object.entries(report.healthScore.byCategory)) {
      lines.push(`| ${cat} | ${score} |`);
    }
    lines.push('');

    if (report.healthScore.recommendations.length > 0) {
      lines.push('### Recommendations');
      for (const rec of report.healthScore.recommendations) {
        lines.push(`- ${rec}`);
      }
      lines.push('');
    }

    // Metrics
    lines.push('## Findings Summary');
    lines.push('');
    lines.push(`- **Total Findings**: ${report.metrics.totalFindings}`);
    lines.push(`- **Avg per Review**: ${report.metrics.avgFindingsPerReview}`);
    lines.push(`- **Avg Review Duration**: ${report.metrics.avgReviewDuration}ms`);
    lines.push('');

    // Severity distribution
    lines.push('### By Severity');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('| --- | --- |');
    for (const [sev, count] of Object.entries(report.metrics.severityDistribution)) {
      if (count > 0) lines.push(`| ${sev} | ${count} |`);
    }
    lines.push('');

    // Category distribution
    if (Object.keys(report.metrics.categoryDistribution).length > 0) {
      lines.push('### By Category');
      lines.push('');
      lines.push('| Category | Count |');
      lines.push('| --- | --- |');
      for (const [cat, count] of Object.entries(report.metrics.categoryDistribution)) {
        /* v8 ignore next -- @preserve */
        if (count > 0) lines.push(`| ${cat} | ${count} |`);
      }
      lines.push('');
    }

    // Team insights
    lines.push('## Team Insights');
    lines.push('');
    lines.push(`**Avg Turnaround**: ${report.teamInsights.avgReviewTurnaround} hours`);
    lines.push('');

    if (report.teamInsights.topContributors.length > 0) {
      lines.push('### Top Contributors');
      lines.push('');
      lines.push('| Author | Reviews |');
      lines.push('| --- | --- |');
      for (const c of report.teamInsights.topContributors.slice(0, 10)) {
        lines.push(`| ${c.author} | ${c.reviewCount} |`);
      }
      lines.push('');
    }

    if (report.teamInsights.filesWithMostFindings.length > 0) {
      lines.push('### Files with Most Findings');
      lines.push('');
      lines.push('| File | Findings |');
      lines.push('| --- | --- |');
      for (const f of report.teamInsights.filesWithMostFindings.slice(0, 10)) {
        lines.push(`| ${f.filePath} | ${f.count} |`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private toAnalysisReport(r: ReviewEntry): AnalysisReport {
    const criticals = r.comments.filter((c) => c.severity === 'critical').length;
    const highs = r.comments.filter((c) => c.severity === 'high').length;
    const mediums = r.comments.filter((c) => c.severity === 'medium').length;
    const lows = r.comments.filter((c) => c.severity === 'low').length;

    const summary: ReportSummary = {
      overallScore: Math.max(0, 100 - criticals * 10 - highs * 5),
      riskLevel: (criticals > 0
        ? 'critical'
        : highs > 3
          ? 'high'
          : mediums > 5
            ? 'medium'
            : 'low') as RiskLevel,
      totalFindings: r.comments.length,
      criticalFindings: criticals,
      highFindings: highs,
      mediumFindings: mediums,
      lowFindings: lows,
      keyTakeaways: [],
      mergeRecommendation:
        (r.summary?.mergeRecommendation as ReportSummary['mergeRecommendation']) ?? 'approve',
      mergeRationale: '',
    };

    const scope: ReportScope = {
      type: 'pr',
      projectId: r.projectId,
      prNumber: r.prNumber,
    };

    const metadata: ReportMetadata = {
      repository: r.projectId,
      branch: r.branch ?? 'unknown',
      baseBranch: 'main',
      commitSha: '',
      author: r.author ?? 'unknown',
      reviewer: '',
      standardsApplied: [],
      rulesApplied: [],
      generatorVersion: '1.0.0',
    };

    const metrics: ReportMetrics = {
      linesChanged: 0,
      filesChanged: 0,
      symbolsAffected: 0,
      routesAffected: 0,
      testsImpacted: 0,
      complexityDelta: 0,
      coverageDelta: 0,
      complianceScore: 100,
      reviewDuration: r.durationMs ?? 0,
      tokenUsage: 0,
    };

    const findings: Finding[] = r.comments.map((c) => ({
      id: c.id ?? `finding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category: c.category ?? 'other',
      severity: c.severity ?? 'info',
      title: c.content?.slice(0, 50) ?? '',
      description: c.content ?? '',
      filePath: c.path ?? '',
      lineRange:
        (c.startLine ?? 0) > 0
          ? ([c.startLine!, c.endLine ?? c.startLine!] as [number, number])
          : null,
      evidence: c.existingCode ?? '',
      relatedFindings: [],
    }));

    const recommendations: Recommendation[] = [];

    return {
      id: r.reviewId,
      type: 'pr-review',
      title: r.prTitle ?? `PR Review ${r.prNumber ?? ''}`,
      createdAt: r.timestamp,
      scope,
      summary,
      findings,
      recommendations,
      metrics,
      metadata,
    };
  }

  private emptyMetrics(): DashboardMetrics {
    return {
      totalReviews: 0,
      avgFindingsPerReview: 0,
      mostCommonIssues: [],
      severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      categoryDistribution: {},
      mergeRecommendationDistribution: {},
      avgReviewDuration: 0,
      totalFindings: 0,
      reviewsOverTime: [],
    };
  }
}
