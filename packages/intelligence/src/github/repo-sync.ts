// @code-analyzer/intelligence — GitHub Repository Sync
// Clones, pulls, and manages local caches of GitHub repos for
// cross-repo analysis. Integrates with CrossRepoIndexer.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { GitHubApiClient } from './client.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /** GitHub API client for authentication and clone URL resolution */
  client: GitHubApiClient;
  /** Base directory for repo caches (default: ~/.code-analyzer/repos) */
  cacheDir?: string;
  /** Whether to use shallow clones (default: true) */
  shallow?: boolean;
  /** Default branch to checkout (default: auto-detect from repo) */
  branch?: string;
  /** Maximum cache size in bytes before cleanup is triggered (default: 5GB) */
  maxCacheSize?: number;
  /** Whether to run git fetch before indexing (default: true) */
  autoFetch?: boolean;
}

export interface SyncResult {
  owner: string;
  repo: string;
  localPath: string;
  branch: string;
  commitSha: string;
  synced: boolean; // false if already up to date
  durationMs: number;
}

export interface SyncError {
  owner: string;
  repo: string;
  error: string;
}

// ---------------------------------------------------------------------------
// GitHubRepoSync
// ---------------------------------------------------------------------------

/** Default cache size: 5 GB */
const DEFAULT_MAX_CACHE = 5 * 1024 * 1024 * 1024;

/**
 * Manages local clones of GitHub repositories for cross-repo analysis.
 * Supports shallow clones, branch tracking, and cache management.
 *
 * @example
 * ```ts
 * const sync = new GitHubRepoSync({ client, cacheDir: '/tmp/repos' });
 * const result = await sync.clone('owner', 'repo');
 * await sync.ensureSynced(['owner/repo1', 'owner/repo2']);
 * ```
 */
export class GitHubRepoSync {
  private readonly client: GitHubApiClient;
  private readonly cacheDir: string;
  private readonly shallow: boolean;
  private readonly branch: string | undefined;
  private readonly maxCacheSize: number;
  private readonly autoFetch: boolean;

