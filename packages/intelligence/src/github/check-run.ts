// @code-analyzer/intelligence — GitHub Check Run Manager
// Creates, updates, and annotates GitHub Check Runs for cross-repo PR reviews.
// Converts CrossRepoPRReviewResult into structured annotations visible on GitHub PRs.

import type { GitHubApiClient, GitHubAnnotation, GitHubCheckRun, CreateCheckRunParams } from './client.js';
import type { CrossRepoPRReviewResult } from '../cross-repo/cross-repo-pr-review.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckRunOptions {
  /** GitHub API client */
  client: GitHubApiClient;
  /** Check run name shown in GitHub UI */
  name?: string;
}

export interface CheckRunResult {
  checkRun: GitHubCheckRun;
  annotationsCount: number;
}

// ---------------------------------------------------------------------------
// GitHubCheckRunManager
// ---------------------------------------------------------------------------

/**
 * Manages GitHub Check Runs for cross-repo PR reviews.
 *
 * Flow:
 * 1. createCheckRun() — marks "in_progress" when review starts
 * 2. updateCheckRun() — marks "completed" with annotations + summary
 *
 * @example
 * ```ts
 * const manager = new GitHubCheckRunManager({ client });
 * const check = await manager.create('owner', 'repo', headSha);
 * await manager.complete(check.id, 'owner', 'repo', crossRepoResult);
 * ```
 */
export class GitHubCheckRunManager {
  private readonly client: GitHubApiClient;
  private readonly name: string;

  constructor(options: CheckRunOptions) {
    this.client = options.client;
    this.name = options.name ?? 'code-analyzer / Cross-Repo Review';
  }

  /**
   * Create a check run in "in_progress" status at the start of review.
   */
  async create(
    owner: string,
    repo: string,
    headSha: string,
    details?: { title?: string; summary?: string },
  ): Promise<GitHubCheckRun> {
    const params: CreateCheckRunParams = {
      name: this.name,
      head_sha: headSha,
      status: 'in_progress',
      output: {
        title: details?.title ?? 'Cross-Repo Code Review',
        summary: details?.summary ?? 'Analyzing cross-repository impact...',
      },
    };

    return this.client.createCheckRun(owner, repo, params);
  }

  /**
   * Complete a check run with cross-repo review results.
   * Converts findings into GitHub annotations and summary.
   */
  async complete(
    checkRunId: number,
    owner: string,
    repo: string,
    result: CrossRepoPRReviewResult,
  ): Promise<CheckRunResult> {
    const annotations = this.formatAnnotations(result);
    const conclusion = this.determineConclusion(result);
    const summary = this.formatSummary(result);

    const checkRun = await this.client.updateCheckRun(
      owner,
      repo,
      checkRunId,
      {
        status: 'completed',
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: `Cross-Repo Review — ${result.summary.riskLevel.toUpperCase()} Risk`,
          summary,
          text: this.formatDetailedText(result),
          annotations: annotations.slice(0, 50), // GitHub limits to 50 per update
        },
      },
    );

