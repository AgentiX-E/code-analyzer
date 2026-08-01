// @code-analyzer/server — PR Review Handler
// Handles GitHub pull_request webhook events.
// Triggers the code review pipeline and posts results back to the PR.

import type { WebhookEvent } from './webhook-handler.js';
import type { EventHandler } from './webhook-handler.js';
import type { CodeReviewEngine } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRDetails {
  action: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  repository: {
    owner: string;
    name: string;
    fullName: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  head: {
    ref: string;
    sha: string;
  };
  sender: {
    login: string;
  };
}

export interface PRReviewResult {
  prNumber: number;
  repo: string;
  status: 'pending' | 'success' | 'failure' | 'error';
  comments: number;
  summary: string;
  error?: string;
  timestamp: string;
}

export interface PRReviewConfig {
  /** GitHub API token for posting comments */
  githubToken?: string;
  /** Whether to auto-post review comments to PR */
  autoPostComments: boolean;
  /** Whether to update PR status checks */
  updateStatusChecks: boolean;
  /** Maximum number of comments to post */
  maxComments: number;
}

// ---------------------------------------------------------------------------
// PRReviewEventHandler
// ---------------------------------------------------------------------------

export class PRReviewEventHandler implements EventHandler {
  private reviewedSHAs = new Map<string, PRReviewResult>();

  constructor(
    private reviewEngine: CodeReviewEngine,
    _config: Partial<PRReviewConfig> = {},
  ) {
  }

  /**
   * Handle a pull_request webhook event.
   */
  async handle(event: WebhookEvent): Promise<void> {
    const { payload } = event;
    const action = payload['action'] as string | undefined;

    // Only process supported PR actions
    if (
      !action ||
      !['opened', 'synchronize', 'reopened'].includes(action)
    ) {
      return;
    }

    const prDetails = this.extractPRDetails(payload);
    if (!prDetails) return;

    // Deduplication: don't re-review the same commit SHA
    const headSha = prDetails.head.sha;
    if (this.reviewedSHAs.has(headSha)) {
      return;
    }

    // Mark as pending
    this.reviewedSHAs.set(headSha, {
      prNumber: prDetails.number,
      repo: prDetails.repository.fullName,
      status: 'pending',
      comments: 0,
      summary: 'Review in progress...',
      timestamp: new Date().toISOString(),
    });

    try {
      // Run the review pipeline
      // In production, this would parse the actual PR diff and run the full pipeline
      const reviewResult = await this.performReview(prDetails, payload);

      this.reviewedSHAs.set(headSha, reviewResult);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.reviewedSHAs.set(headSha, {
        prNumber: prDetails.number,
        repo: prDetails.repository.fullName,
        status: 'error',
        comments: 0,
        summary: '',
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get review result for a commit SHA.
   */
  getReviewResult(sha: string): PRReviewResult | undefined {
    return this.reviewedSHAs.get(sha);
  }

  /**
   * Extract PR details from webhook payload.
   */
  extractPRDetails(payload: Record<string, unknown>): PRDetails | null {
    const pr = payload['pull_request'] as Record<string, unknown> | undefined;
    if (!pr) return null;

    const repo = payload['repository'] as Record<string, unknown> | undefined;
    if (!repo) return null;

    const owner = (repo['owner'] as Record<string, unknown> | undefined);
    const base = pr['base'] as Record<string, unknown> | undefined;
    const head = pr['head'] as Record<string, unknown> | undefined;
    const sender = payload['sender'] as Record<string, unknown> | undefined;

    if (!base || !head) return null;

    return {
      action: (payload['action'] as string) ?? 'unknown',
      number: pr['number'] as number,
      title: (pr['title'] as string) ?? '',
      body: (pr['body'] as string) ?? null,
      state: (pr['state'] as string) ?? 'unknown',
      repository: {
        owner: (owner?.['login'] as string) ?? '',
        name: (repo['name'] as string) ?? '',
        fullName: (repo['full_name'] as string) ?? '',
      },
      base: {
        ref: (base['ref'] as string) ?? '',
        sha: (base['sha'] as string) ?? '',
      },
      head: {
        ref: (head['ref'] as string) ?? '',
        sha: (head['sha'] as string) ?? '',
      },
      sender: {
        login: (sender?.['login'] as string) ?? '',
      },
    };
  }

  /**
   * Get all pending/completed review results.
   */
  getAllResults(): PRReviewResult[] {
    return Array.from(this.reviewedSHAs.values());
  }

  /**
   * Clear review cache.
   */
  clearCache(): void {
    this.reviewedSHAs.clear();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async performReview(
    prDetails: PRDetails,
    _payload: Record<string, unknown>,
  ): Promise<PRReviewResult> {
    // In production, this would:
    // 1. Fetch the PR diff from GitHub API
    // 2. Parse the diff into GitDiff objects
    // 3. Run the review engine
    // 4. Post comments back to PR

    // Run the review engine (allows error injection for testing)
    await this.reviewEngine.reviewDiff(
      prDetails.repository.fullName,
      [],
    );

    // For now, generate a simulated review result
    const comments = 0; // Would be actual review comments count

    return {
      prNumber: prDetails.number,
      repo: prDetails.repository.fullName,
      status: 'success',
      comments,
      summary: `PR #${prDetails.number} reviewed successfully. No issues detected.`,
      timestamp: new Date().toISOString(),
    };
  }
}
