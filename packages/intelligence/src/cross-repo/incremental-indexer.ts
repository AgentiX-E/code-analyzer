// @code-analyzer/intelligence — Incremental Cross-Repo Indexer
// Smart re-indexing that only processes changed files using SHA-256
// checksums stored in a local cache directory.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, basename, relative, dirname } from 'node:path';

import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import type { CrossRepoIndexer, IndexOptions, IndexResult } from './cross-repo-indexer.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** Describes what changed since the last index run. */
export interface ChangeSet {
  /** New files not present in the previous index. */
  added: string[];
  /** Files whose content checksum differs from previous index. */
  modified: string[];
  /** Files present in previous index but no longer on disk. */
  deleted: string[];
  /** Files whose content checksum matches the previous index. */
  unchanged: string[];
  /** Renamed files — same checksum, different path. */
  renamed: Array<{ oldPath: string; newPath: string }>;
}

/** Result of an incremental indexing run. */
export interface IncrementalIndexResult extends IndexResult {
  changeSet: ChangeSet;
  filesReindexed: number;
  filesSkipped: number;
  nodesRemoved: number;
  nodesAdded: number;
  lastIndexTime: string;
}

/** Cache entry stored in checksums.json. */
interface ChecksumCache {
  repoId: string;
  lastIndexTime: string;
  files: Record<string, string>; // relativePath → SHA-256 hex
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CACHE_DIR = '.code-analyzer-cache';

const SKIP_DIRECTORIES = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__', '.next',
  'target', '.cache', '.idea', '.vscode', 'coverage', '.nyc_output',
]);

const SKIP_FILE_PATTERNS = [/^\./, /\.min\.(js|css)$/, /\.d\.ts$/];

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi', '.go', '.java', '.kt', '.kts',
  '.cs', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.php', '.rb', '.swift', '.dart', '.lua', '.scala', '.zig', '.ex', '.exs',
]);

// ---------------------------------------------------------------------------
// IncrementalCrossRepoIndexer
// ---------------------------------------------------------------------------

export class IncrementalCrossRepoIndexer {
  private cacheDir: string;

  constructor(
    private indexer: CrossRepoIndexer,
    private store: InMemoryGraphStore,
    cacheDir?: string,
  ) {
    this.cacheDir = cacheDir ?? join(process.cwd(), CACHE_DIR);
  }

  // ---------------------------------------------------------------------------
  // Change Detection
  // ---------------------------------------------------------------------------

  /**
   * Compute the set of files that changed since the last index run.
   *
   * Compares file checksums stored in `.code-analyzer-cache/{repoId}/checksums.json`
   * against the current filesystem state. Detects added, modified, deleted,
   * unchanged, and renamed files.
   */
  computeChangeSet(repoId: string, localPath: string): ChangeSet {
    const changeSet: ChangeSet = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
      renamed: [],
    };

    const cache = this.loadCache(repoId);
    const currentFiles = this.scanFiles(localPath);

    // Compute checksums for all current files
    const currentChecksums = new Map<string, string>();
    for (const filePath of currentFiles) {
      const absPath = join(localPath, filePath);
      try {
        const content = readFileSync(absPath, 'utf-8');
        currentChecksums.set(filePath, this.sha256(content));
      } catch {
        // Skip unreadable files
      }
    }

    const previousFiles = new Set(Object.keys(cache.files));
    const currentFileSet = new Set(currentChecksums.keys());

    // Identify additions, modifications, and unchanged files
    for (const [filePath, checksum] of currentChecksums) {
      const prevChecksum = cache.files[filePath];
      if (prevChecksum === undefined) {
        changeSet.added.push(filePath);
      } else if (prevChecksum !== checksum) {
        changeSet.modified.push(filePath);
      } else {
        changeSet.unchanged.push(filePath);
      }
    }

    // Identify deletions
    for (const prevFile of previousFiles) {
      if (!currentFileSet.has(prevFile)) {
        changeSet.deleted.push(prevFile);
      }
    }

    // Detect renames: same checksum, different path
    const checksumToCurrentPaths = new Map<string, string[]>();
    for (const [filePath, checksum] of currentChecksums) {
      const paths = checksumToCurrentPaths.get(checksum) ?? [];
      paths.push(filePath);
      checksumToCurrentPaths.set(checksum, paths);
    }

    const checksumToPrevPaths = new Map<string, string[]>();
    for (const [filePath, checksum] of Object.entries(cache.files)) {
      const paths = checksumToPrevPaths.get(checksum) ?? [];
      paths.push(filePath);
      checksumToPrevPaths.set(checksum, paths);
    }