    return { checkRun, annotationsCount: annotations.length };
  }

  /**
   * Mark a check run as failed due to an unexpected error.
   */
  async fail(
    checkRunId: number,
    owner: string,
    repo: string,
    error: string,
  ): Promise<GitHubCheckRun> {
    return this.client.updateCheckRun(owner, repo, checkRunId, {
      status: 'completed',
      conclusion: 'failure',
      completed_at: new Date().toISOString(),
      output: {
        title: 'Cross-Repo Review Failed',
        summary: `## Error\n\n\`\`\`\n${error}\n\`\`\``,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  /**
   * Convert cross-repo review findings to GitHub annotations.
   */
  formatAnnotations(result: CrossRepoPRReviewResult): GitHubAnnotation[] {
    const annotations: GitHubAnnotation[] = [];

    // API breaking changes → failure annotations
    for (const bc of result.apiBreakingChanges ?? []) {
      annotations.push({
        path: bc.filePath ?? '',
        start_line: bc.startLine ?? 1,
        end_line: bc.endLine ?? (bc.startLine ?? 1),
        annotation_level: 'failure',
        message: `[BREAKING] ${bc.type}: ${bc.description}`,
        title: `API Breaking Change: ${bc.type}`,
      });
    }

    // Cross-repo impact entries → warning annotations
    for (const impact of result.crossRepoImpact ?? []) {
      annotations.push({
        path: impact.sourceFile ?? '',
        start_line: impact.sourceLine ?? 1,
        end_line: impact.sourceLine ?? 1,
        annotation_level: 'warning',
        message: `Cross-repo impact on \`${impact.targetRepo}\`: ${impact.description}`,
        title: `Cross-Repo Impact: ${impact.targetRepo}`,
      });
    }

    // Version compatibility issues → warning annotations
    for (const compat of result.dependencyCompatibility ?? []) {
      annotations.push({
        path: compat.filePath ?? '',
        start_line: compat.startLine ?? 1,
        end_line: compat.endLine ?? 1,
        annotation_level: 'warning',
        message: `Version ${compat.type}: ${compat.message}`,
        title: `Dependency Compatibility: ${compat.type}`,
      });
    }

    // Standard review issues → warning/notice annotations
    for (const issue of result.reviewIssues ?? []) {
      const level: GitHubAnnotation['annotation_level'] =
        issue.severity === 'critical' || issue.severity === 'high' ? 'failure' :
        issue.severity === 'medium' ? 'warning' : 'notice';

      annotations.push({
        path: issue.path ?? '',
        start_line: issue.startLine ?? 1,
        end_line: issue.endLine ?? (issue.startLine ?? 1),
        annotation_level: level,
        message: issue.message ?? issue.title ?? '',
        title: issue.title,
      });
    }

    // Test impact predictions → notice annotations
    for (const test of result.testImpact ?? []) {
      annotations.push({
        path: test.testFile ?? '',
        start_line: 1,
        end_line: 1,
        annotation_level: 'notice',
        message: `Test may be affected by changes in \`${
          Array.isArray(test.affectedSymbols) ? test.affectedSymbols.join(', ') : test.affectedSymbols
        }\``,
        title: `Test Impact: ${test.testFile}`,
      });
    }

    return annotations;
  }

  /**
   * Determine check run conclusion from review summary.
   */
  determineConclusion(result: CrossRepoPRReviewResult): GitHubCheckRun['conclusion'] {
    const rec = result.summary.mergeRecommendation;

    switch (rec) {
      case 'approve':
        return 'success';
      case 'approve-with-caution':
        return 'neutral';
      case 'request-changes':
        return 'failure';
      case 'block':
        return 'action_required';
      default:
        return 'neutral';
    }
  }

  /**
   * Format a Markdown summary for the check run.
   */
  formatSummary(result: CrossRepoPRReviewResult): string {
    const s = result.summary;
    let md = `## Cross-Repo Review Summary\n\n`;
    md += `**Risk Level:** ${s.riskLevel.toUpperCase()}\n`;
    md += `**Merge Recommendation:** ${s.mergeRecommendation}\n`;
    md += `**Repos Impacted:** ${s.reposImpacted}\n\n`;

    if (result.apiBreakingChanges && result.apiBreakingChanges.length > 0) {
      md += `### ⚠️ API Breaking Changes (${result.apiBreakingChanges.length})\n`;
      for (const bc of result.apiBreakingChanges.slice(0, 10)) {
        md += `- **${bc.type}**: ${bc.description}\n`;
      }
      md += '\n';
    }

    if (result.crossRepoImpact && result.crossRepoImpact.length > 0) {
      md += `### 🔗 Cross-Repo Impact (${result.crossRepoImpact.length})\n`;
      for (const impact of result.crossRepoImpact.slice(0, 10)) {
        md += `- Impact on \`${impact.targetRepo}\`: ${impact.description}\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Format detailed markdown text for the check run.
   */
  formatDetailedText(result: CrossRepoPRReviewResult): string {
    const s = result.summary;
    let md = `## Detailed Cross-Repo Analysis\n\n`;

    md += `### Recommendations\n`;
    for (const rec of s.recommendations ?? []) {
      md += `- ${rec}\n`;
    }
    md += '\n';

    if (result.dependencyCompatibility && result.dependencyCompatibility.length > 0) {
      md += `### Dependency Compatibility\n`;
      for (const dc of result.dependencyCompatibility.slice(0, 20)) {
        md += `- **${dc.type}**: ${dc.message}\n`;
      }
      md += '\n';
    }

    if (result.testImpact && result.testImpact.length > 0) {
      md += `### Test Impact (${result.testImpact.length} tests)\n`;
      for (const t of result.testImpact.slice(0, 10)) {
        md += `- \`${t.testFile}\` — affected by: ${
          Array.isArray(t.affectedSymbols) ? t.affectedSymbols.join(', ') : t.affectedSymbols
        }\n`;
      }
      md += '\n';
    }

    return md;
  }
}
