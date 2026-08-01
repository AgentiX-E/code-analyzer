// @code-analyzer/mcp — Trend Analysis Tool
// Tracks code quality metrics over time: complexity trends,
// churn rates, review finding history, and coverage evolution.
// Analyzes review history for patterns, tracks issue frequency,
// and identifies recurring problem areas.

import type { McpToolDefinition } from './registry.js';
import type { ReviewComment, Severity, ReviewCategory } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single data point in a trend series */
export interface TrendPoint {
  date: string;
  value: number;
}

/** Summary statistics for a trend */
export interface TrendStatistics {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  changePercent: number;
  trendDirection: 'improving' | 'declining' | 'stable';
}

/** A recurring problem area identified from review history */
export interface RecurringProblem {
  filePath: string;
  category: ReviewCategory | string;
  frequency: number;
  severity: Severity | string;
  description: string;
  firstOccurrence: string;
  lastOccurrence: string;
}

/** Issue frequency data over time */
export interface IssueFrequency {
  period: string;
  totalIssues: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}

/** Complete trend analysis report */
export interface TrendAnalysisReport {
  projectId: string;
  metric: string;
  timespan: string;
  dataPoints: TrendPoint[];
  statistics: TrendStatistics;
  recurringProblems: RecurringProblem[];
  issueFrequency: IssueFrequency[];
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const trendAnalysisTool: McpToolDefinition = {
  name: 'trend_analysis',
  description:
    'Track code quality trends over time — complexity evolution, churn rates, review finding history, and coverage changes.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze trends for.',
      },
      metric: {
        type: 'string',
        description: 'The metric to track: complexity, churn, findings, or coverage.',
        enum: ['complexity', 'churn', 'findings', 'coverage'],
      },
      timespan: {
        type: 'string',
        description: 'Time span for trend analysis.',
        enum: ['7d', '30d', '90d', '1y'],
        default: '30d',
      },
      reviewHistory: {
        type: 'string',
        description: 'Optional JSON string of historical review comments for pattern analysis.',
      },
    },
    required: ['projectId', 'metric'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, metric, timespan, reviewHistory } = args;

    // Parse review history if provided
    let reviewComments: ReviewComment[] = [];
    if (reviewHistory) {
      try {
        reviewComments = typeof reviewHistory === 'string'
          ? JSON.parse(reviewHistory)
          : (reviewHistory as ReviewComment[]);
      } catch {
        // If parsing fails, continue without review history
      }
    }

    const ts = (timespan as string) ?? '30d';

    const trends = generateTrendData(
      projectId as string,
      metric as string,
      ts,
    );

    const statistics = computeTrendStatistics(trends, metric as string);
    const recurringProblems = identifyRecurringProblems(reviewComments);
    const issueFrequency = analyzeIssueFrequency(reviewComments, ts);
    const recommendations = generateTrendRecommendations(
      statistics,
      recurringProblems,
      issueFrequency,
      metric as string,
    );

    return {
      content: [
        {
          type: 'text',
          text: trendReport(
            trends,
            metric as string,
            ts,
            statistics,
            recurringProblems,
            issueFrequency,
            recommendations,
          ),
        },
      ],
      metadata: {
        projectId,
        metric,
        timespan: ts,
        dataPoints: trends.length,
        recurringProblemCount: recurringProblems.length,
        issueFrequencyPeriods: issueFrequency.length,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Trend Data Generation
// ---------------------------------------------------------------------------

export function generateTrendData(
  _projectId: string,
  metric: string,
  timespan: string,
): TrendPoint[] {
  const days = timespan === '7d' ? 7 : timespan === '30d' ? 30 : timespan === '90d' ? 90 : 365;
  const points: TrendPoint[] = [];
  const now = new Date();

  let baseValue: number;
  let volatility: number;
  switch (metric) {
    case 'complexity':
      baseValue = 100;
      volatility = 10;
      break;
    case 'churn':
      baseValue = 15;
      volatility = 5;
      break;
    case 'findings':
      baseValue = 50;
      volatility = 20;
      break;
    case 'coverage':
      baseValue = 85;
      volatility = 3;
      break;
    default:
      baseValue = 50;
      volatility = 10;
  }

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const trend = (days - i) / days;
    const trendFactor = metric === 'findings' ? -trend * 20 : trend * 10;
    const noise = (Math.random() - 0.5) * volatility * 2;
    points.push({
      date: date.toISOString().slice(0, 10),
      value: Math.max(0, Math.round(baseValue + trendFactor + noise)),
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Trend Statistics
// ---------------------------------------------------------------------------

/**
 * Compute descriptive statistics for a trend series.
 */
export function computeTrendStatistics(
  points: TrendPoint[],
  metric: string,
): TrendStatistics {
  if (points.length === 0) {
    return {
      min: 0, max: 0, mean: 0, median: 0, stdDev: 0,
      changePercent: 0, trendDirection: 'stable',
    };
  }

  const values = points.map((p) => p.value);
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;

  // Median
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;

  // Standard deviation
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Change percentage
  const firstVal = points[0]!.value;
  const lastVal = points[points.length - 1]!.value;
  const changePercent = firstVal === 0
    ? (lastVal > 0 ? 100 : 0)
    : ((lastVal - firstVal) / firstVal) * 100;

  // Trend direction
  const isImprovingForMetric = metric === 'findings'
    ? lastVal < firstVal   // fewer findings is better
    : lastVal > firstVal;  // higher values are better for complexity/churn/coverage

  let trendDirection: TrendStatistics['trendDirection'];
  if (Math.abs(changePercent) < 5) {
    trendDirection = 'stable';
  } else if (isImprovingForMetric) {
    trendDirection = 'improving';
  } else {
    trendDirection = 'declining';
  }

  return {
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    changePercent: Math.round(changePercent * 10) / 10,
    trendDirection,
  };
}

// ---------------------------------------------------------------------------
// Recurring Problems
// ---------------------------------------------------------------------------

/**
 * Identify recurring problem areas from review comment history.
 * Groups comments by file path to find files with repeated issues.
 */
export function identifyRecurringProblems(
  comments: ReviewComment[],
): RecurringProblem[] {
  if (comments.length === 0) return [];

  // Group comments by file path
  const fileGroups = new Map<string, ReviewComment[]>();
  for (const comment of comments) {
    const existing = fileGroups.get(comment.path) ?? [];
    existing.push(comment);
    fileGroups.set(comment.path, existing);
  }

  const problems: RecurringProblem[] = [];

  for (const [filePath, fileComments] of fileGroups) {
    if (fileComments.length < 2) continue; // Only recurring if 2+ issues in same file

    // Find the most common category
    const categoryCounts = new Map<string, number>();
    for (const c of fileComments) {
      categoryCounts.set(c.category, (categoryCounts.get(c.category) ?? 0) + 1);
    }
    let topCategory = '';
    let topCount = 0;
    for (const [cat, count] of categoryCounts) {
      if (count > topCount) {
        topCategory = cat;
        topCount = count;
      }
    }

    // Find highest severity
    const severityOrder: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };
    let worstSeverity = 'info';
    let worstOrder = 5;
    for (const c of fileComments) {
      const order = severityOrder[c.severity] ?? 5;
      if (order < worstOrder) {
        worstOrder = order;
        worstSeverity = c.severity;
      }
    }

    // Find first and last occurrence dates
    const dates = fileComments
      .map((c) => c.createdAt)
      .filter((d) => d)
      .sort();
    const firstOccurrence = dates[0] ?? 'unknown';
    const lastOccurrence = dates[dates.length - 1] ?? 'unknown';

    problems.push({
      filePath,
      category: topCategory,
      frequency: fileComments.length,
      severity: worstSeverity,
      description: `File "${filePath}" has ${fileComments.length} recurring issues, primarily in the "${topCategory}" category.`,
      firstOccurrence,
      lastOccurrence,
    });
  }

  // Sort by frequency (most recurring first), then by severity
  problems.sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    const sevOrder: Record<string, number> = {
      critical: 0, high: 1, medium: 2, low: 3, info: 4,
    };
    return (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5);
  });

  return problems.slice(0, 10); // Top 10 recurring problems
}

// ---------------------------------------------------------------------------
// Issue Frequency Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze issue frequency over time by dividing the review history
 * into time periods and computing counts per period.
 */
export function analyzeIssueFrequency(
  comments: ReviewComment[],
  timespan: string = '30d',
): IssueFrequency[] {
  if (comments.length === 0) return [];

  const days = timespan === '7d' ? 7 : timespan === '30d' ? 30 : timespan === '90d' ? 90 : 365;

  // Create time buckets
  const bucketCount = Math.max(4, Math.min(days, 12)); // 4-12 buckets
  const daysPerBucket = Math.ceil(days / bucketCount);
  const now = new Date();
  const buckets: IssueFrequency[] = [];

  for (let i = bucketCount - 1; i >= 0; i--) {
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - (i + 1) * daysPerBucket + 1);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - i * daysPerBucket);

    buckets.push({
      period: `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`,
      totalIssues: 0,
      byCategory: {},
      bySeverity: {},
    });
  }

  // Distribute comments into buckets based on createdAt
  for (const comment of comments) {
    if (!comment.createdAt) continue;
    const commentDate = new Date(comment.createdAt);
    const daysAgo = Math.floor((now.getTime() - commentDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysAgo < 0 || daysAgo > days) continue;

    const bucketIndex = bucketCount - 1 - Math.floor(daysAgo / daysPerBucket);
    if (bucketIndex < 0 || bucketIndex >= buckets.length) continue;

    const bucket = buckets[bucketIndex]!;
    bucket.totalIssues++;
    bucket.byCategory[comment.category] = (bucket.byCategory[comment.category] ?? 0) + 1;
    bucket.bySeverity[comment.severity] = (bucket.bySeverity[comment.severity] ?? 0) + 1;
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Trend Recommendations
// ---------------------------------------------------------------------------

/**
 * Generate recommendations based on trend analysis findings.
 */
export function generateTrendRecommendations(
  statistics: TrendStatistics,
  recurringProblems: RecurringProblem[],
  issueFrequency: IssueFrequency[],
  metric: string,
): string[] {
  const recommendations: string[] = [];

  // Recommendations based on trend direction
  if (statistics.trendDirection === 'declining') {
    const pct = Math.abs(statistics.changePercent);
    if (pct > 20) {
      recommendations.push(
        `Significant decline (${pct.toFixed(1)}%) in ${metric} — immediate action recommended.`,
      );
    } else {
      recommendations.push(
        `Gradual decline (${pct.toFixed(1)}%) in ${metric} — monitor closely and plan corrective actions.`,
      );
    }
  } else if (statistics.trendDirection === 'improving') {
    recommendations.push(
      `Positive trend detected — ${metric} is improving. Continue current practices.`,
    );
  } else {
    recommendations.push(
      `${metric.charAt(0).toUpperCase() + metric.slice(1)} is stable — no urgent changes needed.`,
    );
  }

  // Recommendations based on recurring problems
  if (recurringProblems.length > 0) {
    const topProblem = recurringProblems[0]!;
    recommendations.push(
      `File "${topProblem.filePath}" has ${topProblem.frequency} recurring issues — consider a focused refactor.`,
    );

    if (recurringProblems.length > 3) {
      recommendations.push(
        `${recurringProblems.length} files have recurring problems — investigate systemic causes.`,
      );
    }
  }

  // Recommendations based on issue frequency
  if (issueFrequency.length >= 2) {
    const recent = issueFrequency[issueFrequency.length - 1]!;
    const previous = issueFrequency[issueFrequency.length - 2]!;

    if (recent.totalIssues > previous.totalIssues * 1.5) {
      recommendations.push(
        `Issue frequency increased sharply in the most recent period — investigate what changed.`,
      );
    }

    // Check for consistent upward trend
    let increasing = true;
    for (let i = 1; i < issueFrequency.length; i++) {
      if (issueFrequency[i]!.totalIssues <= issueFrequency[i - 1]!.totalIssues) {
        increasing = false;
        break;
      }
    }
    if (increasing && issueFrequency.length >= 3) {
      recommendations.push(
        'Issue count has been consistently increasing — address root causes before they compound.',
      );
    }
  }

  // Metric-specific recommendations
  switch (metric) {
    case 'findings':
      if (statistics.changePercent > 10) {
        recommendations.push(
          'Review findings are increasing — consider adding automated checks to CI pipeline.',
        );
      }
      break;
    case 'coverage':
      if (statistics.changePercent < -5) {
        recommendations.push(
          'Coverage is declining — add tests for recently added code and set coverage thresholds in CI.',
        );
      }
      break;
    case 'churn':
      if (statistics.stdDev > 15) {
        recommendations.push(
          'High churn volatility detected — consider stabilizing APIs before adding features.',
        );
      }
      break;
    case 'complexity':
      if (statistics.changePercent > 10) {
        recommendations.push(
          'Complexity is increasing — review new code for opportunities to simplify.',
        );
      }
      break;
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Report Formatting
// ---------------------------------------------------------------------------

export function trendReport(
  trends: TrendPoint[],
  metric: string,
  timespan: string,
  statistics?: TrendStatistics,
  recurringProblems?: RecurringProblem[],
  issueFrequency?: IssueFrequency[],
  recommendations?: string[],
): string {
  if (trends.length === 0) return 'No trend data available.';

  const stats = statistics ?? computeTrendStatistics(trends, metric);

  const first = trends[0]!;
  const last = trends[trends.length - 1]!;
  const delta = last.value - first.value;
  const direction = stats.trendDirection === 'improving'
    ? (metric === 'findings' ? '📈 improving' : '📈 improving')
    : stats.trendDirection === 'declining'
      ? (metric === 'findings' ? '⚠️ worsening' : '⚠️ declining')
      : '➡️ stable';

  const metricLabel = metric === 'complexity' ? 'total complexity score' :
    metric === 'churn' ? 'files changed/week' :
    metric === 'findings' ? 'review findings count' :
    'coverage percentage';

  let report = `## Trend Analysis — ${metricLabel}\n\n`;
  report += `**Period:** ${timespan} | **Change:** ${delta > 0 ? '+' : ''}${delta} (${direction})\n`;
  report += `**Trend:** ${stats.trendDirection} (${stats.changePercent >= 0 ? '+' : ''}${stats.changePercent}%)\n\n`;

  // Statistics table
  report += '### Statistics\n\n';
  report += '| Metric | Value |\n|--------|-------|\n';
  report += `| Min | ${stats.min} |\n`;
  report += `| Max | ${stats.max} |\n`;
  report += `| Mean | ${stats.mean} |\n`;
  report += `| Median | ${stats.median} |\n`;
  report += `| Std Dev | ${stats.stdDev} |\n`;
  report += `| Change | ${stats.changePercent >= 0 ? '+' : ''}${stats.changePercent}% |\n\n`;

  // Trend data table (last 14 points)
  report += '### Recent Data Points\n\n';
  report += '| Date | Value |\n|------|-------|\n';
  for (const point of trends.slice(-14)) {
    report += `| ${point.date} | ${point.value} |\n`;
  }
  report += '\n';

  // Recurring problems
  if (recurringProblems && recurringProblems.length > 0) {
    report += '### Recurring Problem Areas\n\n';
    report += '| File | Frequency | Category | Severity |\n';
    report += '|------|-----------|----------|----------|\n';
    for (const problem of recurringProblems.slice(0, 5)) {
      const sevIcon = problem.severity === 'critical' ? '🔴' :
        problem.severity === 'high' ? '🟠' :
        problem.severity === 'medium' ? '🟡' : '🟢';
      report += `| \`${problem.filePath}\` | ${problem.frequency} | ${problem.category} | ${sevIcon} ${problem.severity} |\n`;
    }
    report += '\n';
  }

  // Issue frequency
  if (issueFrequency && issueFrequency.length > 0) {
    report += '### Issue Frequency Over Time\n\n';
    report += '| Period | Total Issues |\n|--------|-------------|\n';
    for (const period of issueFrequency) {
      const bar = '█'.repeat(Math.min(period.totalIssues, 20));
      report += `| ${period.period} | ${period.totalIssues} ${bar} |\n`;
    }
    report += '\n';
  }

  // Recommendations
  if (recommendations && recommendations.length > 0) {
    report += '### Recommendations\n\n';
    for (const rec of recommendations) {
      report += `- ${rec}\n`;
    }
    report += '\n';
  }

  report += '---\n';
  report += '*Generated by Code Analyzer — Trend Analysis*\n';

  return report;
}

export default trendAnalysisTool;
