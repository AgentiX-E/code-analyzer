// @code-analyzer/intelligence — GitHub PR Webhook Handler
// Handles GitHub webhook events for pull request review automation.
// Verifies webhook signatures, fetches diffs, runs review engine,
// and posts inline comments back to GitHub PRs.

import { createHmac, timingSafeEqual } from 'crypto';
import type { PullRequest, GitDiff, ReviewComment } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { PRReviewEngine } from './pr-review.js';
import { DiffParser } from './diff-parser.js';
import { ReviewPipeline } from './review-pipeline.js';
import type { ReviewConfig } from './review-engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubPREvent {
  action: 'opened' | 'synchronize' | 'reopened' | 'closed';
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string; repo: { full_name: string } };
  };
  repository: { full_name: string };
}

export interface WebhookResult {
  status: 'processed' | 'skipped' | 'error';
  message: string;
  sessionId?: string;
  commentsCount?: number;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// GitHub PR Webhook Handler
// ---------------------------------------------------------------------------

export class GitHubPRWebhook {
  private readonly diffParser: DiffParser;
  private readonly pipeline: ReviewPipeline;

  constructor(
    private githubToken: string,
    private reviewEngine: PRReviewEngine,
    private store: InMemoryGraphStore,
    private webhookSecret?: string,
  ) {
    this.diffParser = new DiffParser();
    this.pipeline = new ReviewPipeline();
  }

  // -------------------------------------------------------------------------
  // Signature Verification
  // -------------------------------------------------------------------------

  /**
   * Verify a webhook payload signature using HMAC-SHA256.
   * GitHub sends the signature in the X-Hub-Signature-256 header.
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      // If no secret is configured, accept all payloads
      return true;
    }

    const expectedSignature = `sha256=${createHmac('sha256', this.webhookSecret)
      .update(payload, 'utf-8')
      .digest('hex')}`;

    try {
      return timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature),
      );
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Event Handling
  // -------------------------------------------------------------------------

  /**
   * Handle a pull_request webhook event.
   * Processes opened, synchronize, and reopened events.
   * Skips closed events.
   */
  async handlePullRequestEvent(
    event: string,
    payload: GitHubPREvent,
  ): Promise<WebhookResult> {
    if (event !== 'pull_request') {
      return { status: 'skipped', message: `Unsupported event: ${event}` };
    }

    // Only process opened, synchronize, and reopened events
    if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) {
      return {
        status: 'skipped',
        message: `Skipping action: ${payload.action}`,
      };
    }

    try {
      const [owner, repo] = payload.repository.full_name.split('/');
      if (!owner || !repo) {
        return { status: 'error', message: 'Invalid repository full_name' };
      }

      const prNumber = payload.pull_request.number;
      const commitId = payload.pull_request.head.sha;

      // Fetch PR diff
      const diffText = await this.fetchPRDiff(owner, repo, prNumber);
      const diffs = this.diffParser.parseUnifiedDiff(diffText);

      // Convert GitHub PREvent to PullRequest type
      const pr: PullRequest = {
        number: prNumber,
        title: payload.pull_request.title,
        body: payload.pull_request.body,
        state: 'open',
        base: {
          ref: payload.pull_request.base.ref,
          sha: payload.pull_request.base.sha,
          repo: {
            id: 0,
            owner,
            name: repo,
            fullName: payload.repository.full_name,
            defaultBranch: 'main',
            cloneUrl: `https://github.com/${payload.repository.full_name}.git`,
            language: null,
            topics: [],
            isPrivate: false,
            description: null,
          },
        },
        head: {
          ref: payload.pull_request.head.ref,
          sha: payload.pull_request.head.sha,
          repo: {
            id: 0,
            owner,
            name: repo,
            fullName: payload.repository.full_name,
            defaultBranch: 'main',
            cloneUrl: `https://github.com/${payload.repository.full_name}.git`,
            language: null,
            topics: [],
            isPrivate: false,
            description: null,
          },
        },
        user: { login: '' },
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Run the review
      const result = await this.reviewEngine.reviewPR(
        payload.repository.full_name,
        pr,
        diffs,
      );

      // Post inline comments to GitHub
      const inlineComments: InlineComment[] = result.comments.map((c) => ({
        path: c.path,
        line: c.startLine,
        body: `**${c.severity.toUpperCase()}** [${c.category}]: ${c.content}\n\n\`\`\`suggestion\n${c.suggestionCode ?? ''}\n\`\`\``,
        side: 'RIGHT',
      }));

      if (inlineComments.length > 0) {
        const summaryBody = this.buildReviewSummaryBody(result.summary);
        await this.submitReview(
          owner,
          repo,
          prNumber,
          commitId,
          summaryBody,
          result.summary.mergeRecommendation === 'block'
            ? 'REQUEST_CHANGES'
            : result.summary.mergeRecommendation === 'approve'
              ? 'APPROVE'
              : 'COMMENT',
          inlineComments.slice(0, 50), // GitHub limits reviews to 50 comments per review
        );
      }

      return {
        status: 'processed',
        message: 'PR review completed',
        sessionId: result.sessionId,
        commentsCount: result.comments.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 'error', message };
    }
  }

