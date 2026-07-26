// @code-analyzer/intelligence — Cross-Repo Webhook Bridge
// Connects GitHub webhook events → CrossRepoPRReviewEngine → GitHub Check Runs.
// This is the core pipeline that enables automated cross-repo PR review on GitHub.

import type { GitHubApiClient } from './client.js';
import type { GitHubRepoSync } from './repo-sync.js';
import type { GitHubCheckRunManager } from './check-run.js';
import type { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import type { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import type { CrossRepoPRReviewEngine } from '../cross-repo/cross-repo-pr-review.js';
import type { PRReviewEngine } from '../review/pr-review.js';
import { DiffParser } from '../review/diff-parser.js';
import type { PullRequest, GitDiff } from '@code-analyzer/shared';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: { sha: string; ref: string; repo: { full_name: string; name: string; owner: { login: string } } };
    base: { sha: string; ref: string; repo: { full_name: string } };
    html_url: string;
  };
  repository: {
    full_name: string;
    name: string;
    owner: { login: string };
  };
}

export interface BridgeResult {
  status: 'completed' | 'skipped' | 'error';
  checkRunId?: number;
  reviewResult?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// CrossRepoWebhookBridge
// ---------------------------------------------------------------------------

/**
 * Bridges GitHub webhooks to the cross-repo PR review pipeline.
 *
 * Flow:
 * 1. Receive webhook event for a PR
 * 2. Find the repo group containing the source repo
 * 3. Sync all repos in the group
 * 4. Index all repos into the graph store
 * 5. Run CrossRepoPRReviewEngine for cross-repo analysis
 * 6. Create/update GitHub Check Run with results
 *
 * @example
 * ```ts
 * const bridge = new CrossRepoWebhookBridge({
 *   client,
 *   sync,
 *   checkRunManager,
 *   groupManager,
 *   indexer,
 *   reviewEngine,
 *   store,
 * });
 *
 * const result = await bridge.process(payload);
 * ```
 */
export class CrossRepoWebhookBridge {
  private readonly diffParser = new DiffParser();

  constructor(
    private client: GitHubApiClient,
    private sync: GitHubRepoSync,
    private checkRunManager: GitHubCheckRunManager,
    private groupManager: RepoGroupManager,
    private indexer: CrossRepoIndexer,
    private reviewEngine: CrossRepoPRReviewEngine,
    private singleRepoReviewEngine: PRReviewEngine,
    private store: InMemoryGraphStore,
  ) {}

  /**
   * Process a GitHub webhook payload through the cross-repo review pipeline.
   *
   * @param payload - The parsed webhook payload from GitHub.
   * @returns Result with status, check run ID, and review outcome.
   */
  async process(payload: WebhookPayload): Promise<BridgeResult> {
    const startTime = Date.now();

    try {
      // 1. Validate the event type
      if (!['opened', 'synchronize', 'reopened'].includes(payload.action)) {
        return { status: 'skipped', durationMs: Date.now() - startTime };
      }

      const owner = payload.repository.owner.login;
      const repo = payload.repository.name;
      const fullName = payload.repository.full_name;
      const prNumber = payload.pull_request.number;
      const headSha = payload.pull_request.head.sha;

      // 2. Find the repo group containing this repo
      const groupId = this.findGroupForRepo(fullName);
      if (!groupId) {
        // No cross-repo group — skip (not an error)
        return { status: 'skipped', durationMs: Date.now() - startTime };
      }

      // 3. Create check run (in_progress)
      let checkRunId: number | undefined;
      try {
        const checkRun = await this.checkRunManager.create(
          owner,
          repo,
          headSha,
          {
            title: 'Cross-Repo Code Review',
            summary: `Analyzing cross-repository impact for PR #${prNumber} in group "${groupId}"...`,
          },
        );
        checkRunId = checkRun.id;
      } catch (err) {
        // Check run creation failures are non-fatal
      }

      // 4. Sync all repos in the group
      const repos = this.groupManager.getRepos(groupId) ?? [];
      const synced = await this.sync.ensureSynced(
        repos.map((r) => ({
          owner: r.owner,
          repo: r.repo,
        })),
      );

      if (synced.errors.length > 0) {
        const errMsg = synced.errors.map((e) => `${e.owner}/${e.repo}: ${e.error}`).join('; ');
        if (checkRunId) {
          await this.checkRunManager.fail(checkRunId, owner, repo, `Failed to sync repos: ${errMsg}`);
        }
        return {
          status: 'error',
          checkRunId,
          error: errMsg,
          durationMs: Date.now() - startTime,
        };
      }

      // 5. Update repo local paths in group manager
      for (const result of synced.results) {
        const repoFullName = `${result.owner}/${result.repo}`;
        try {
          // Update repo project ID for cross-repo indexer
        } catch {
          // Path update failure is non-fatal
        }
      }

      // 6. Index all repos
      await this.indexer.indexGroup(groupId);

      // 7. Fetch PR diff
      let diffs: GitDiff[] = [];
      try {
        const diffText = await this.client.getPRDiff(owner, repo, prNumber);
        diffs = this.diffParser.parseUnifiedDiff(diffText);
      } catch (err) {
        if (checkRunId) {
          await this.checkRunManager.fail(checkRunId, owner, repo, `Failed to fetch PR diff: ${err instanceof Error ? err.message : String(err)}`);
        }
        return {
          status: 'error',
          checkRunId,
          error: `Diff fetch failed: ${err instanceof Error ? err.message : String(err)}`,
          durationMs: Date.now() - startTime,
        };
      }

      // 8. Construct PullRequest object
      const pr: PullRequest = {
        number: prNumber,
        title: payload.pull_request.title,
        body: payload.pull_request.body,
        state: 'open',
        base: { ref: payload.pull_request.base.ref, sha: payload.pull_request.base.sha, repo: { id: 0, owner: owner, name: repo, fullName: fullName, defaultBranch: 'main' } as any },
        head: { ref: payload.pull_request.head.ref, sha: payload.pull_request.head.sha, repo: { id: 0, owner: owner, name: repo, fullName: fullName, defaultBranch: 'main' } as any },
        user: { login: '' },
        labels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 9. Run cross-repo PR review
      // Use source repo as fullName since that's where changes originate
      const crossRepoResult = await this.reviewEngine.reviewPRWithCrossRepoContext(
        pr,
        groupId,
        fullName,
        diffs,
      );

      // 10. Update check run with results
      if (checkRunId) {
        await this.checkRunManager.complete(checkRunId, owner, repo, crossRepoResult);
      }

      return {
        status: 'completed',
        checkRunId,
        reviewResult: crossRepoResult as unknown as Record<string, unknown>,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Find the repo group that contains a given repository.
   */
  private findGroupForRepo(repoFullName: string): string | null {
    const groups = this.groupManager.listGroups();
    for (const group of groups) {
      const repos = this.groupManager.getRepos(group.id) ?? [];
      for (const r of repos) {
        if (r.fullName === repoFullName) {
          return group.id;
        }
      }
    }
    return null;
  }
}
