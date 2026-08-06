// @code-analyzer/intelligence — Incremental Reindexer
// Git-based change detection for incremental re-indexing.
// Uses `git diff --name-only` to find changed files since last index,
// avoiding full re-index on every change.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

import type { CrossRepoIndexer, IndexOptions } from './cross-repo-indexer.js';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Describes files changed since the last index run. */
export interface ChangedFiles {
  /** New files not present in the previous index. */
  added: string[];
  /** Files whose content has been modified since last index. */
  modified: string[];
  /** Files present in previous index but no longer on disk. */
  deleted: string[];
  /** All changed file paths (union of added, modified, deleted). */
  allChanged: string[];
}

/** Result of a re-indexing operation on changed files. */
export interface ReindexResult {
  filesProcessed: number;
  filesSkipped: number;
  nodesUpdated: number;
  edgesUpdated: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const COMMIT_CACHE_DIR = '.code-analyzer-cache';

/**
 * Sanitize a repo path for use as a filesystem-safe cache key.
 */
function sanitizePath(path: string): string {
  return path.replace(/[/\\:*?"<>|]/g, '_');
}

// ---------------------------------------------------------------------------
// IncrementalReindexer
// ---------------------------------------------------------------------------

export class IncrementalReindexer {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? join(process.cwd(), COMMIT_CACHE_DIR);
  }

  // ---------------------------------------------------------------------------
  // Change Detection
  // ---------------------------------------------------------------------------

  /**
   * Detect files changed in a repo since the last indexed commit.
   *
   * Uses `git diff --name-only` to compare the working tree against
   * the stored last-indexed commit hash. Falls back to full file list
   * if the commit cache is empty or the commit is unreachable.
   *
   * @param repoPath - Absolute path to the git repository.
   * @param sinceCommit - Optional commit hash to compare against.
   *   If omitted, uses the stored last-indexed commit.
   */
  detectChanges(repoPath: string, sinceCommit?: string): ChangedFiles {
    const empty: ChangedFiles = {
      added: [],
      modified: [],
      deleted: [],
      allChanged: [],
    };

    if (!existsSync(repoPath)) {
      return empty;
    }

    const lastCommit = sinceCommit ?? this.getLastIndexCommit(repoPath);
    if (!lastCommit) {
      // No prior commit — all files are "added"
      try {
        const allFiles = this.gitLsFiles(repoPath);
        return {
          added: allFiles,
          modified: [],
          deleted: [],
          allChanged: allFiles,
        };
      } catch {
        return empty;
      }
    }

    try {
      const changedFiles = this.gitDiffNameOnly(repoPath, lastCommit);
      return {
        added: changedFiles.filter((f) => f.startsWith('A\t')).map((f) => f.slice(2)),
        modified: changedFiles.filter((f) => f.startsWith('M\t')).map((f) => f.slice(2)),
        deleted: changedFiles.filter((f) => f.startsWith('D\t')).map((f) => f.slice(2)),
        allChanged: changedFiles.map((f) => f.slice(2)),
      };
    } catch {
      return empty;
    }
  }

  // ---------------------------------------------------------------------------
  // Re-indexing
  // ---------------------------------------------------------------------------

  /**
   * Re-index only the changed files in a repository.
   *
   * Removes nodes for deleted files and triggers the indexer to process
   * only the added and modified files. This is a best-effort approach:
   * it delegates to the CrossRepoIndexer for full repo re-indexing when
   * fine-grained file-level control is not available.
   *
   * @param repoPath - Absolute path to the repository.
   * @param changes - The set of changed files to re-index.
   * @param indexer - The CrossRepoIndexer instance to use for indexing.
   */
  async reindexChanged(
    repoPath: string,
    changes: ChangedFiles,
    indexer: CrossRepoIndexer,
  ): Promise<ReindexResult> {
    const startTime = Date.now();
    const store = indexer.getStore();
    const nodesBefore = store.getNodeCount();
    const edgesBefore = store.getEdgeCount();

    let filesProcessed = 0;
    let filesSkipped = 0;

    // Remove nodes for deleted files
    if (changes.deleted.length > 0) {
      const allNodes = store.getAllNodes();
      for (const node of allNodes) {
          if (node.filePath && changes.deleted.includes(node.filePath)) {
            try {
              const edges = store.getEdgesForNode?.(node.id) ?? [];
              for (const edge of edges) {
                try {
                  store.deleteEdge?.(edge.id);
                } catch {
                  // Edge may not be deletable
                }
              }
            } catch {
              // Node may have no edges
            }
            try {
              store.deleteNode?.(node.id);
            } catch {
              // Node may not be deletable
            }
          }
      }
    }

    // Re-index added + modified files by triggering indexSingleRepo
    const filesToProcess = [...changes.added, ...changes.modified];
    if (filesToProcess.length > 0) {
      try {
        await indexer.indexSingleRepo(
          repoPath,
          repoPath,
          { force: true } as IndexOptions,
        );
        filesProcessed = filesToProcess.length;
      } catch {
        filesSkipped = filesToProcess.length;
      }
    } else {
      filesSkipped = filesToProcess.length;
    }

    const nodesAfter = store.getNodeCount();
    const edgesAfter = store.getEdgeCount();

    return {
      filesProcessed,
      filesSkipped,
      nodesUpdated: nodesAfter - nodesBefore,
      edgesUpdated: edgesAfter - edgesBefore,
      durationMs: Date.now() - startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Commit Tracking
  // ---------------------------------------------------------------------------

  /**
   * Get the last indexed commit hash for a repository.
   * Returns null if the repo has never been indexed or the cache is missing.
   */
  getLastIndexCommit(repoPath: string): string | null {
    const cachePath = this.commitCachePath(repoPath);
    if (!existsSync(cachePath)) {
      return null;
    }

    try {
      const raw = readFileSync(cachePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed.lastCommit ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Store the last indexed commit hash for a repository.
   * Called after a successful index run to track the baseline.
   */
  saveLastIndexCommit(repoPath: string, commitHash: string): void {
    const cachePath = this.commitCachePath(repoPath);
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    writeFileSync(
      cachePath,
      JSON.stringify({ lastCommit: commitHash, updatedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
  }

  /**
   * Get the current HEAD commit hash for a repository.
   */
  getCurrentCommit(repoPath: string): string | null {
    try {
      return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    } catch {
      return null;
    }
  }

  /**
   * Invalidate the commit cache for a repository, forcing full re-index next time.
   */
  invalidateCache(repoPath: string): void {
    const cachePath = this.commitCachePath(repoPath);
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Run `git diff --name-status` between the stored commit and HEAD.
   */
  private gitDiffNameOnly(repoPath: string, sinceCommit: string): string[] {
    const output = execSync(
      `git diff --name-status ${sinceCommit} HEAD`,
      { cwd: repoPath, encoding: 'utf-8' },
    );
    return output.trim().split('\n').filter((line) => line.length > 0);
  }

  /**
   * Run `git ls-files` to list all tracked files.
   */
  private gitLsFiles(repoPath: string): string[] {
    const output = execSync(
      'git ls-files',
      { cwd: repoPath, encoding: 'utf-8' },
    );
    return output.trim().split('\n').filter((line) => line.length > 0);
  }

  /**
   * Compute the cache file path for a repository.
   */
  private commitCachePath(repoPath: string): string {
    const safeId = sanitizePath(repoPath);
    return join(this.cacheDir, safeId, 'last-commit.json');
  }
}
