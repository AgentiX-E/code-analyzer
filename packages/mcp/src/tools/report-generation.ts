// @code-analyzer/mcp — Report Generation Tool
// Generates formatted reports from review results with category/severity
// breakdowns, supporting markdown and JSON output formats.

import type { McpToolDefinition } from './registry.js';
import type { ReviewComment, Severity, ReviewCategory } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Review result input for report generation */
export interface ReviewResult {
  projectId: string;
  title: string;
  comments: ReviewComment[];
  summary?: string;
  overallScore?: number;
}

/** Category breakdown within a report */
export interface CategoryBreakdown {
  category: ReviewCategory | string;
  count: number;
  percentage: number;
}

/** Severity breakdown within a report */
export interface SeverityBreakdown {
  severity: Severity | string;
  count: number;
  percentage: number;
}

/** Structured report output */
export interface GeneratedReport {
  id: string;
  title: string;
  projectId: string;
  format: 'markdown' | 'json';
  createdAt: string;
  summary: {
    overallScore: number;
    totalComments: number;
    keyFindings: string[];
  };
  categoryBreakdown: CategoryBreakdown[];
  severityBreakdown: SeverityBreakdown[];
  topIssues: Array<{
    category: ReviewCategory | string;
    severity: Severity | string;
    filePath: string;
    content: string;
    startLine: number;
  }>;
  recommendations: string[];
  fullContent: string;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const reportGenerationTool: McpToolDefinition = {
  name: 'report_generation',
  description:
    'Generate formatted reports from code review results. Supports markdown and JSON output formats with category/severity breakdowns and actionable recommendations.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to generate a report for.',
      },
      reviewResults: {
        type: 'string',
        description: 'JSON string of review results containing comments, summary, and score.',
      },
      format: {
        type: 'string',
        description: 'Output format for the report.',
        enum: ['markdown', 'json'],
        default: 'markdown',
      },
      title: {
        type: 'string',
        description: 'Optional report title. Auto-generated if not provided.',
      },
    },
    required: ['projectId', 'reviewResults'],
  },
  handler: async (args: Record<string, unknown>) => {
    const { projectId, reviewResults, format, title } = args;

    let parsedResults: ReviewResult;
    try {
      parsedResults =
        typeof reviewResults === 'string'
          ? JSON.parse(reviewResults)
          : (reviewResults as ReviewResult);
    } catch {
      return {
        content: [{ type: 'text', text: 'Error: Invalid review results JSON.' }],
        isError: true,
      };
    }

    const fmt = (format as string) ?? 'markdown';
    const report = generateReport(
      projectId as string,
      parsedResults,
      fmt as 'markdown' | 'json',
      title as string | undefined,
    );

    return {
      content: [{ type: 'text', text: report.fullContent }],
      metadata: {
        projectId,
        format: fmt,
        reportId: report.id,
        totalComments: report.summary.totalComments,
        categoryCount: report.categoryBreakdown.length,
        severityCount: report.severityBreakdown.length,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Core Report Generation
// ---------------------------------------------------------------------------

/**
 * Generate a structured report from review results.
 */
export function generateReport(
  projectId: string,
  reviewResults: ReviewResult,
  format: 'markdown' | 'json' = 'markdown',
  titleOverride?: string,
): GeneratedReport {
  const comments = reviewResults.comments ?? [];
  const title = titleOverride ?? reviewResults.title ?? `Code Review Report — ${projectId}`;
  const overallScore = reviewResults.overallScore ?? computeOverallScore(comments);

  // Compute category breakdown
  const categoryBreakdown = computeCategoryBreakdown(comments);

  // Compute severity breakdown
  const severityBreakdown = computeSeverityBreakdown(comments);

  // Extract top issues (highest severity first)
  const topIssues = extractTopIssues(comments, 10);

  // Generate recommendations
  const recommendations = generateRecommendations(categoryBreakdown, severityBreakdown, comments);

  // Generate key findings summary
  const keyFindings = generateKeyFindings(comments, categoryBreakdown, severityBreakdown);

  const report: Omit<GeneratedReport, 'fullContent'> = {
    id: `report_${projectId}_${Date.now()}`,
    title,
    projectId,
    format,
    createdAt: new Date().toISOString(),
    summary: {
      overallScore,
      totalComments: comments.length,
      keyFindings,
    },
    categoryBreakdown,
    severityBreakdown,
    topIssues,
    recommendations,
  };

  const fullContent = format === 'json' ? formatAsJSON(report) : formatAsMarkdown(report);

  return { ...report, fullContent };
}

// ---------------------------------------------------------------------------
// Breakdown Computation
// ---------------------------------------------------------------------------

/**
 * Compute the distribution of review comments by category.
 */
export function computeCategoryBreakdown(comments: ReviewComment[]): CategoryBreakdown[] {
  const categoryCounts = new Map<string, number>();
  for (const comment of comments) {
    const cat = comment.category ?? 'other';
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }

  const total = comments.length || 1;
  const result: CategoryBreakdown[] = [];
  for (const [category, count] of categoryCounts) {
    result.push({
      category: category as ReviewCategory,
      count,
      percentage: Math.round((count / total) * 1000) / 10,
    });
  }

  // Sort by count descending
  result.sort((a, b) => b.count - a.count);
  return result;
}

/**
 * Compute the distribution of review comments by severity.
 */
export function computeSeverityBreakdown(comments: ReviewComment[]): SeverityBreakdown[] {
  const severityCounts = new Map<string, number>();
  for (const comment of comments) {
    const sev = comment.severity ?? 'info';
    severityCounts.set(sev, (severityCounts.get(sev) ?? 0) + 1);
  }

  const total = comments.length || 1;
  const result: SeverityBreakdown[] = [];
  for (const [severity, count] of severityCounts) {
    result.push({
      severity: severity as Severity,
      count,
      percentage: Math.round((count / total) * 1000) / 10,
    });
  }

  // Sort by severity priority: critical > high > medium > low > info
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  result.sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5));
  return result;
}

// ---------------------------------------------------------------------------
// Top Issues Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the most important issues from review comments.
 * Sorted by severity (critical first), then by category importance.
 */
export function extractTopIssues(
  comments: ReviewComment[],
  limit: number = 10,
): GeneratedReport['topIssues'] {
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };

  const sorted = [...comments]
    .sort((a, b) => (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5))
    .slice(0, limit);

  return sorted.map((c) => ({
    category: c.category,
    severity: c.severity,
    filePath: c.path,
    content: c.content,
    startLine: c.startLine,
  }));
}

