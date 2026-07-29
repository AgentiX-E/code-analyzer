// @code-analyzer/infra — Incremental Indexer
// Detects file-level changes between codebase scans using SHA-256 content
// hashing. Integrates with ContentCache and optionally git diff.
// Only returns files whose content actually changed — not just git-stale files.

import type { DiscoveredFile, KnowledgeGraph } from '@code-analyzer/shared';
import type { ContentCache } from './content-cache.js';
import { computeSha256 } from './content-cache.js';

/** Result of change detection for a set of discovered files. */
export interface ChangeDetectionResult {
  /** Files whose content has not changed since last index. */
  unchanged: DiscoveredFile[];
  /** Files whose content has changed, or are newly discovered. */
  changed: DiscoveredFile[];
  /** File paths that were in the previous index but no longer exist on disk. */
  removed: string[];
}

/** Change detection statistics. */
export interface ChangeDetectionStats {
  totalFiles: number;
  unchangedCount: number;
  changedCount: number;
  removedCount: number;
  cacheHitRate: number;
  durationMs: number;
}

/** Options for change detection. */
export interface ChangeDetectionOptions {
  /**
   * If provided, use git diff to pre-filter files. Git-diff-marked files
   * are still verified via SHA-256 content comparison to avoid false
   * positives from git-stale (timestamp-only) changes.
   */
  gitDiffFiles?: string[];
}

/**
 * Incremental indexer that determines which files need re-indexing by
 * comparing SHA-256 content hashes against a persistent content cache.
 *
 * ### How it works
 *
 * 1. Collect all files discovered in the current scan.
 * 2. For each file, compute its SHA-256 hash and check the ContentCache.
 * 3. Files with matching hashes are unchanged. Others are changed.
 * 4. Files in the KnowledgeGraph's fileIndex but not in the current scan
 *    are marked as removed.
 *
 * ### Integration with git diff
 *
 * When a git diff is available, it can be passed via `options.gitDiffFiles`
 * to pre-filter which files need hash comparison. Even git-diff-flagged
 * files are still verified via SHA-256 — git's mtime-based detection can
 * produce false positives (e.g., switching branches without changes).
 */
export class IncrementalIndexer {
  private readonly cache: ContentCache;
  private readonly graph: KnowledgeGraph;

  constructor(cache: ContentCache, graph: KnowledgeGraph) {
    this.cache = cache;
    this.graph = graph;
  }

  /**
   * Detect which files have changed, which are unchanged, and which have
   * been removed since the last index.
   *
   * @param allFiles - All files discovered in the current scan.
   * @param options - Optional settings for change detection.
   * @returns Categorized files.
   */
  detectChanges(
    allFiles: DiscoveredFile[],
    options?: ChangeDetectionOptions,
  ): ChangeDetectionResult {
    const unchanged: DiscoveredFile[] = [];
    const changed: DiscoveredFile[] = [];

    // Build set of current file paths for removal detection
    const currentPaths = new Set(allFiles.map((f) => f.filePath));

    // Pre-compute git-diff set if provided
    const gitDiffSet = options?.gitDiffFiles
      ? new Set(options.gitDiffFiles)
      : null;

    // Process each file
    for (const file of allFiles) {
      // Recompute hash for comparison (uses content, not file.hash from discoverer)
      const fileHash = computeSha256(file.content);

      // If git-diff is provided, only hash-compare files flagged by git
      if (gitDiffSet && !gitDiffSet.has(file.filePath)) {
        unchanged.push(file);
        continue;
      }

      // Check against content cache
      const cached = this.cache.get(file.filePath);
      if (cached && cached.sha256 === fileHash) {
        unchanged.push(file);
      } else {
        changed.push(file);
      }
    }

    // Detect removed files — files in the graph that no longer exist on disk
    const removed: string[] = [];
    for (const filePath of this.graph.fileIndex.keys()) {
      if (!currentPaths.has(filePath)) {
        removed.push(filePath);
      }
    }

    return { unchanged, changed, removed };
  }

  /**
   * Detect changes and compute statistics in one call.
   */
  detectChangesWithStats(
    allFiles: DiscoveredFile[],
    options?: ChangeDetectionOptions,
  ): { result: ChangeDetectionResult; stats: ChangeDetectionStats } {
    const startTime = Date.now();
    const result = this.detectChanges(allFiles, options);
    const durationMs = Date.now() - startTime;

    const statsBefore = this.cache.getStats();
    const total = statsBefore.hitCount + statsBefore.missCount;
    const hitRate = total > 0 ? statsBefore.hitCount / total : 0;

    const stats: ChangeDetectionStats = {
      totalFiles: allFiles.length,
      unchangedCount: result.unchanged.length,
      changedCount: result.changed.length,
      removedCount: result.removed.length,
      cacheHitRate: hitRate,
      durationMs,
    };

    return { result, stats };
  }

  /**
   * Update the content cache with the current state of discovered files.
   * Should be called after successful indexing of changed files.
   */
  updateCache(files: DiscoveredFile[]): void {
    for (const file of files) {
      this.cache.set(file.filePath, file.content);
    }
  }

  /**
   * Remove entries from the cache for files that have been deleted.
   */
  removeFromCache(filePaths: string[]): void {
    for (const filePath of filePaths) {
      this.cache.invalidate(filePath);
    }
  }

  /**
   * Compute SHA-256 hash for a content string. Convenience accessor.
   */
  computeHash(content: string): string {
    return computeSha256(content);
  }

  /**
   * Get the underlying content cache.
   */
  getCache(): ContentCache {
    return this.cache;
  }

  /**
   * Get the underlying knowledge graph.
   */
  getGraph(): KnowledgeGraph {
    return this.graph;
  }
}