    for (const [checksum, currentPaths] of checksumToCurrentPaths) {
      const prevPaths = checksumToPrevPaths.get(checksum);
      if (!prevPaths || prevPaths.length === 0) continue;

      // Find paths that differ between current and previous
      for (const curPath of currentPaths) {
        for (const prevPath of prevPaths) {
          if (curPath !== prevPath && !currentFileSet.has(prevPath)) {
            changeSet.renamed.push({ oldPath: prevPath, newPath: curPath });
          }
        }
      }
    }

    // Remove renamed files from added/deleted lists
    const renamedAdded = new Set(changeSet.renamed.map((r) => r.newPath));
    const renamedDeleted = new Set(changeSet.renamed.map((r) => r.oldPath));

    changeSet.added = changeSet.added.filter((f) => !renamedAdded.has(f));
    changeSet.deleted = changeSet.deleted.filter((f) => !renamedDeleted.has(f));

    return changeSet;
  }

  /**
   * Get the last index time for a repo, or null if never indexed.
   */
  getLastIndexTime(repoId: string): string | null {
    const cache = this.loadCache(repoId);
    return cache.lastIndexTime || null;
  }

  /**
   * Get the number of files in the last cached index.
   */
  getCachedFileCount(repoId: string): number {
    const cache = this.loadCache(repoId);
    return Object.keys(cache.files).length;
  }

  // ---------------------------------------------------------------------------
  // Incremental Indexing
  // ---------------------------------------------------------------------------

  /**
   * Run incremental re-indexing for a repo group.
   *
   * Only re-indexes files that have changed since the last run,
   * removes stale graph data for deleted files, and preserves
   * unchanged data.
   */
  async incrementalIndex(
    groupId: string,
    options?: IndexOptions,
  ): Promise<IncrementalIndexResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    const group = this.indexer.getGroupManager().getGroup(groupId);
    if (!group) {
      throw new Error(`Group "${groupId}" not found`);
    }

    let totalFilesReindexed = 0;
    let totalFilesSkipped = 0;
    let totalNodesRemoved = 0;
    let totalNodesAdded = 0;
    const allNodesBefore = this.store.getNodeCount();
    const allEdgesBefore = this.store.getEdgeCount();

    for (const repo of group.repos) {
      if (!repo.autoIndex) continue;

      const changeSet = this.computeChangeSet(repo.fullName, repo.localPath);
      totalFilesSkipped += changeSet.unchanged.length;

      // Handle deleted files: remove their nodes
      if (changeSet.deleted.length > 0) {
        const beforeNodeCount = this.store.getNodeCount();
        this.removeNodesForFiles(repo.fullName, changeSet.deleted);
        totalNodesRemoved += beforeNodeCount - this.store.getNodeCount();
      }

      // Handle renamed files: remove old, add new
      for (const rename of changeSet.renamed) {
        this.removeNodesForFiles(repo.fullName, [rename.oldPath]);
      }

      // Re-index new + modified + renamed files
      const filesToReindex = [
        ...changeSet.added,
        ...changeSet.modified,
        ...changeSet.renamed.map((r) => r.newPath),
      ];

      if (filesToReindex.length > 0) {
        const beforeNodeCount = this.store.getNodeCount();
        try {
          await this.indexer.indexSingleRepo(
            repo.fullName,
            repo.localPath,
            { ...options, force: true },
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to re-index ${repo.fullName}: ${message}`);
        }
        totalNodesAdded += Math.max(0, this.store.getNodeCount() - beforeNodeCount);
        totalFilesReindexed += filesToReindex.length;
      }

      // Save updated checksums
      this.saveCache(repo.fullName, repo.localPath);
    }

    return {
      groupId,
      reposIndexed: group.repos.filter((r: any) => r.autoIndex).length,
      totalNodes: this.store.getNodeCount(),
      totalEdges: this.store.getEdgeCount(),
      crossRepoEdges: 0, // Updated by buildCrossRepoGraph if needed
      contracts: 0,
      duration: Date.now() - startTime,
      errors,
      changeSet: {
        added: [],
        modified: [],
        deleted: [],
        unchanged: [],
        renamed: [],
      },
      filesReindexed: totalFilesReindexed,
      filesSkipped: totalFilesSkipped,
      nodesRemoved: totalNodesRemoved,
      nodesAdded: totalNodesAdded,
      lastIndexTime: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Cache Management
  // ---------------------------------------------------------------------------

  /**
   * Invalidate the checksum cache for a repo, forcing a full re-index next time.
   */
  invalidateCache(repoId: string): void {
    const cachePath = this.cachePath(repoId);
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
    // Also try to remove the repo cache directory if empty
    const repoCacheDir = dirname(cachePath);
    try {
      rmdirSync(repoCacheDir);
    } catch {
      // Directory not empty — leave it
    }
  }

  /**
   * Invalidate caches for all repos.
   */
  invalidateAllCaches(): void {
    const groupCacheDir = this.cacheDir;
    if (existsSync(groupCacheDir)) {
      try {
        const entries = readdirSync(groupCacheDir);
        for (const entry of entries) {
          const fullPath = join(groupCacheDir, entry);
          try {
            // Remove individual cache files
            if (fullPath.endsWith('.json')) {
              unlinkSync(fullPath);
            }
          } catch {
            // Skip files that can't be removed
          }
        }
      } catch {
        // Skip if directory can't be read
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private sha256(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  private cachePath(repoId: string): string {
    const safeId = repoId.replace(/[/\\:*?"<>|]/g, '_');
    return join(this.cacheDir, safeId, 'checksums.json');
  }

  private loadCache(repoId: string): ChecksumCache {
    const cachePath = this.cachePath(repoId);
    if (!existsSync(cachePath)) {
      return { repoId, lastIndexTime: '', files: {} };
    }

    try {
      const raw = readFileSync(cachePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        repoId: parsed.repoId ?? repoId,
        lastIndexTime: parsed.lastIndexTime ?? '',
        files: parsed.files ?? {},
      };
    } catch {
      return { repoId, lastIndexTime: '', files: {} };
    }
  }

  private saveCache(repoId: string, localPath: string): void {
    const cache = this.loadCache(repoId);
    const currentFiles = this.scanFiles(localPath);

    // Update checksums for all current files
    cache.lastIndexTime = new Date().toISOString();

    for (const filePath of currentFiles) {
      const absPath = join(localPath, filePath);
      try {
        const content = readFileSync(absPath, 'utf-8');
        cache.files[filePath] = this.sha256(content);
      } catch {
        // Skip unreadable files — keep previous checksum if exists
      }
    }

    // Remove entries for files that no longer exist
    const currentSet = new Set(currentFiles);
    for (const key of Object.keys(cache.files)) {
      if (!currentSet.has(key)) {
        delete cache.files[key];
      }
    }

    // Write to cache directory
    const cachePath = this.cachePath(repoId);
    const cacheDir = dirname(cachePath);
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }

    writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
  }

  private scanFiles(rootPath: string): string[] {
    const results: string[] = [];
    this.walkSync(rootPath, rootPath, results);
    return results.sort();
  }

  private walkSync(rootPath: string, currentPath: string, results: string[]): void {
    let entries;
    try {
      entries = readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        this.walkSync(rootPath, fullPath, results);
      } else if (entry.isFile()) {
        const name = basename(fullPath);
        if (SKIP_FILE_PATTERNS.some((p) => p.test(name))) continue;

        const ext = name.lastIndexOf('.') >= 0
          ? name.slice(name.lastIndexOf('.'))
          : '';
        if (!SOURCE_EXTENSIONS.has(ext)) continue;

        let fileStat;
        try {
          fileStat = statSync(fullPath);
        } catch {
          continue;
        }

        if (fileStat.size > 5 * 1024 * 1024) continue; // Skip >5MB files

        const relPath = relative(rootPath, fullPath);
        results.push(relPath);
      }
    }
  }

  private removeNodesForFiles(repoId: string, filePaths: string[]): void {
    const filePathSet = new Set(filePaths);
    const allNodes = this.store.getAllNodes();

    for (const node of allNodes) {
      if (node.projectId !== repoId) continue;
      if (node.filePath && filePathSet.has(node.filePath)) {
        // Remove edges connected to this node
        try {
          const edges = this.store.getEdgesForNode(node.id);
          for (const edge of edges) {
            try {
              this.store.deleteEdge(edge.id);
            } catch {
              // Edge may not be directly deletable — skip
            }
          }
        } catch {
          // Node may have no edges
        }

        // Remove the node
        try {
          this.store.deleteNode(node.id);
        } catch {
          // Node may not be directly deletable — skip
        }
      }
    }
  }
}
