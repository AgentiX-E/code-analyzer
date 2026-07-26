// @code-analyzer/intelligence — GitHub Check Run Manager
// Creates, updates, and annotates GitHub Check Runs for cross-repo PR reviews.
// Converts CrossRepoReviewResult into structured annotations visible on GitHub PRs.

import type { GitHubApiClient, GitHubAnnotation, GitHubCheckRun, CreateCheckRunParams } from './client.js';
import type { CrossRepoReviewResult, APIBreakingChange, CrossRepoImpactEntry, TestImpactPrediction } from '../cross-repo/cross-repo-pr-review.js';
import type { ReviewComment } from '@code-analyzer/shared';

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

export class GitHubCheckRunManager {
  private readonly client: GitHubApiClient;
  private readonly name: string;

  constructor(options: CheckRunOptions) {
    this.client = options.client;
    this.name = options.name ?? 'code-analyzer / Cross-Repo Review';
  }

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

  async complete(
    checkRunId: number,
    owner: string,
    repo: string,
    result: CrossRepoReviewResult,
  ): Promise<CheckRunResult> {
    const annotations = this.formatAnnotations(result);
    const conclusion = this.determineConclusion(result);

    const checkRun = await this.client.updateCheckRun(
      owner, repo, checkRunId,
      {
        status: 'completed',
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: `Cross-Repo Review — ${result.summary.crossRepoRisk.toUpperCase()} Risk`,
          summary: this.formatSummary(result),
          text: this.formatDetailedText(result),
          annotations: annotations.slice(0, 50),
        },
      },
    );

    return { checkRun, annotationsCount: annotations.length };
  }

  async fail(checkRunId: number, owner: string, repo: string, error: string): Promise<GitHubCheckRun> {
    return this.client.updateCheckRun(owner, repo, checkRunId, {
      status: 'completed',
      conclusion: 'failure',
      completed_at: new Date().toISOString(),
      output: { title: 'Cross-Repo Review Failed', summary: `## Error\n\n\`\`\`\n${error}\n\`\`\`` },
    });
  }

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  formatAnnotations(result: CrossRepoReviewResult): GitHubAnnotation[] {
    const annotations: GitHubAnnotation[] = [];

    // API breaking changes -> failure annotations
    for (const bc of result.apiBreakingChanges) {
      annotations.push({
        path: bc.symbol,
        start_line: 1, end_line: 1,
        annotation_level: 'failure',
        message: `[BREAKING] ${bc.changeType}: ${bc.description}`,
        title: `API Breaking: ${bc.changeType}`,
      });
    }

    // Cross-repo impacts -> warning annotations
    for (const impact of result.crossRepoImpacts) {
      const level: GitHubAnnotation['annotation_level'] =
        impact.impactLevel === 'critical' ? 'failure' : 'warning';
      annotations.push({
        path: impact.affectedRepo,
        start_line: 1, end_line: 1,
        annotation_level: level,
        message: `Cross-repo impact on \`${impact.affectedRepo}\`: ${impact.description}`,
        title: `Cross-Repo Impact: ${impact.affectedRepo}`,
      });
    }

    // PR review comments -> warning/notice annotations
    for (const comment of result.prComments) {
      const level: GitHubAnnotation['annotation_level'] =
        comment.severity === 'critical' || comment.severity === 'high' ? 'failure' :
        comment.severity === 'medium' ? 'warning' : 'notice';
      annotations.push({
        path: comment.path,
        start_line: comment.startLine, end_line: comment.endLine,
        annotation_level: level,
        message: comment.content,
        title: `[${comment.severity}] ${comment.category}`,
      });
    }

    // Test impact -> notice annotations
    for (const test of result.testPredictions) {
      for (const testFile of test.testFiles.slice(0, 3)) {
        annotations.push({
          path: testFile,
          start_line: 1, end_line: 1,
          annotation_level: 'notice',
          message: `Test may be affected: ${test.reason}`,
          title: `Test Impact: ${test.repo}`,
        });
      }
    }

    return annotations;
  }

  determineConclusion(result: CrossRepoReviewResult): GitHubCheckRun['conclusion'] {
    const rec = result.summary.mergeRecommendation;
    switch (rec) {
      case 'approve': return 'success';
      case 'approve-with-caution': return 'neutral';
      case 'request-changes': return 'failure';
      case 'block': return 'action_required';
      default: return 'neutral';
    }
  }

  formatSummary(result: CrossRepoReviewResult): string {
    const s = result.summary;
    let md = `## Cross-Repo Review Summary\n\n`;
    md += `**Risk Level:** ${s.crossRepoRisk.toUpperCase()}\n`;
    md += `**Merge Recommendation:** ${s.mergeRecommendation}\n`;
    md += `**Repos Impacted:** ${s.reposImpacted}\n`;
    md += `**Breaking Changes:** ${s.breakingChanges}\n\n`;

    if (result.apiBreakingChanges.length > 0) {
      md += `### API Breaking Changes (${result.apiBreakingChanges.length})\n`;
      for (const bc of result.apiBreakingChanges.slice(0, 10)) {
        md += `- **${bc.changeType}**: \`${bc.symbol}\` — ${bc.description}\n`;
      }
      md += '\n';
    }

    if (result.crossRepoImpacts.length > 0) {
      md += `### Cross-Repo Impact (${result.crossRepoImpacts.length})\n`;
      for (const impact of result.crossRepoImpacts.slice(0, 10)) {
        md += `- \`${impact.affectedRepo}\`: ${impact.description}\n`;
      }
      md += '\n';
    }

    return md;
  }

  formatDetailedText(result: CrossRepoReviewResult): string {
    const s = result.summary;
    let md = `## Detailed Cross-Repo Analysis\n\n`;

    md += `### Recommendations\n`;
    for (const rec of s.recommendations) {
      md += `- ${rec}\n`;
    }
    md += '\n';

    if (result.testPredictions.length > 0) {
      md += `### Test Impact (${result.testPredictions.length})\n`;
      for (const t of result.testPredictions.slice(0, 10)) {
        md += `- **${t.repo}**: ${t.testFiles.join(', ')}\n  (${t.reason})\n`;
      }
      md += '\n';
    }

    return md;
  }
}