// ---------------------------------------------------------------------------
// Recommendations Generation
// ---------------------------------------------------------------------------

/**
 * Generate actionable recommendations based on review patterns.
 */
export function generateRecommendations(
  categoryBreakdown: CategoryBreakdown[],
  severityBreakdown: SeverityBreakdown[],
  comments: ReviewComment[],
): string[] {
  const recommendations: string[] = [];

  // Security issues are the most critical
  const security = categoryBreakdown.find((c) => c.category === 'security');
  if (security && security.count > 0) {
    recommendations.push(
      `Address ${security.count} security finding(s) — these are the highest priority items.`,
    );
  }

  // Bug findings
  const bugs = categoryBreakdown.find((c) => c.category === 'bug');
  if (bugs && bugs.count > 0) {
    recommendations.push(
      `Fix ${bugs.count} potential bug(s) before merging to prevent runtime errors.`,
    );
  }

  // Critical/High severity items
  const critical = severityBreakdown.find((s) => s.severity === 'critical');
  const high = severityBreakdown.find((s) => s.severity === 'high');
  const criticalHighTotal = (critical?.count ?? 0) + (high?.count ?? 0);
  if (criticalHighTotal > 0) {
    recommendations.push(
      `Resolve ${criticalHighTotal} critical/high severity issue(s) as they pose significant risk.`,
    );
  }

  // Performance issues
  const perf = categoryBreakdown.find((c) => c.category === 'performance');
  if (perf && perf.count > 0) {
    recommendations.push(
      `Optimize ${perf.count} performance issue(s) to improve application responsiveness.`,
    );
  }

  // Maintainability concerns
  const maint = categoryBreakdown.find((c) => c.category === 'maintainability');
  if (maint && maint.count > 0) {
    recommendations.push(
      `Refactor ${maint.count} maintainability concern(s) to reduce technical debt.`,
    );
  }

  // Test coverage (only suggest when there are actual comments to review)
  const tests = categoryBreakdown.find((c) => c.category === 'test');
  if ((!tests || tests.count === 0) && comments.length > 0) {
    recommendations.push(
      'Consider adding tests for modified code paths to ensure regression safety.',
    );
  }

  // Documentation
  const docs = categoryBreakdown.find((c) => c.category === 'documentation');
  if (docs && docs.count > 0) {
    recommendations.push(
      `Update documentation for ${docs.count} item(s) to keep docs in sync with code.`,
    );
  }

  // If no specific recommendations, provide general advice
  if (recommendations.length === 0) {
    if (comments.length > 0) {
      recommendations.push('Review all findings and address them based on priority.');
    } else {
      recommendations.push(
        'No issues found. Consider running additional review types for comprehensive coverage.',
      );
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Key Findings
// ---------------------------------------------------------------------------

/**
 * Generate a human-readable summary of key findings.
 */
export function generateKeyFindings(
  comments: ReviewComment[],
  categoryBreakdown: CategoryBreakdown[],
  severityBreakdown: SeverityBreakdown[],
): string[] {
  const findings: string[] = [];

  if (comments.length === 0) {
    findings.push('No review comments found. The code passed all checks.');
    return findings;
  }

  findings.push(`Total of ${comments.length} review comment(s) identified.`);

  // Top categories
  const topCategories = categoryBreakdown.slice(0, 3);
  if (topCategories.length > 0) {
    const catSummary = topCategories.map((c) => `${c.category} (${c.count})`).join(', ');
    findings.push(`Most common categories: ${catSummary}.`);
  }

  // Severity summary
  const critOrHigh = severityBreakdown.filter(
    (s) => s.severity === 'critical' || s.severity === 'high',
  );
  const critHighCount = critOrHigh.reduce((sum, s) => sum + s.count, 0);
  if (critHighCount > 0) {
    findings.push(
      `${critHighCount} critical or high severity issue(s) require immediate attention.`,
    );
  } else {
    findings.push('No critical or high severity issues detected.');
  }

  // Most affected files
  const fileCounts = new Map<string, number>();
  for (const c of comments) {
    fileCounts.set(c.path, (fileCounts.get(c.path) ?? 0) + 1);
  }
  const topFiles = [...fileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (topFiles.length > 0) {
    const fileSummary = topFiles.map(([path, count]) => `\`${path}\` (${count})`).join(', ');
    findings.push(`Most affected files: ${fileSummary}.`);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Score Computation
// ---------------------------------------------------------------------------

/**
 * Compute an overall quality score based on comment severity and count.
 * Score starts at 100 and decreases based on issue severity.
 */
export function computeOverallScore(comments: ReviewComment[]): number {
  if (comments.length === 0) return 100;

  const severityDeductions: Record<string, number> = {
    critical: 15,
    high: 8,
    medium: 4,
    low: 1,
    info: 0,
  };

  let score = 100;
  for (const comment of comments) {
    score -= severityDeductions[comment.severity] ?? 1;
  }

  // Heavily penalize having many issues
  if (comments.length > 20) {
    score -= 10;
  } else if (comments.length > 10) {
    score -= 5;
  }

  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format the report as a Markdown string.
 */
export function formatAsMarkdown(report: Omit<GeneratedReport, 'fullContent'>): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push('');
  lines.push(`**Project:** ${report.projectId}`);
  lines.push(`**Generated:** ${report.createdAt}`);
  lines.push(`**Overall Score:** ${report.summary.overallScore}/100`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  for (const finding of report.summary.keyFindings) {
    lines.push(`- ${finding}`);
  }
  lines.push('');

  // Category Breakdown
  lines.push('## Category Breakdown');
  lines.push('');
  lines.push('| Category | Count | Percentage |');
  lines.push('|----------|-------|------------|');
  for (const cb of report.categoryBreakdown) {
    lines.push(`| ${cb.category} | ${cb.count} | ${cb.percentage}% |`);
  }
  lines.push('');

  // Severity Breakdown
  lines.push('## Severity Breakdown');
  lines.push('');
  lines.push('| Severity | Count | Percentage |');
  lines.push('|----------|-------|------------|');
  for (const sb of report.severityBreakdown) {
    const icon =
      sb.severity === 'critical'
        ? '🔴'
        : sb.severity === 'high'
          ? '🟠'
          : sb.severity === 'medium'
            ? '🟡'
            : sb.severity === 'low'
              ? '🟢'
              : '⚪';
    lines.push(`| ${icon} ${sb.severity} | ${sb.count} | ${sb.percentage}% |`);
  }
  lines.push('');

  // Top Issues
  if (report.topIssues.length > 0) {
    lines.push('## Top Issues');
    lines.push('');
    for (let i = 0; i < report.topIssues.length; i++) {
      const issue = report.topIssues[i]!;
      lines.push(`### ${i + 1}. [${issue.severity}] ${issue.category}`);
      lines.push(`- **File:** \`${issue.filePath}\``);
      lines.push(`- **Line:** ${issue.startLine}`);
      lines.push(`- **Description:** ${issue.content}`);
      lines.push('');
    }
  }

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of report.recommendations) {
    lines.push(`- ${rec}`);
  }
  lines.push('');

  lines.push('---');
  lines.push('*Report generated by Code Analyzer*');

  return lines.join('\n');
}

/**
 * Format the report as a JSON string.
 */
export function formatAsJSON(report: Omit<GeneratedReport, 'fullContent'>): string {
  return JSON.stringify(report, null, 2);
}

export default reportGenerationTool;