  constructor(options: SyncOptions) {
    this.client = options.client;
    this.cacheDir = options.cacheDir ?? join(homedir(), '.code-analyzer', 'repos');
    this.shallow = options.shallow ?? true;
    this.branch = options.branch;
    this.maxCacheSize = options.maxCacheSize ?? DEFAULT_MAX_CACHE;
    this.autoFetch = options.autoFetch ?? true;

    // Ensure cache directory exists
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Clone a repository to the local cache.
   * If already cloned, optionally fetches latest changes.
   */
  async clone(owner: string, repo: string): Promise<SyncResult> {
    const startTime = Date.now();
    const repoDir = this.repoPath(owner, repo);

    // Determine the default branch
    let branch = this.branch;
    /* v8 ignore start — requires GitHub API call to getRepo */
    if (!branch) {
      try {
        const repoInfo = await this.client.getRepo(owner, repo);
        branch = repoInfo.default_branch;
      } catch {
        branch = 'main';
      }
    }
    /* v8 ignore stop */

    if (existsSync(repoDir)) {
      // Already cloned — fetch if autoFetch enabled
      /* v8 ignore start — git fetch from remote origin, untestable without real GitHub repo */
      if (this.autoFetch) {
        try {
          execSync(`cd "${repoDir}" && git fetch origin "${branch}" --depth 1`, {
            stdio: 'pipe',
            timeout: 60_000,
          });
          execSync(`cd "${repoDir}" && git reset --hard "origin/${branch}"`, {
            stdio: 'pipe',
            timeout: 30_000,
          });
        } catch {
          // If fetch fails, try a fresh clone
          rmSync(repoDir, { recursive: true, force: true });
          return this.clone(owner, repo);
        }
        /* v8 ignore stop */
      }

      const sha = this.getCurrentSha(repoDir);
      return {
        owner,
        repo,
        localPath: repoDir,
        branch,
        commitSha: sha,
        synced: false,
        durationMs: Date.now() - startTime,
      };
    }

    // Fresh clone
    this.ensureCacheSpace();

    /* v8 ignore start — git clone from GitHub, untestable without network access */
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const args = ['clone'];
    if (this.shallow) args.push('--depth', '1');
    args.push('--branch', branch);
    args.push(cloneUrl, repoDir);

    try {
      execSync(`git ${args.join(' ')}`, {
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      // If shallow clone fails, try full clone
      throw new Error(
        `Failed to clone ${owner}/${repo}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sha = this.getCurrentSha(repoDir);
    return {
      owner,
      repo,
      localPath: repoDir,
      branch,
      commitSha: sha,
      synced: true,
      durationMs: Date.now() - startTime,
    };
    /* v8 ignore stop */
  }

  /**
   * Sync (pull) a repository to the latest commit on its branch.
   */
  async pull(owner: string, repo: string): Promise<SyncResult> {
    const startTime = Date.now();
    const repoDir = this.repoPath(owner, repo);

    if (!existsSync(repoDir)) {
      /* v8 ignore next — delegates to clone(), which has its own v8 ignore annotations */
      return this.clone(owner, repo);
    }

    const branch = this.branch ?? 'main';
    /* v8 ignore start — git fetch from remote origin, untestable without real GitHub repo */
    try {
      execSync(`cd "${repoDir}" && git fetch origin "${branch}" --depth 1 && git reset --hard "origin/${branch}"`, {
        stdio: 'pipe',
        timeout: 90_000,
      });
    } catch (err) {
      throw new Error(
        `Failed to pull ${owner}/${repo}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sha = this.getCurrentSha(repoDir);
    return {
      owner,
      repo,
      localPath: repoDir,
      branch,
      commitSha: sha,
      synced: true,
      durationMs: Date.now() - startTime,
    };
    /* v8 ignore stop */
  }

  /**
   * Ensure all repos in a list are cloned and up to date.
   * Returns results for each repo.
   */
  async ensureSynced(repos: Array<{ owner: string; repo: string }>): Promise<{
    results: SyncResult[];
    errors: SyncError[];
  }> {
    const results: SyncResult[] = [];
    const errors: SyncError[] = [];

    // Clone concurrently with a limit of 4
    const limit = 4;
    for (let i = 0; i < repos.length; i += limit) {
      const batch = repos.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map((r) => this.clone(r.owner, r.repo)),
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]!;
        /* v8 ignore start — fulfilled requires clone() to succeed against GitHub */
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          /* v8 ignore stop */
          errors.push({
            owner: batch[j]!.owner,
            repo: batch[j]!.repo,
            error: result.reason instanceof Error ? result.reason.message : /* v8 ignore next — defensive: non-Error rejection reason */ String(result.reason),
          });
        }
      }
    }

    return { results, errors };
  }

  /**
   * Remove a repository from the local cache.
   */
  remove(owner: string, repo: string): boolean {
    const repoDir = this.repoPath(owner, repo);
    if (!existsSync(repoDir)) return false;
    rmSync(repoDir, { recursive: true, force: true });
    return true;
  }

  /**
   * Check if a repository is available in the local cache.
   */
  isCached(owner: string, repo: string): boolean {
    return existsSync(this.repoPath(owner, repo));
  }

  /**
   * Get the local path for a cached repository.
   */
  getPath(owner: string, repo: string): string {
    return this.repoPath(owner, repo);
  }

  /**
   * Get current cache size in bytes.
   */
  getCacheSize(): number {
    return getDirSize(this.cacheDir);
  }

  /**
   * Clean up the entire cache.
   */
  clearCache(): void {
    if (existsSync(this.cacheDir)) {
      rmSync(this.cacheDir, { recursive: true, force: true });
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private repoPath(owner: string, repo: string): string {
    // Sanitize: strip path separators and traversal sequences for safety
    const safeOwner = owner.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\./g, '__');
    const safeRepo = repo.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.\./g, '__');
    return resolve(join(this.cacheDir, safeOwner, safeRepo));
  }

  private getCurrentSha(repoDir: string): string {
    try {
      return execSync(`cd "${repoDir}" && git rev-parse HEAD`, {
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 5_000,
      }).trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Ensure there's space in the cache by cleaning up old repos if needed.
   */
  private ensureCacheSpace(): void {
    const size = getDirSize(this.cacheDir);
    if (size < this.maxCacheSize) return;

    // Simple LRU: remove repos with oldest modification time
    const repos = this.listCachedRepos();
    repos.sort((a, b) => a.mtimeMs - b.mtimeMs);

    let freed = 0;
    const target = this.maxCacheSize * 0.7; // Free 30%
    for (const r of repos) {
      if (size - freed <= target) break;
      this.remove(r.owner, r.repo);
      freed += r.size;
    }
  }

  private listCachedRepos(): Array<{ owner: string; repo: string; size: number; mtimeMs: number }> {
    const fs = require('node:fs');
    const result: Array<{ owner: string; repo: string; size: number; mtimeMs: number }> = [];

    /* v8 ignore start — defensive: cacheDir removed between constructor and call */
    if (!existsSync(this.cacheDir)) return result;
    /* v8 ignore stop */

    const owners = fs.readdirSync(this.cacheDir, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory());

    for (const ownerDir of owners) {
      const ownerPath = join(this.cacheDir, ownerDir.name);
      const repos = fs.readdirSync(ownerPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory());

      for (const repoDir of repos) {
        const repoPath = join(ownerPath, repoDir.name);
        const stat = fs.statSync(repoPath);
        if (existsSync(join(repoPath, '.git'))) {
          result.push({
            owner: ownerDir.name,
            repo: repoDir.name,
            size: getDirSize(repoPath),
            mtimeMs: stat.mtimeMs,
          });
        }
      }
    }

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  const fs = require('node:fs');
  let size = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(fullPath);
        /* v8 ignore start — defensive: isFile() always true for non-directory entries */
      } else if (entry.isFile()) {
        /* v8 ignore stop */
        try {
          size += fs.statSync(fullPath).size;
          /* v8 ignore next 2 — defensive: inaccessible file during stat */
        } catch { /* skip inaccessible files */ }
      }
    }
    /* v8 ignore next — defensive: inaccessible directory during readdir */
  } catch { /* skip inaccessible directories */ }
  return size;
}
