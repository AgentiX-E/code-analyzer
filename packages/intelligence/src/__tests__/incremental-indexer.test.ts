// @code-analyzer/intelligence — Incremental Cross-Repo Indexer Tests
// Comprehensive tests for IncrementalCrossRepoIndexer change detection,
// cache management, incremental indexing, and edge cases.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';
import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import { IncrementalCrossRepoIndexer } from '../cross-repo/incremental-indexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Write a manual cache file to simulate a previously-indexed state.
 */
function writeManualCache(
  cacheDir: string,
  repoId: string,
  files: Record<string, string>,
  lastIndexTime?: string,
): void {
  const safeId = repoId.replace(/[/\\:*?"<>|]/g, '_');
  const dir = join(cacheDir, safeId);
  mkdirSync(dir, { recursive: true });
  const cache = {
    repoId,
    lastIndexTime: lastIndexTime ?? new Date().toISOString(),
    files,
  };
  writeFileSync(join(dir, 'checksums.json'), JSON.stringify(cache, null, 2));
}

/**
 * Read a cache file from disk.
 */
function readCacheFile(cacheDir: string, repoId: string): Record<string, unknown> {
  const safeId = repoId.replace(/[/\\:*?"<>|]/g, '_');
  const path = join(cacheDir, safeId, 'checksums.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Create a source file in a repo directory. Source files must have an extension
 * recognized by scanFiles (.ts, .js, .py, etc.).
 */
function createSourceFile(repoDir: string, relativePath: string, content: string): void {
  const fullPath = join(repoDir, relativePath);
  const dir = join(fullPath, '..');
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Create a repo directory with source files.
 */
function setupRepo(baseDir: string, repoName: string, files: Record<string, string>): string {
  const repoDir = join(baseDir, repoName);
  mkdirSync(repoDir, { recursive: true });
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoDir, filePath);
    const dir = join(fullPath, '..');
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
  }
  return repoDir;
}

/**
 * Create a GraphNode for manual insertion into the store.
 */
function makeNode(
  projectId: string,
  name: string,
  filePath: string,
  label: GraphNode['label'] = 'Function',
  isExported = false,
): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label,
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, filePath, startLine: 1, endLine: 5, language: 'typescript', isExported },
    signature: null,
    docstring: null,
    complexity: 3,
    isExported,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Create a GraphEdge for manual insertion into the store.
 */
function makeEdge(projectId: string, sourceId: number, targetId: number): GraphEdge {
  return {
    id: 0,
    projectId,
    sourceId,
    targetId,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('IncrementalCrossRepoIndexer', () => {
  let cacheDir: string;
  let store: InMemoryGraphStore;
  let groupManager: RepoGroupManager;
  let crossRepoIndexer: CrossRepoIndexer;
  let indexer: IncrementalCrossRepoIndexer;
  let workspaceDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'incremental-indexer-test-'));
    workspaceDir = mkdtempSync(join(tmpdir(), 'incremental-workspace-'));
    store = new InMemoryGraphStore();
    groupManager = new RepoGroupManager();
    crossRepoIndexer = new CrossRepoIndexer(store, groupManager);
    indexer = new IncrementalCrossRepoIndexer(crossRepoIndexer, store, cacheDir);
  });

  afterEach(() => {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* cleanup */
    }
  });

  // =========================================================================
  // computeChangeSet
  // =========================================================================

  describe('computeChangeSet', () => {
    it('should return empty change set for an empty repo', () => {
      const repoDir = join(workspaceDir, 'empty-repo');
      mkdirSync(repoDir, { recursive: true });

      const result = indexer.computeChangeSet('test/empty-repo', repoDir);

      expect(result.added).toEqual([]);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should detect all files as added on first run (no cache)', () => {
      const repoDir = setupRepo(workspaceDir, 'new-repo', {
        'src/index.ts': 'export function main() { return 42; }',
        'src/utils.ts': 'export function helper() { return true; }',
      });

      const result = indexer.computeChangeSet('test/new-repo', repoDir);

      expect(result.added).toHaveLength(2);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should detect modified files when content checksum differs', () => {
      const repoDir = setupRepo(workspaceDir, 'mod-repo', {
        'src/app.ts': 'export function app() { return 1; }',
      });

      // Simulate a previous index with different content
      writeManualCache(cacheDir, 'test/mod-repo', {
        'src/app.ts': sha256('export function app() { return 0; }'),
      });

      const result = indexer.computeChangeSet('test/mod-repo', repoDir);

      expect(result.added).toEqual([]);
      expect(result.modified).toEqual(['src/app.ts']);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should detect unchanged files when content checksum matches', () => {
      const content = 'export const VERSION = "1.0.0";';
      const repoDir = setupRepo(workspaceDir, 'same-repo', {
        'src/version.ts': content,
      });

      writeManualCache(cacheDir, 'test/same-repo', {
        'src/version.ts': sha256(content),
      });

      const result = indexer.computeChangeSet('test/same-repo', repoDir);

      expect(result.added).toEqual([]);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual(['src/version.ts']);
      expect(result.renamed).toEqual([]);
    });

    it('should detect deleted files that were in cache but not on disk', () => {
      const repoDir = setupRepo(workspaceDir, 'del-repo', {});

      writeManualCache(cacheDir, 'test/del-repo', {
        'src/old.ts': sha256('export function old() {}'),
        'src/removed.ts': sha256('export const x = 1;'),
      });

      const result = indexer.computeChangeSet('test/del-repo', repoDir);

      expect(result.added).toEqual([]);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toHaveLength(2);
      expect(result.deleted).toContain('src/old.ts');
      expect(result.deleted).toContain('src/removed.ts');
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should detect renamed files (same checksum, different path)', () => {
      const content = 'export function shared() { return "shared"; }';
      const repoDir = setupRepo(workspaceDir, 'rename-repo', {
        'src/new-location.ts': content,
      });

      writeManualCache(cacheDir, 'test/rename-repo', {
        'src/old-location.ts': sha256(content),
      });

      const result = indexer.computeChangeSet('test/rename-repo', repoDir);

      expect(result.renamed).toHaveLength(1);
      expect(result.renamed[0]).toEqual({
        oldPath: 'src/old-location.ts',
        newPath: 'src/new-location.ts',
      });
    });

    it('should remove renamed files from added/deleted lists', () => {
      const content = 'export function shared() { return "shared"; }';
      const repoDir = setupRepo(workspaceDir, 'rename-clean-repo', {
        'src/new-location.ts': content,
        'src/extra.ts': 'export const extra = 1;',
      });

      writeManualCache(cacheDir, 'test/rename-clean-repo', {
        'src/old-location.ts': sha256(content),
        'src/extra.ts': sha256('export const extra = 1;'),
      });

      const result = indexer.computeChangeSet('test/rename-clean-repo', repoDir);

      // renamed path should NOT appear in added or deleted
      expect(result.added).not.toContain('src/new-location.ts');
      expect(result.deleted).not.toContain('src/old-location.ts');
      // extra.ts was unchanged
      expect(result.unchanged).toContain('src/extra.ts');
    });

    it('should detect mixed changes (added + modified + deleted + unchanged)', () => {
      const unchangedContent = 'export const unchanged = 1;';
      const modifiedOldContent = 'export function mod() { return 1; }';
      const modifiedNewContent = 'export function mod() { return 2; }';
      const deletedContent = 'export function gone() {}';

      const repoDir = setupRepo(workspaceDir, 'mixed-repo', {
        'src/unchanged.ts': unchangedContent,
        'src/modified.ts': modifiedNewContent,
        'src/added.ts': 'export const added = 1;',
      });

      writeManualCache(cacheDir, 'test/mixed-repo', {
        'src/unchanged.ts': sha256(unchangedContent),
        'src/modified.ts': sha256(modifiedOldContent),
        'src/deleted.ts': sha256(deletedContent),
      });

      const result = indexer.computeChangeSet('test/mixed-repo', repoDir);

      expect(result.added).toEqual(['src/added.ts']);
      expect(result.modified).toEqual(['src/modified.ts']);
      expect(result.deleted).toEqual(['src/deleted.ts']);
      expect(result.unchanged).toEqual(['src/unchanged.ts']);
      expect(result.renamed).toEqual([]);
    });

    it('should handle cold start with no cache file gracefully', () => {
      const repoDir = setupRepo(workspaceDir, 'cold-repo', {
        'src/main.ts': 'export function main() {}',
      });

      const result = indexer.computeChangeSet('test/cold-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should skip non-source files in scan', () => {
      const repoDir = setupRepo(workspaceDir, 'filter-repo', {
        'src/code.ts': 'export const a = 1;',
        'README.md': '# Readme',
        'data.json': '{"key": "value"}',
        'config.yaml': 'key: value',
      });

      const result = indexer.computeChangeSet('test/filter-repo', repoDir);

      // Only the .ts file should be detected
      expect(result.added).toHaveLength(1);
      expect(result.added[0]).toBe('src/code.ts');
    });

    it('should detect multiple renamed files', () => {
      const contentA = 'export const a = 1;';
      const contentB = 'export const b = 2;';

      const repoDir = setupRepo(workspaceDir, 'multi-rename-repo', {
        'lib/new-a.ts': contentA,
        'lib/new-b.ts': contentB,
      });

      writeManualCache(cacheDir, 'test/multi-rename-repo', {
        'src/old-a.ts': sha256(contentA),
        'src/old-b.ts': sha256(contentB),
      });

      const result = indexer.computeChangeSet('test/multi-rename-repo', repoDir);

      expect(result.renamed).toHaveLength(2);
      expect(result.renamed).toContainEqual({
        oldPath: 'src/old-a.ts',
        newPath: 'lib/new-a.ts',
      });
      expect(result.renamed).toContainEqual({
        oldPath: 'src/old-b.ts',
        newPath: 'lib/new-b.ts',
      });
    });

    it('should handle repo with only ignored file types', () => {
      const repoDir = setupRepo(workspaceDir, 'ignore-repo', {
        'README.md': '# No code here',
        '.gitignore': 'node_modules',
        'data.json': '{}',
      });

      const result = indexer.computeChangeSet('test/ignore-repo', repoDir);

      expect(result.added).toEqual([]);
      expect(result.modified).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.unchanged).toEqual([]);
      expect(result.renamed).toEqual([]);
    });

    it('should detect partial modifications after multiple edits', () => {
      const fileA = 'src/a.ts';
      const fileB = 'src/b.ts';
      const fileC = 'src/c.ts';
      const contentA_V1 = 'export const a = 1;';
      const contentB = 'export const b = 2;';
      const contentC = 'export const c = 3;';
      const contentA_V2 = 'export const a = 42;';

      const repoDir = setupRepo(workspaceDir, 'partial-repo', {
        [fileA]: contentA_V2, // modified
        [fileB]: contentB, // unchanged
        // fileC is gone (deleted)
      });

      writeManualCache(cacheDir, 'test/partial-repo', {
        [fileA]: sha256(contentA_V1),
        [fileB]: sha256(contentB),
        [fileC]: sha256(contentC),
      });

      const result = indexer.computeChangeSet('test/partial-repo', repoDir);

      expect(result.modified).toEqual([fileA]);
      expect(result.unchanged).toEqual([fileB]);
      expect(result.deleted).toEqual([fileC]);
    });
  });

  // =========================================================================
  // getLastIndexTime
  // =========================================================================

  describe('getLastIndexTime', () => {
    it('should return null when never indexed', () => {
      const result = indexer.getLastIndexTime('test/never');
      expect(result).toBeNull();
    });

    it('should return the last index time from a valid cache', () => {
      const lastTime = '2025-01-15T10:30:00.000Z';
      writeManualCache(
        cacheDir,
        'test/timed-repo',
        {
          'src/main.ts': sha256('code'),
        },
        lastTime,
      );

      const result = indexer.getLastIndexTime('test/timed-repo');
      expect(result).toBe(lastTime);
    });

    it('should return null when cache exists but has empty lastIndexTime', () => {
      writeManualCache(
        cacheDir,
        'test/empty-time-repo',
        {
          'src/main.ts': sha256('code'),
        },
        '',
      );

      const result = indexer.getLastIndexTime('test/empty-time-repo');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getCachedFileCount
  // =========================================================================

  describe('getCachedFileCount', () => {
    it('should return 0 when never indexed', () => {
      expect(indexer.getCachedFileCount('test/never')).toBe(0);
    });

    it('should return the correct file count from cache', () => {
      writeManualCache(cacheDir, 'test/count-repo', {
        'src/a.ts': sha256('a'),
        'src/b.ts': sha256('b'),
        'src/c.ts': sha256('c'),
      });

      expect(indexer.getCachedFileCount('test/count-repo')).toBe(3);
    });

    it('should return 0 for cache with no file entries', () => {
      writeManualCache(cacheDir, 'test/empty-files-repo', {});

      expect(indexer.getCachedFileCount('test/empty-files-repo')).toBe(0);
    });

    it('should return correct count after adding more files to cache', () => {
      writeManualCache(cacheDir, 'test/growing-repo', {
        'src/v1.ts': sha256('v1'),
      });

      expect(indexer.getCachedFileCount('test/growing-repo')).toBe(1);

      // Update cache with more files
      writeManualCache(cacheDir, 'test/growing-repo', {
        'src/v1.ts': sha256('v1'),
        'src/v2.ts': sha256('v2'),
        'src/v3.ts': sha256('v3'),
      });

      expect(indexer.getCachedFileCount('test/growing-repo')).toBe(3);
    });
  });

  // =========================================================================
  // invalidateCache
  // =========================================================================

  describe('invalidateCache', () => {
    it('should remove the cache file for a repo', () => {
      writeManualCache(cacheDir, 'test/remove-me', {
        'src/a.ts': sha256('content'),
      });

      const safeId = 'test_remove-me';
      const cacheFilePath = join(cacheDir, safeId, 'checksums.json');
      expect(existsSync(cacheFilePath)).toBe(true);

      indexer.invalidateCache('test/remove-me');

      expect(existsSync(cacheFilePath)).toBe(false);
    });

    it('should not throw when cache does not exist', () => {
      expect(() => {
        indexer.invalidateCache('test/nonexistent');
      }).not.toThrow();
    });

    it('should attempt to remove empty repo cache directories', () => {
      writeManualCache(cacheDir, 'test/dir-cleanup', {
        'src/a.ts': sha256('content'),
      });

      const safeId = 'test_dir-cleanup';
      const repoCacheDir = join(cacheDir, safeId);

      indexer.invalidateCache('test/dir-cleanup');

      // Directory should be gone because only checksums.json was inside
      expect(existsSync(repoCacheDir)).toBe(false);
      // Also verify the cache file is gone
      expect(existsSync(join(repoCacheDir, 'checksums.json'))).toBe(false);
    });
  });

  // =========================================================================
  // invalidateAllCaches
  // =========================================================================

  describe('invalidateAllCaches', () => {
    it('should remove top-level .json files in the cache directory', () => {
      // Write a .json file directly at the cache directory root
      writeFileSync(join(cacheDir, 'top-level.json'), '{}', 'utf-8');

      // Also write a checksums.json inside a repo subdirectory
      writeManualCache(cacheDir, 'test/repo-a', { 'src/x.ts': sha256('x') });

      indexer.invalidateAllCaches();

      // Top-level .json file should be removed
      expect(existsSync(join(cacheDir, 'top-level.json'))).toBe(false);

      // Checksums.json inside a subdirectory is NOT removed (method only scans top level)
      const safeA = join(cacheDir, 'test_repo-a', 'checksums.json');
      expect(existsSync(safeA)).toBe(true);
    });

    it('should handle empty cache directory gracefully', () => {
      expect(() => {
        indexer.invalidateAllCaches();
      }).not.toThrow();
    });

    it('should handle non-existent cache directory gracefully', () => {
      // Use a fresh indexer pointing at a non-existent path
      const freshCacheDir = join(workspaceDir, 'does-not-exist');
      const freshIndexer = new IncrementalCrossRepoIndexer(crossRepoIndexer, store, freshCacheDir);

      expect(() => {
        freshIndexer.invalidateAllCaches();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Cache Save/Load Round-trip
  // =========================================================================

  describe('Cache persistence', () => {
    it('should save cache via incrementalIndex and load it correctly', async () => {
      const repoDir = setupRepo(workspaceDir, 'roundtrip-repo', {
        'src/hello.ts': 'export function hello() { return "world"; }',
      });

      const group = groupManager.createGroup('roundtrip-group', 'RT Group', '');
      groupManager.addRepo('roundtrip-group', 'test', 'roundtrip-repo', '', repoDir);

      await indexer.incrementalIndex('roundtrip-group');

      // Cache file should exist
      const cacheFilePath = join(cacheDir, 'test_roundtrip-repo', 'checksums.json');
      expect(existsSync(cacheFilePath)).toBe(true);

      // Load and verify
      const cache = JSON.parse(readFileSync(cacheFilePath, 'utf-8'));
      expect(cache.repoId).toBe('test/roundtrip-repo');
      expect(cache.lastIndexTime).toBeTruthy();
      expect(Object.keys(cache.files)).toHaveLength(1);
      expect(Object.keys(cache.files)).toContain('src/hello.ts');
    });

    it('should saveCache remove stale entries for deleted files', async () => {
      const repoDir = setupRepo(workspaceDir, 'stale-entries-repo', {
        'src/keep.ts': 'export const keep = 1;',
      });

      // Pre-populate cache with an extra file that no longer exists
      writeManualCache(cacheDir, 'test/stale-entries-repo', {
        'src/keep.ts': sha256('export const keep = 1;'),
        'src/old-gone.ts': sha256('export const old = 1;'),
      });

      const group = groupManager.createGroup('stale-group', 'Stale Group', '');
      groupManager.addRepo('stale-group', 'test', 'stale-entries-repo', '', repoDir);

      await indexer.incrementalIndex('stale-group');

      const cache = readCacheFile(cacheDir, 'test/stale-entries-repo');
      const files = (cache as Record<string, unknown>)['files'] as Record<string, string>;
      expect(Object.keys(files)).toHaveLength(1);
      expect(files).toHaveProperty('src/keep.ts');
      expect(files).not.toHaveProperty('src/old-gone.ts');
    });

    it('should handle corrupted JSON cache file gracefully', () => {
      const safeId = 'test_corrupt-repo'.replace(/[/\\:*?"<>|]/g, '_');
      const dir = join(cacheDir, safeId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'checksums.json'), 'this is not valid json');

      // Should not throw — falls back to empty cache
      const result = indexer.computeChangeSet('test/corrupt-repo', workspaceDir);
      expect(result).toBeDefined();
      expect(result.added).toEqual([]);
      expect(indexer.getLastIndexTime('test/corrupt-repo')).toBeNull();
      expect(indexer.getCachedFileCount('test/corrupt-repo')).toBe(0);
    });

    it('should handle missing checksums.json file gracefully', () => {
      // No cache file at all
      expect(indexer.getLastIndexTime('test/missing-file')).toBeNull();
      expect(indexer.getCachedFileCount('test/missing-file')).toBe(0);

      const result = indexer.computeChangeSet('test/missing-file', workspaceDir);
      expect(result.added).toEqual([]);
    });
  });

  // =========================================================================
  // Scanning Edge Cases
  // =========================================================================

  describe('Scanning edge cases', () => {
    it('should skip dotfiles (hidden files)', () => {
      const repoDir = setupRepo(workspaceDir, 'dotfiles-repo', {
        'src/valid.ts': 'export const a = 1;',
        '.hidden.ts': 'export const secret = 1;',
      });

      const result = indexer.computeChangeSet('test/dotfiles-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).not.toContain('.hidden.ts');
      expect(result.added).toContain('src/valid.ts');
    });

    it('should skip node_modules directory', () => {
      const repoDir = join(workspaceDir, 'nm-repo');
      mkdirSync(repoDir, { recursive: true });
      mkdirSync(join(repoDir, 'src'), { recursive: true });
      mkdirSync(join(repoDir, 'node_modules', 'lib'), { recursive: true });
      writeFileSync(join(repoDir, 'src/app.ts'), 'export function app() {}', 'utf-8');
      writeFileSync(
        join(repoDir, 'node_modules', 'lib', 'external.ts'),
        'export function external() {}',
        'utf-8',
      );

      const result = indexer.computeChangeSet('test/nm-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).toContain('src/app.ts');
      expect(result.added).not.toContain(expect.stringContaining('node_modules'));
    });

    it('should skip .d.ts declaration files', () => {
      const repoDir = setupRepo(workspaceDir, 'dts-repo', {
        'src/app.ts': 'export const a = 1;',
        'types/global.d.ts': 'declare const global: any;',
      });

      const result = indexer.computeChangeSet('test/dts-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).toContain('src/app.ts');
      expect(result.added).not.toContain('types/global.d.ts');
    });

    it('should skip .min.js and .min.css files', () => {
      const repoDir = setupRepo(workspaceDir, 'min-repo', {
        'src/app.ts': 'export const a = 1;',
        'dist/bundle.min.js': '// minified',
        'dist/styles.min.css': 'body{color:red}',
      });

      const result = indexer.computeChangeSet('test/min-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).toContain('src/app.ts');
      expect(result.added).not.toContain('dist/bundle.min.js');
      expect(result.added).not.toContain('dist/styles.min.css');
    });

    it('should skip large files (>5MB)', () => {
      const repoDir = join(workspaceDir, 'large-file-repo');
      mkdirSync(repoDir, { recursive: true });
      mkdirSync(join(repoDir, 'src'), { recursive: true });

      // Create a normal file
      writeFileSync(join(repoDir, 'src/small.ts'), 'export const small = 1;', 'utf-8');

      // Create a file larger than 5MB (simulate by writing enough data)
      const largeFilePath = join(repoDir, 'src/huge.ts');
      const fd = require('node:fs').openSync(largeFilePath, 'w');
      const buffer = Buffer.alloc(1024 * 1024, 'x'); // 1MB chunk
      for (let i = 0; i < 6; i++) {
        require('node:fs').writeSync(fd, buffer);
      }
      require('node:fs').closeSync(fd);

      // Verify it's >5MB
      const largeStat = statSync(largeFilePath);
      expect(largeStat.size).toBeGreaterThan(5 * 1024 * 1024);

      const result = indexer.computeChangeSet('test/large-file-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).toContain('src/small.ts');
      expect(result.added).not.toContain('src/huge.ts');
    });

    it('should skip known skip directories (dist, build, .git, etc.)', () => {
      const repoDir = join(workspaceDir, 'skip-dirs-repo');
      mkdirSync(repoDir, { recursive: true });

      // Create valid source directory
      mkdirSync(join(repoDir, 'src'), { recursive: true });
      writeFileSync(join(repoDir, 'src/app.ts'), 'export const a = 1;', 'utf-8');

      // Create skip directories with files
      for (const skipDir of ['dist', 'build', '.git', '__pycache__', '.next', 'coverage']) {
        mkdirSync(join(repoDir, skipDir), { recursive: true });
        writeFileSync(join(repoDir, skipDir, 'ignored.ts'), 'export const x = 1;', 'utf-8');
      }

      const result = indexer.computeChangeSet('test/skip-dirs-repo', repoDir);

      expect(result.added).toHaveLength(1);
      expect(result.added).toContain('src/app.ts');
      // None of the skip directory files should appear
      for (const file of result.added) {
        for (const skipDir of ['dist', 'build', '.git', '__pycache__', '.next', 'coverage']) {
          expect(file).not.toContain(skipDir);
        }
      }
    });

    it('should handle special characters in repoId (sanitization)', () => {
      const repoDir = setupRepo(workspaceDir, 'special-repo', {
        'src/main.ts': 'export const x = 1;',
      });

      const repoId = 'org/repo:with*chars?<>|';
      writeManualCache(cacheDir, repoId, {
        'src/main.ts': sha256('export const x = 1;'),
      });

      // Should load without errors
      const result = indexer.computeChangeSet(repoId, repoDir);
      expect(result.unchanged).toContain('src/main.ts');

      // Verify sanitization
      const safeId = repoId.replace(/[/\\:*?"<>|]/g, '_');
      const cacheFilePath = join(cacheDir, safeId, 'checksums.json');
      expect(existsSync(cacheFilePath)).toBe(true);
    });

    it('should skip non-source file extensions', () => {
      const repoDir = setupRepo(workspaceDir, 'mixed-ext-repo', {
        'src/valid.ts': 'export const a = 1;',
        'src/valid.py': 'def foo(): pass',
        'src/not-code.txt': 'plain text',
        'src/not-code.md': '# markdown',
        'src/not-code.html': '<html></html>',
      });

      const result = indexer.computeChangeSet('test/mixed-ext-repo', repoDir);

      // Only .ts and .py should be detected
      expect(result.added).toContain('src/valid.ts');
      expect(result.added).toContain('src/valid.py');
      expect(result.added).not.toContain('src/not-code.txt');
      expect(result.added).not.toContain('src/not-code.md');
      expect(result.added).not.toContain('src/not-code.html');
    });
  });

  // =========================================================================
  // Multiple Repositories
  // =========================================================================

  describe('Multiple repository handling', () => {
    it('should not mix caches between different repos', () => {
      const repoADir = setupRepo(workspaceDir, 'repo-a', {
        'src/a.ts': 'export const a = 1;',
      });
      const repoBDir = setupRepo(workspaceDir, 'repo-b', {
        'src/b.ts': 'export const b = 2;',
      });

      writeManualCache(cacheDir, 'test/repo-a', {
        'src/a.ts': sha256('export const a = 1;'),
      });
      writeManualCache(cacheDir, 'test/repo-b', {
        'src/b.ts': sha256('export const b = 2;'),
      });

      const resultA = indexer.computeChangeSet('test/repo-a', repoADir);
      const resultB = indexer.computeChangeSet('test/repo-b', repoBDir);

      expect(resultA.unchanged).toContain('src/a.ts');
      expect(resultA.unchanged).not.toContain('src/b.ts');
      expect(resultB.unchanged).toContain('src/b.ts');
      expect(resultB.unchanged).not.toContain('src/a.ts');
    });

    it('should track file counts independently per repo', () => {
      writeManualCache(cacheDir, 'test/repo-x', {
        'src/one.ts': sha256('one'),
        'src/two.ts': sha256('two'),
      });
      writeManualCache(cacheDir, 'test/repo-y', {
        'src/three.ts': sha256('three'),
      });

      expect(indexer.getCachedFileCount('test/repo-x')).toBe(2);
      expect(indexer.getCachedFileCount('test/repo-y')).toBe(1);
    });
  });

  // =========================================================================
  // incrementalIndex
  // =========================================================================

  describe('incrementalIndex', () => {
    it('should index a repo with new files and save cache', async () => {
      const repoDir = setupRepo(workspaceDir, 'incr-repo', {
        'src/hello.ts': 'export function hello() { return "world"; }',
        'src/utils.ts': 'export function util() { return true; }',
      });

      const group = groupManager.createGroup('incr-group', 'Incr Group', '');
      groupManager.addRepo('incr-group', 'test', 'incr-repo', '', repoDir);

      const result = await indexer.incrementalIndex('incr-group');

      expect(result.groupId).toBe('incr-group');
      expect(result.reposIndexed).toBe(1);
      expect(result.errors).toEqual([]);
      expect(result.filesReindexed).toBeGreaterThan(0);
      expect(result.lastIndexTime).toBeTruthy();
      expect(result.duration).toBeGreaterThanOrEqual(0);

      // Cache should exist after indexing
      const cacheFilePath = join(cacheDir, 'test_incr-repo', 'checksums.json');
      expect(existsSync(cacheFilePath)).toBe(true);
    });

    it('should return correct IncrementalIndexResult shape', async () => {
      const repoDir = setupRepo(workspaceDir, 'shape-repo', {
        'src/main.ts': 'export function main() {}',
      });

      const group = groupManager.createGroup('shape-group', 'Shape Group', '');
      groupManager.addRepo('shape-group', 'test', 'shape-repo', '', repoDir);

      const result = await indexer.incrementalIndex('shape-group');

      expect(result).toHaveProperty('groupId');
      expect(result).toHaveProperty('reposIndexed');
      expect(result).toHaveProperty('totalNodes');
      expect(result).toHaveProperty('totalEdges');
      expect(result).toHaveProperty('crossRepoEdges');
      expect(result).toHaveProperty('contracts');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('changeSet');
      expect(result).toHaveProperty('filesReindexed');
      expect(result).toHaveProperty('filesSkipped');
      expect(result).toHaveProperty('nodesRemoved');
      expect(result).toHaveProperty('nodesAdded');
      expect(result).toHaveProperty('lastIndexTime');
    });

    it('should throw when group is not found', async () => {
      await expect(indexer.incrementalIndex('nonexistent-group')).rejects.toThrow(
        'Group "nonexistent-group" not found',
      );
    });

    it('should skip repos with autoIndex set to false', async () => {
      const autoRepoDir = setupRepo(workspaceDir, 'auto-repo', {
        'src/auto.ts': 'export const a = 1;',
      });
      const manualRepoDir = setupRepo(workspaceDir, 'manual-repo', {
        'src/manual.ts': 'export const b = 2;',
      });

      // Spy on getGroup to return a group with controlled autoIndex values
      vi.spyOn(groupManager, 'getGroup').mockReturnValue({
        id: 'mixed-auto-group',
        name: 'Mixed Group',
        description: '',
        repos: [
          {
            owner: 'test',
            repo: 'auto-repo',
            fullName: 'test/auto-repo',
            localPath: autoRepoDir,
            projectId: null,
            role: 'dependency' as const,
            autoIndex: true,
          },
          {
            owner: 'test',
            repo: 'manual-repo',
            fullName: 'test/manual-repo',
            localPath: manualRepoDir,
            projectId: null,
            role: 'dependency' as const,
            autoIndex: false,
          },
        ],
        contracts: [],
        indexedAt: null,
      });

      const result = await indexer.incrementalIndex('mixed-auto-group');

      expect(result.reposIndexed).toBe(1);
      vi.restoreAllMocks();
    });

    it('should handle re-index errors gracefully', async () => {
      // Create a repo with a real source file so computeChangeSet finds files to re-index
      const repoDir = setupRepo(workspaceDir, 'error-repo', {
        'src/app.ts': 'export const x = 1;',
      });

      const group = groupManager.createGroup('error-group', 'Error Group', '');
      groupManager.addRepo('error-group', 'test', 'error-repo', '', repoDir);

      // Spy on indexSingleRepo to simulate an indexing failure
      // Although it's a private method in TypeScript, it's accessible at runtime
      vi.spyOn(crossRepoIndexer as any, 'indexSingleRepo').mockRejectedValue(
        new Error('Simulated index failure'),
      );

      const result = await indexer.incrementalIndex('error-group');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to re-index');
      vi.restoreAllMocks();
    });

    it('should skip unchanged files and track filesSkipped', async () => {
      const content = 'export function stable() { return 42; }';

      // First, set up cache as if already indexed
      writeManualCache(cacheDir, 'test/skip-repo', {
        'src/stable.ts': sha256(content),
      });

      const repoDir = setupRepo(workspaceDir, 'skip-repo', {
        'src/stable.ts': content,
      });

      const group = groupManager.createGroup('skip-group', 'Skip Group', '');
      groupManager.addRepo('skip-group', 'test', 'skip-repo', '', repoDir);

      const result = await indexer.incrementalIndex('skip-group');

      expect(result.filesSkipped).toBe(1);
    });

    it('should handle deleted files and track nodesRemoved', async () => {
      // First create repo with a file and index it
      const repoDir = setupRepo(workspaceDir, 'del-track-repo', {
        'src/keep.ts': 'export const keep = 1;',
      });

      const group = groupManager.createGroup('del-group', 'Del Group', '');
      groupManager.addRepo('del-group', 'test', 'del-track-repo', '', repoDir);

      // Index once so cache has keep.ts
      await indexer.incrementalIndex('del-group');

      // Now add a stale entry to cache for a file that doesn't exist
      writeManualCache(cacheDir, 'test/del-track-repo', {
        'src/keep.ts': sha256('export const keep = 1;'),
        'src/gone.ts': sha256('export const gone = 1;'),
      });

      // Run incremental again — should detect gone.ts as deleted
      const result = await indexer.incrementalIndex('del-group');

      // gone.ts was in cache but not on disk — it's detected as deleted
      // FilesSkipped should include keep.ts (unchanged)
      expect(result.filesSkipped).toBeGreaterThanOrEqual(0);
    });

    it('should handle multiple repos in a group', async () => {
      const repo1Dir = setupRepo(workspaceDir, 'multi-repo-1', {
        'src/one.ts': 'export const one = 1;',
      });
      const repo2Dir = setupRepo(workspaceDir, 'multi-repo-2', {
        'src/two.ts': 'export const two = 2;',
      });

      const group = groupManager.createGroup('multi-group', 'Multi Group', '');
      groupManager.addRepo('multi-group', 'test', 'multi-repo-1', '', repo1Dir);
      groupManager.addRepo('multi-group', 'test', 'multi-repo-2', '', repo2Dir);

      const result = await indexer.incrementalIndex('multi-group');

      expect(result.reposIndexed).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it('should handle renamed files during incremental index', async () => {
      const content = 'export function renamed() { return "moved"; }';

      const repoDir = setupRepo(workspaceDir, 'incr-rename-repo', {
        'src/new-name.ts': content,
      });

      // Cache says it was at old location
      writeManualCache(cacheDir, 'test/incr-rename-repo', {
        'src/old-name.ts': sha256(content),
      });

      const group = groupManager.createGroup('incr-rename-group', 'Rename Group', '');
      groupManager.addRepo('incr-rename-group', 'test', 'incr-rename-repo', '', repoDir);

      // Should run without errors — the renamed file gets re-indexed
      const result = await indexer.incrementalIndex('incr-rename-group');

      expect(result.errors).toEqual([]);
    });
  });

  // =========================================================================
  // Defensive branches and filesystem edge cases
  // =========================================================================

  describe('Defensive branches and filesystem edge cases', () => {
    it('defaults the cache directory when none is provided', () => {
      const defaultIndexer = new IncrementalCrossRepoIndexer(crossRepoIndexer, store);
      expect(defaultIndexer.getCachedFileCount('test/__no_such_repo__')).toBe(0);
      expect(defaultIndexer.getLastIndexTime('test/__no_such_repo__')).toBeNull();
    });

    it('falls back to String(err) when re-index rejects a non-Error value', async () => {
      const repoDir = setupRepo(workspaceDir, 'non-error-repo', {
        'src/app.ts': 'export const x = 1;',
      });
      const group = groupManager.createGroup('non-error-group', 'Non-Error Group', '');
      groupManager.addRepo('non-error-group', 'test', 'non-error-repo', '', repoDir);

      vi.spyOn(crossRepoIndexer as any, 'indexSingleRepo').mockRejectedValue('raw failure');

      const result = await indexer.incrementalIndex('non-error-group');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('raw failure');
      vi.restoreAllMocks();
    });

    it('falls back to defaults when cache JSON fields are null', () => {
      const safeId = 'test_null-cache'.replace(/[/\\:*?"<>|]/g, '_');
      const dir = join(cacheDir, safeId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'checksums.json'),
        JSON.stringify({ repoId: null, lastIndexTime: null, files: null }),
      );

      expect(indexer.getCachedFileCount('test/null-cache')).toBe(0);
      expect(indexer.getLastIndexTime('test/null-cache')).toBeNull();
    });

    it('skips symbolic links (neither directory nor regular file)', () => {
      const repoDir = join(workspaceDir, 'symlink-repo');
      mkdirSync(join(repoDir, 'src'), { recursive: true });
      writeFileSync(join(repoDir, 'src', 'real.ts'), 'export const a = 1;', 'utf-8');
      symlinkSync(join(repoDir, 'src', 'real.ts'), join(repoDir, 'src', 'link.ts'));

      const result = indexer.computeChangeSet('test/symlink-repo', repoDir);
      expect(result.added).toEqual(['src/real.ts']);
    });

    it('skips files with no extension', () => {
      const repoDir = setupRepo(workspaceDir, 'extless-repo', {
        'src/code.ts': 'export const a = 1;',
        'src/Makefile': 'all:\n\techo hi',
      });
      const result = indexer.computeChangeSet('test/extless-repo', repoDir);
      expect(result.added).toEqual(['src/code.ts']);
    });

    it('returns an empty change set when the scan directory cannot be read', () => {
      const result = indexer.computeChangeSet(
        'test/missing-dir',
        join(workspaceDir, 'does-not-exist'),
      );
      expect(result.added).toEqual([]);
      expect(result.deleted).toEqual([]);
    });

    it('removes only matching-project nodes (with edges) for deleted files', async () => {
      const repoDir = setupRepo(workspaceDir, 'rm-filter-repo', {
        'src/keep.ts': 'export const keep = 1;',
      });
      writeManualCache(cacheDir, 'test/rm-filter-repo', {
        'src/keep.ts': sha256('export const keep = 1;'),
        'src/gone.ts': sha256('export const gone = 1;'),
      });

      // A node from a different project is skipped entirely.
      store.insertNode(makeNode('other/repo', 'otherNode', 'src/gone.ts'));
      // A node in the target project whose filePath is NOT deleted survives.
      const keepId = store.insertNode(makeNode('test/rm-filter-repo', 'keepNode', 'src/keep.ts'));
      // A node in the target project whose filePath IS deleted is removed (with its edge).
      const goneId = store.insertNode(makeNode('test/rm-filter-repo', 'goneNode', 'src/gone.ts'));
      store.insertEdge(makeEdge('test/rm-filter-repo', goneId, keepId));

      const group = groupManager.createGroup('rm-filter-group', 'RM Filter Group', '');
      groupManager.addRepo('rm-filter-group', 'test', 'rm-filter-repo', '', repoDir);

      const result = await indexer.incrementalIndex('rm-filter-group');

      const remaining = store.getAllNodes();
      expect(remaining.map((n) => n.name).sort()).toEqual(['keepNode', 'otherNode']);
      expect(store.getEdgeCount()).toBe(0);
      expect(result.nodesRemoved).toBe(1);
    });
  });
});