  // -------------------------------------------------------------------------
  // GitHub API Methods
  // -------------------------------------------------------------------------

  /**
   * Fetch a pull request diff from the GitHub API.
   * Uses the media type application/vnd.github.v3.diff for raw diff format.
   */
  async fetchPRDiff(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
    return this.githubRequest(url, {
      headers: { Accept: 'application/vnd.github.v3.diff' },
      method: 'GET',
    });
  }

  /**
   * Fetch the list of files changed in a pull request.
   */
  async fetchPRFiles(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PRFile[]> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/files`;
    const response = await this.githubRequest<any[]>(url, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      method: 'GET',
    });

    try {
      const data = JSON.parse(response);
      return (data as any[]).map((f) => ({
        filename: f.filename as string,
        status: f.status as string,
        additions: f.additions as number,
        deletions: f.deletions as number,
        changes: f.changes as number,
        patch: f.patch as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Post a single review comment on a pull request.
   */
  async postReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commitId: string,
    body: string,
    path: string,
    line: number,
  ): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
    await this.githubRequest(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body,
        commit_id: commitId,
        path,
        line,
        side: 'RIGHT',
      }),
    });
  }

  /**
   * Submit a full review with multiple inline comments.
   * GitHub allows up to 50 comments per review.
   */
  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    commitId: string,
    body: string,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
    comments: InlineComment[],
  ): Promise<void> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
    const payload: Record<string, unknown> = {
      commit_id: commitId,
      body,
      event: event.toLowerCase(),
    };

    if (comments.length > 0) {
      payload.comments = comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
        side: c.side ?? 'RIGHT',
      }));
    }

    await this.githubRequest(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Make a GitHub API request with retry logic and rate limit awareness.
   */
  private async githubRequest(
    url: string,
    options: RequestInit,
  ): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.githubToken}`,
      'User-Agent': 'code-analyzer',
      ...(options.headers as Record<string, string> | undefined),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, { ...options, headers });

        // Check rate limit
        const remaining = response.headers.get('X-RateLimit-Remaining');
        if (remaining !== null && parseInt(remaining, 10) === 0) {
          const resetTime = response.headers.get('X-RateLimit-Reset');
          const resetDate = resetTime
            ? new Date(parseInt(resetTime, 10) * 1000)
            : new Date(Date.now() + 60000);
          const waitMs = Math.max(0, resetDate.getTime() - Date.now());

          if (attempt < MAX_RETRIES - 1) {
            await this.delay(waitMs + 1000);
            continue;
          }

          throw new Error(
            `GitHub API rate limit exceeded. Resets at ${resetDate.toISOString()}`,
          );
        }

        if (response.status === 429) {
          // Secondary rate limit — wait and retry
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);

          await this.delay(waitMs);
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(
            `GitHub API error (${response.status}): ${body.slice(0, 200)}`,
          );
        }

        return await response.text();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES - 1) {
          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await this.delay(delayMs);
        }
      }
    }

    throw lastError ?? new Error('GitHub API request failed');
  }

  private buildReviewSummaryBody(
    summary: import('./pr-review.js').PRReviewSummary,
  ): string {
    const lines: string[] = [
      '## Code Analyzer Review Summary',
      '',
      `**Risk Level:** ${summary.riskLevel}`,
      `**Recommendation:** ${summary.mergeRecommendation}`,
      `**Total Comments:** ${summary.totalComments}`,
      '',
      '### By Severity',
    ];

    for (const [severity, count] of Object.entries(summary.bySeverity)) {
      if (count > 0) {
        lines.push(`- ${severity}: ${count}`);
      }
    }

    lines.push('', '### By Category');
    for (const [category, count] of Object.entries(summary.byCategory)) {
      if (count > 0) {
        lines.push(`- ${category}: ${count}`);
      }
    }

    return lines.join('\n');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
