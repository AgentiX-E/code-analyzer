// @code-analyzer/intelligence — GitHub Integration Module
// Full GitHub API integration for cross-repo PR review and analysis.

export { GitHubApiClient, GitHubApiError, GitHubRateLimitError } from './client.js';
export type {
  GitHubAuth,
  GitHubRepo,
  GitHubPR,
  GitHubPRFile,
  GitHubCheckRun,
  GitHubAnnotation,
  GitHubBranch,
  GitHubWebhook,
  RateLimitInfo,
  GraphQLResponse,
  RepoSearchResult,
  CreateCheckRunParams,
  UpdateCheckRunParams,
} from './client.js';

export { GitHubRepoSync } from './repo-sync.js';
export type { SyncOptions, SyncResult, SyncError } from './repo-sync.js';

export { GitHubCheckRunManager } from './check-run.js';
export type { CheckRunOptions, CheckRunResult } from './check-run.js';

export { CrossRepoWebhookBridge } from './cross-repo-bridge.js';
export type { WebhookPayload, BridgeResult } from './cross-repo-bridge.js';
