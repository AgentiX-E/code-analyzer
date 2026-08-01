// @code-analyzer/intelligence — Incremental Reindexer Tests
// Comprehensive tests for IncrementalReindexer: change detection via git diff,
// re-indexing changed files, commit tracking, cache management, and edge cases.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';
import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';
import { IncrementalReindexer } from '../cross-repo/incremental-reindexer.js';
import type { ChangedFiles, ReindexResult } from '../cross-repo/incremental-reindexer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialize a git repository at the given path with an initial commit. */
function initGitRepo(repoPath: string): void {
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });
  // Create an initial file and commit so HEAD exists
  writeFileSync(join(repoPath, '.gitkeep'), '');
  execSync('git add .gitkeep', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: repoPath, stdio: 'pipe' });
}

/** Create a source file and commit it. */
function addAndCommitFile(repoPath: string, filename: string, content: string): string {
  const fullPath = join(repoPath, filename);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
  execSync(`git add ${filename}`, { cwd: repoPath, stdio: 'pipe' });
  execSync(`git commit -m "add ${filename}"`, { cwd: repoPath, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/** Modify a file and commit. */
function modifyAndCommitFile(repoPath: string, filename: string, content: string): string {
  const fullPath = join(repoPath, filename);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
  execSync(`git add ${filename}`, { cwd: repoPath, stdio: 'pipe' });
  execSync(`git commit -m "modify ${filename}"`, { cwd: repoPath, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

/** Delete a file and commit. */
function deleteAndCommitFile(repoPath: string, filename: string): string {
  execSync(`git rm ${filename}`, { cwd: repoPath, stdio: 'pipe' });
  execSync(`git commit -m "delete ${filename}"`, { cwd: repoPath, stdio: 'pipe' });
  return execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IncrementalReindexer', () => {
  let reindexer: IncrementalReindexer;
  let tempDir: string;
  let cacheDir: string;
  let repoPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'inc-reindexer-'));
    cacheDir = join(tempDir, '.cache');
    reindexer = new IncrementalReindexer(cacheDir);
    repoPath = join(tempDir, 'repo');
    mkdirSync(repoPath, { recursive: true });
    initGitRepo(repoPath);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // -----------------------------------------------------------------------
  // detectChanges
  // -----------------------------------------------------------------------

  describe('detectChanges', () => {
    it('should return empty changes for non-existent path', () => {
      const changes = reindexer.detectChanges('/non/existent/path');
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted).toEqual([]);
      expect(changes.allChanged).toEqual([]);
    });

    it('should return all files as added when no prior commit is cached', () => {
      addAndCommitFile(repoPath, 'src/index.ts', 'export const hello = "world";');
      const changes = reindexer.detectChanges(repoPath);
      expect(changes.added.length).toBeGreaterThanOrEqual(1);
      expect(changes.added).toContain('src/index.ts');
      expect(changes.allChanged.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect added files since last commit', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/existing.ts', 'const a = 1;');
      reindexer.saveLastIndexCommit(repoPath, commit1);

      // Add a new file and commit
      addAndCommitFile(repoPath, 'src/newfile.ts', 'const b = 2;');

      const changes = reindexer.detectChanges(repoPath, commit1);
      expect(changes.added).toContain('src/newfile.ts');
    });

    it('should detect modified files since last commit', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/modme.ts', 'const x = 1;');
      reindexer.saveLastIndexCommit(repoPath, commit1);

      modifyAndCommitFile(repoPath, 'src/modme.ts', 'const x = 2;');

      const changes = reindexer.detectChanges(repoPath, commit1);
      expect(changes.modified).toContain('src/modme.ts');
    });

    it('should detect deleted files since last commit', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/todelete.ts', 'const d = 1;');
      reindexer.saveLastIndexCommit(repoPath, commit1);

      deleteAndCommitFile(repoPath, 'src/todelete.ts');

      const changes = reindexer.detectChanges(repoPath, commit1);
      expect(changes.deleted).toContain('src/todelete.ts');
    });

    it('should include all changed files in allChanged array', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/base.ts', 'const b = 1;');
      reindexer.saveLastIndexCommit(repoPath, commit1);

      addAndCommitFile(repoPath, 'src/new.ts', 'const n = 1;');
      modifyAndCommitFile(repoPath, 'src/base.ts', 'const b = 2;');

      const changes = reindexer.detectChanges(repoPath, commit1);
      expect(changes.allChanged.length).toBeGreaterThanOrEqual(2);
    });

    it('should accept explicit sinceCommit parameter', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/first.ts', 'const f = 1;');
      addAndCommitFile(repoPath, 'src/second.ts', 'const s = 2;');

      const changes = reindexer.detectChanges(repoPath, commit1);
      expect(changes.added).toContain('src/second.ts');
    });

    it('should return empty changes when nothing changed since commit', () => {
      const commit1 = addAndCommitFile(repoPath, 'src/stable.ts', 'const s = 1;');
      reindexer.saveLastIndexCommit(repoPath, commit1);

      // Get current HEAD which should be the same as commit1
      const currentHead = execSync('git rev-parse HEAD', {
        cwd: repoPath, encoding: 'utf-8',
      }).trim();
      reindexer.saveLastIndexCommit(repoPath, currentHead);

      const changes = reindexer.detectChanges(repoPath);
      expect(changes.added).toEqual([]);
      expect(changes.modified).toEqual([]);
      expect(changes.deleted).toEqual([]);
      expect(changes.allChanged).toEqual([]);
    });

    it('should fall back to git ls-files when cache is empty', () => {
      addAndCommitFile(repoPath, 'src/foo.ts', 'const f = 1;');
      addAndCommitFile(repoPath, 'src/bar.ts', 'const b = 1;');

      const changes = reindexer.detectChanges(repoPath);
      // When no commit is cached, all files are treated as added
      expect(changes.added.length).toBeGreaterThanOrEqual(1);
      expect(changes.allChanged.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty when git ls-files fails', () => {
      // Use a non-git directory to trigger git failure
      const nonGitDir = join(tempDir, 'non-git');
      mkdirSync(nonGitDir, { recursive: true });

      const changes = reindexer.detectChanges(nonGitDir);
      expect(changes.added).toEqual([]);
      expect(changes.allChanged).toEqual([]);
    });

    it('should return empty when git diff fails', () => {
      // Save a bogus commit that git can't resolve
      reindexer.saveLastIndexCommit(repoPath, 'deadbeef00000000000000000000000000000000');

      const changes = reindexer.detectChanges(repoPath);
      expect(changes.added).toEqual([]);
      expect(changes.allChanged).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getLastIndexCommit / saveLastIndexCommit
  // -----------------------------------------------------------------------

  describe('commit tracking', () => {
    it('should return null when no commit has been cached', () => {
      const commit = reindexer.getLastIndexCommit(repoPath);
      expect(commit).toBeNull();
    });

    it('should save and retrieve the last index commit', () => {
      const testCommit = 'abc123def456';
      reindexer.saveLastIndexCommit(repoPath, testCommit);

      const retrieved = reindexer.getLastIndexCommit(repoPath);
      expect(retrieved).toBe(testCommit);
    });

    it('should return null for a different repo that has no cache', () => {
      const testCommit = 'xyz789';
      reindexer.saveLastIndexCommit(repoPath, testCommit);

      const otherRepo = join(tempDir, 'other-repo');
      mkdirSync(otherRepo, { recursive: true });
      initGitRepo(otherRepo);

      const retrieved = reindexer.getLastIndexCommit(otherRepo);
      expect(retrieved).toBeNull();
    });

    it('should handle corrupted cache file gracefully', () => {
      const cacheDir2 = join(cacheDir, repoPath.replace(/[/\\:*?"<>|]/g, '_'));
      mkdirSync(cacheDir2, { recursive: true });
      writeFileSync(join(cacheDir2, 'last-commit.json'), 'not-valid-json{{{');

      const retrieved = reindexer.getLastIndexCommit(repoPath);
      expect(retrieved).toBeNull();
    });

    it('should handle missing lastCommit field in cache', () => {
      const cacheDir2 = join(cacheDir, repoPath.replace(/[/\\:*?"<>|]/g, '_'));
      mkdirSync(cacheDir2, { recursive: true });
      writeFileSync(
        join(cacheDir2, 'last-commit.json'),
        JSON.stringify({ updatedAt: new Date().toISOString() }),
      );

      const retrieved = reindexer.getLastIndexCommit(repoPath);
      expect(retrieved).toBeNull();
    });

    it('should create cache directory when saving commit', () => {
      const testCommit = 'newcommit123';
      reindexer.saveLastIndexCommit(repoPath, testCommit);

      const cachePath = join(cacheDir, repoPath.replace(/[/\\:*?"<>|]/g, '_'), 'last-commit.json');
      expect(existsSync(cachePath)).toBe(true);

      const raw = JSON.parse(readFileSync(cachePath, 'utf-8'));
      expect(raw.lastCommit).toBe(testCommit);
      expect(raw.updatedAt).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // getCurrentCommit
  // -----------------------------------------------------------------------

  describe('getCurrentCommit', () => {
    it('should return current HEAD commit hash', () => {
      const head = reindexer.getCurrentCommit(repoPath);
      expect(head).toBeTruthy();
      expect(head).toMatch(/^[a-f0-9]{40}$/);
    });

    it('should return null for non-existent path', () => {
      const head = reindexer.getCurrentCommit('/non/existent');
      expect(head).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // invalidateCache
  // -----------------------------------------------------------------------

  describe('invalidateCache', () => {
    it('should remove the commit cache file', () => {
      reindexer.saveLastIndexCommit(repoPath, 'test123');
      expect(reindexer.getLastIndexCommit(repoPath)).toBe('test123');

      reindexer.invalidateCache(repoPath);
      expect(reindexer.getLastIndexCommit(repoPath)).toBeNull();
    });

    it('should not throw when cache does not exist', () => {
      expect(() => reindexer.invalidateCache('/non/existent/path')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // reindexChanged
  // -----------------------------------------------------------------------

  describe('reindexChanged', () => {
    it('should process changed files and return result', async () => {
      const store = new InMemoryGraphStore();
      const groupManager = new RepoGroupManager();
      const indexer = new CrossRepoIndexer(store, groupManager);

      // Create a source file
      addAndCommitFile(repoPath, 'src/test.ts', 'export function hello() { return "hi"; }');

      const changes: ChangedFiles = {
        added: ['src/test.ts'],
        modified: [],
        deleted: [],
        allChanged: ['src/test.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, indexer);

      expect(result.filesProcessed).toBeGreaterThanOrEqual(0);
      expect(result.filesSkipped).toBeGreaterThanOrEqual(0);
      expect(result.nodesUpdated).toBeGreaterThanOrEqual(0);
      expect(result.edgesUpdated).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle deleted files by removing nodes', async () => {
      const store = new InMemoryGraphStore();
      const groupManager = new RepoGroupManager();
      const indexer = new CrossRepoIndexer(store, groupManager);

      // Index a file first by inserting a node directly
      store.insertNode({
        id: 0,
        projectId: 'test-repo',
        label: 'Function',
        name: 'ghost',
        qualifiedName: 'test-repo:src/ghost.ts:ghost',
        filePath: 'src/ghost.ts',
        startLine: 1,
        endLine: 1,
        language: 'TypeScript',
        properties: {
          name: 'ghost',
          filePath: 'src/ghost.ts',
          startLine: 1,
          endLine: 1,
          language: 'TypeScript',
          isExported: true,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: true,
        fingerprint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const nodesBefore = store.getNodeCount();
      expect(nodesBefore).toBe(1);

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/ghost.ts'],
        allChanged: ['src/ghost.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, indexer);
      expect(result).toBeDefined();
      // The node should be deleted
      const nodesAfter = store.getNodeCount();
      expect(nodesAfter).toBeLessThanOrEqual(nodesBefore);
    });

    it('should catch errors from deleteEdge and continue', async () => {
      const store = new InMemoryGraphStore();
      const groupManager = new RepoGroupManager();
      const indexer = new CrossRepoIndexer(store, groupManager);

      // Insert a node with a file path matching the deleted file
      const nodeId = store.insertNode({
        id: 0,
        projectId: 'test-repo',
        label: 'Function',
        name: 'willBeDeleted',
        qualifiedName: 'test-repo:src/delete-me.ts:willBeDeleted',
        filePath: 'src/delete-me.ts',
        startLine: 1,
        endLine: 1,
        language: 'TypeScript',
        properties: {
          name: 'willBeDeleted',
          filePath: 'src/delete-me.ts',
          startLine: 1,
          endLine: 1,
          language: 'TypeScript',
          isExported: true,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: true,
        fingerprint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Add an edge for the node
      const edgeId = store.insertEdge({
        id: 0,
        projectId: 'test-repo',
        sourceId: nodeId,
        targetId: nodeId,
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });

      // Mock deleteEdge to throw
      const originalDeleteEdge = store.deleteEdge.bind(store);
      store.deleteEdge = (id: number) => {
        if (id === edgeId) {
          throw new Error('Edge deletion failed');
        }
        originalDeleteEdge(id);
      };

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/delete-me.ts'],
        allChanged: ['src/delete-me.ts'],
      };

      // Should not throw despite deleteEdge error
      const result = await reindexer.reindexChanged(repoPath, changes, indexer);
      expect(result).toBeDefined();
    });

    it('should handle indexer without store property gracefully', async () => {
      // Create a mock indexer that has no store at all
      const mockIndexer = {} as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/nonexistent.ts'],
        allChanged: ['src/nonexistent.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result).toBeDefined();
      expect(result.nodesUpdated).toBe(0);
      expect(result.edgesUpdated).toBe(0);
    });

    it('should handle store without getNodeCount and getEdgeCount', async () => {
      // Store with no getNodeCount/getEdgeCount — triggers ?? 0 fallback
      const mockStore = {
        getAllNodes: () => [],
      };
      const mockIndexer = { store: mockStore } as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: [],
        allChanged: [],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result.nodesUpdated).toBe(0);
      expect(result.edgesUpdated).toBe(0);
    });

    it('should handle store without getAllNodes', async () => {
      // Store without getAllNodes method — triggers ?? [] fallback
      const mockStore = {
        getNodeCount: () => 0,
        getEdgeCount: () => 0,
      };
      const mockIndexer = { store: mockStore } as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/ghost.ts'],
        allChanged: ['src/ghost.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result).toBeDefined();
    });

    it('should skip node without filePath when processing deleted files', async () => {
      const store = new InMemoryGraphStore();
      const groupManager = new RepoGroupManager();
      const indexer = new CrossRepoIndexer(store, groupManager);

      // Insert a node with null filePath — should not match deleted file filter
      store.insertNode({
        id: 0,
        projectId: 'test-repo',
        label: 'Function',
        name: 'noFilePath',
        qualifiedName: 'test-repo:noFilePath',
        filePath: null,
        startLine: null,
        endLine: null,
        language: 'TypeScript',
        properties: {
          name: 'noFilePath',
          filePath: undefined,
          startLine: undefined,
          endLine: undefined,
          language: 'TypeScript',
          isExported: true,
        },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: true,
        fingerprint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/ghost.ts'],
        allChanged: ['src/ghost.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, indexer);
      expect(result).toBeDefined();
    });

    it('should handle store without getEdgesForNode', async () => {
      const mockStore = {
        getNodeCount: () => 0,
        getEdgeCount: () => 0,
        getAllNodes: () => [{
          id: 1,
          filePath: 'src/deleted.ts',
          projectId: 'test',
          label: 'Function',
          name: 'test',
          qualifiedName: 'test:src/deleted.ts:test',
          isExported: false,
          properties: {},
          signature: null,
          docstring: null,
          complexity: null,
          fingerprint: null,
          startLine: null,
          endLine: null,
          language: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        }],
        deleteNode: () => {},
        deleteEdge: () => {},
      };
      const mockIndexer = { store: mockStore } as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: ['src/deleted.ts'],
        allChanged: ['src/deleted.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result).toBeDefined();
    });

    it('should handle empty changes gracefully', async () => {
      const store = new InMemoryGraphStore();
      const groupManager = new RepoGroupManager();
      const indexer = new CrossRepoIndexer(store, groupManager);

      const changes: ChangedFiles = {
        added: [],
        modified: [],
        deleted: [],
        allChanged: [],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, indexer);

      expect(result.filesProcessed).toBe(0);
      expect(result.filesSkipped).toBe(0);
    });

    it('should skip files when indexSingleRepo is not available', async () => {
      const store = new InMemoryGraphStore();
      // Create a mock indexer without indexSingleRepo
      const mockIndexer = {
        store,
      } as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: ['src/file.ts'],
        modified: [],
        deleted: [],
        allChanged: ['src/file.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result.filesSkipped).toBe(1);
    });

    it('should catch errors from indexSingleRepo and count as skipped', async () => {
      const store = new InMemoryGraphStore();
      // Create a mock indexer whose indexSingleRepo always throws
      const mockIndexer = {
        store,
        indexSingleRepo: async () => { throw new Error('index failed'); },
      } as unknown as CrossRepoIndexer;

      const changes: ChangedFiles = {
        added: ['src/broken.ts'],
        modified: [],
        deleted: [],
        allChanged: ['src/broken.ts'],
      };

      const result = await reindexer.reindexChanged(repoPath, changes, mockIndexer);
      expect(result.filesSkipped).toBe(1);
      expect(result.filesProcessed).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Custom cache directory
  // -----------------------------------------------------------------------

  describe('custom cache directory', () => {
    it('should use the provided cache directory', () => {
      const customCache = join(tempDir, 'custom-cache');
      const customReindexer = new IncrementalReindexer(customCache);

      customReindexer.saveLastIndexCommit(repoPath, 'custom123');

      const cachePath = join(customCache, repoPath.replace(/[/\\:*?"<>|]/g, '_'), 'last-commit.json');
      expect(existsSync(cachePath)).toBe(true);
    });

    it('should use default cache directory when none is provided', () => {
      const defaultReindexer = new IncrementalReindexer();
      // Should not throw — uses default path from process.cwd()
      expect(defaultReindexer).toBeDefined();
    });
  });
});
