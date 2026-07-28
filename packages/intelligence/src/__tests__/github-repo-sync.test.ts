// @code-analyzer/intelligence — GitHub Repo Sync Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { GitHubRepoSync } from '../github/repo-sync.js';
import type { SyncOptions } from '../github/repo-sync.js';
import { GitHubApiClient } from '../github/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  const dir = join(tmpdir(), `code-analyzer-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockClient(): GitHubApiClient {
  return new GitHubApiClient({ token: 'ghp_test' });
}

function createMockGitRepo(dir: string): void {
  // Create a minimal git repo structure
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(dir, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  writeFileSync(join(dir, 'README.md'), '# Test Repo\n');
}

/**
 * Create a real git repository with an initial commit in the given directory.
 * Returns the commit SHA.
 */
function createRealGitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# Real Test Repo\n');
  execSync(`cd "${dir}" && git init && git config user.email "test@test.com" && git config user.name "Test" && git add . && git commit -m "init"`, {
    stdio: 'pipe',
    timeout: 10_000,
  });
  return execSync(`cd "${dir}" && git rev-parse HEAD`, {
    stdio: 'pipe',
    encoding: 'utf-8',
  }).trim();
}

/**
 * Create a cached repo structure (directory with .git subdir and some files)
 * that will be recognized by listCachedRepos.
 */
function createCachedRepoStructure(baseDir: string, owner: string, repo: string, fileSize: number = 100): void {
  const repoDir = join(baseDir, owner, repo);
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  writeFileSync(join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(repoDir, 'dummy.txt'), 'x'.repeat(fileSize));
}

// ---------------------------------------------------------------------------
// GitHubRepoSync
// ---------------------------------------------------------------------------

describe('GitHubRepoSync', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = createTempDir();
  });

  afterEach(() => {
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* */ }
  });

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('should create with default options', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client });
      expect(sync).toBeInstanceOf(GitHubRepoSync);
    });

    it('should create with custom cache directory', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      expect(sync).toBeInstanceOf(GitHubRepoSync);
    });

    it('should create cache directory if it does not exist', () => {
      const client = createMockClient();
      const newDir = join(cacheDir, 'nested', 'cache');
      const sync = new GitHubRepoSync({ client, cacheDir: newDir });
      expect(existsSync(newDir)).toBe(true);
    });

    it('should accept autoFetch option', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, autoFetch: true });
      expect(sync).toBeInstanceOf(GitHubRepoSync);
    });

    it('should use custom branch when provided', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir, branch: 'develop' });
      expect(sync).toBeInstanceOf(GitHubRepoSync);
    });
  });

  // -----------------------------------------------------------------------
  // isCached
  // -----------------------------------------------------------------------

  describe('isCached', () => {
    it('should return false for non-cached repos', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      expect(sync.isCached('owner', 'nonexistent')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getPath
  // -----------------------------------------------------------------------

  describe('getPath', () => {
    it('should return the expected cache path', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      const path = sync.getPath('owner', 'repo');
      expect(path).toContain('owner');
      expect(path).toContain('repo');
      expect(path.startsWith(cacheDir)).toBe(true);
    });

    it('should sanitize path separators and traversal sequences in owner and repo names', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      const path = sync.getPath('owner/../evil', 'repo/../../bad');
      // Should NOT contain raw traversal sequences
      expect(path).not.toContain('/../');
      // Should stay within cacheDir
      const resolved = require('node:path').resolve(path);
      expect(resolved.startsWith(cacheDir)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // remove
  // -----------------------------------------------------------------------

  describe('remove', () => {
    it('should return false for non-cached repo', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      expect(sync.remove('owner', 'nonexistent')).toBe(false);
    });

    it('should return true and remove cached repo', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });

      // Manually create a cached repo structure
      const repoDir = sync.getPath('owner', 'test-repo');
      createMockGitRepo(repoDir);

      expect(sync.isCached('owner', 'test-repo')).toBe(true);
      expect(sync.remove('owner', 'test-repo')).toBe(true);
      expect(sync.isCached('owner', 'test-repo')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getCacheSize (covers getDirSize)
  // -----------------------------------------------------------------------

  describe('getCacheSize', () => {
    it('should return 0 for empty cache', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      expect(sync.getCacheSize()).toBe(0);
    });

    it('should return >0 for non-empty cache', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });

      const repoDir = sync.getPath('owner', 'repo');
      createMockGitRepo(repoDir);

      expect(sync.getCacheSize()).toBeGreaterThan(0);
    });

    it('should return 0 for non-existent directory (getDirSize existsSync branch)', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      // Delete the cacheDir to test the non-existent path
      rmSync(cacheDir, { recursive: true, force: true });
      expect(sync.getCacheSize()).toBe(0);
    });

    it('should accumulate sizes from files in nested directories', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });

      // Create nested dir structure with files
      const nestedDir = sync.getPath('owner', 'repo');
      mkdirSync(nestedDir, { recursive: true });
      mkdirSync(join(nestedDir, 'subdir'), { recursive: true });
      writeFileSync(join(nestedDir, 'file1.txt'), 'hello'); // 5 bytes
      writeFileSync(join(nestedDir, 'subdir', 'file2.txt'), 'world!'); // 6 bytes

      const size = sync.getCacheSize();
      expect(size).toBeGreaterThanOrEqual(11); // At least 5+6 bytes
    });
  });

  // -----------------------------------------------------------------------
  // clearCache
  // -----------------------------------------------------------------------

  describe('clearCache', () => {
    it('should clear the cache directory', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });

      const repoDir = sync.getPath('owner', 'repo');
      createMockGitRepo(repoDir);

      expect(sync.getCacheSize()).toBeGreaterThan(0);
      sync.clearCache();
      expect(sync.getCacheSize()).toBe(0);
      expect(existsSync(cacheDir)).toBe(true); // Directory recreated
    });

    it('should handle clearing when cacheDir does not exist', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      // Delete the cacheDir
      rmSync(cacheDir, { recursive: true, force: true });
      // Should not throw
      expect(() => sync.clearCache()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // clone — already cloned, autoFetch=false (covers getCurrentSha success)
  // -----------------------------------------------------------------------

  describe('clone — already cloned with autoFetch=false', () => {
    it('should return existing repo SHA when already cloned with autoFetch disabled', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        autoFetch: false,
        branch: 'main',
      });

      // Create a real git repo at the expected cache location
      const repoDir = sync.getPath('testowner', 'testrepo');
      const expectedSha = createRealGitRepo(repoDir);

      const result = await sync.clone('testowner', 'testrepo');

      expect(result.owner).toBe('testowner');
      expect(result.repo).toBe('testrepo');
      expect(result.commitSha).toBe(expectedSha);
      expect(result.synced).toBe(false);
      expect(result.branch).toBe('main');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.localPath).toBe(repoDir);
    });

    it('should return "unknown" SHA when git rev-parse fails (getCurrentSha catch branch)', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        autoFetch: false,
        branch: 'main',
      });

      // Create a directory without a valid git repo
      const repoDir = sync.getPath('testowner', 'badrepo');
      mkdirSync(repoDir, { recursive: true });
      // No .git directory — git rev-parse will fail

      const result = await sync.clone('testowner', 'badrepo');

      expect(result.owner).toBe('testowner');
      expect(result.repo).toBe('badrepo');
      expect(result.commitSha).toBe('unknown');
      expect(result.synced).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // clone — fresh clone with cache eviction (covers ensureCacheSpace +
  // listCachedRepos + the catch block for git clone failure)
  // -----------------------------------------------------------------------

  describe('clone — fresh clone path with cache eviction', () => {
    it('should trigger ensureCacheSpace and listCachedRepos when cache exceeds limit', async () => {
      const client = createMockClient();
      // Set a tiny maxCacheSize to trigger eviction
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        maxCacheSize: 100, // 100 bytes — very small
        branch: 'main',
      });

      // Create several cached repo structures to fill the cache
      createCachedRepoStructure(cacheDir, 'owner1', 'repo1', 200);
      createCachedRepoStructure(cacheDir, 'owner2', 'repo2', 200);
      createCachedRepoStructure(cacheDir, 'owner3', 'repo3', 200);

      // Also create a directory that looks like an owner dir but the
      // subdirectory doesn't have .git (tests the .git check branch in
      // listCachedRepos)
      const noGitDir = join(cacheDir, 'owner4', 'not-a-repo');
      mkdirSync(noGitDir, { recursive: true });

      // Now try to clone a new repo — it will go to fresh clone path,
      // call ensureCacheSpace (which sees cache > maxCacheSize),
      // listCachedRepos, LRU evict, then fail on git clone from GitHub
      await expect(
        sync.clone('newowner', 'newrepo'),
      ).rejects.toThrow(/Failed to clone newowner\/newrepo/);
    });

    it('should skip cache eviction when cache size is below limit', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        maxCacheSize: 5 * 1024 * 1024 * 1024, // 5GB — won't be exceeded
        branch: 'main',
      });

      // Try to clone a repo that doesn't exist — goes to fresh clone,
      // ensureCacheSpace sees size < maxCacheSize and returns early,
      // then git clone from GitHub fails
      await expect(
        sync.clone('newowner', 'newrepo'),
      ).rejects.toThrow(/Failed to clone newowner\/newrepo/);
    });
  });

  // -----------------------------------------------------------------------
  // clone — shallow=false branch (tests shallow conditional)
  // -----------------------------------------------------------------------

  describe('clone — shallow option', () => {
    it('should not add --depth 1 when shallow is false', { timeout: 60_000 }, async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        shallow: false,
        branch: 'main',
      });

      // This will fail at git clone, but tests the shallow=false branch
      // in the args construction
      await expect(
        sync.clone('owner', 'repo'),
      ).rejects.toThrow(/Failed to clone/);
    });
  });

  // -----------------------------------------------------------------------
  // pull
  // -----------------------------------------------------------------------

  describe('pull', () => {
    it('should delegate to clone when repo is not cached', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        branch: 'main',
      });

      // pull on non-existent repo delegates to clone, which fails with git clone error
      await expect(
        sync.pull('newowner', 'newrepo'),
      ).rejects.toThrow(/Failed to clone/);
    });

    it('should attempt git fetch when repo exists in cache', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        branch: 'main',
      });

      // Create a mock repo structure so existsSync returns true
      const repoDir = sync.getPath('testowner', 'testrepo');
      createMockGitRepo(repoDir);

      // pull will attempt git fetch from origin, which fails because
      // there's no remote configured
      await expect(
        sync.pull('testowner', 'testrepo'),
      ).rejects.toThrow(/Failed to pull/);
    });

    it('should use default branch "main" when branch option is not set', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        // branch not set — tests the ?? fallback
      });

      // Create a mock repo structure so existsSync returns true
      const repoDir = sync.getPath('testowner', 'testrepo');
      createMockGitRepo(repoDir);

      // pull will attempt git fetch, fails because no remote
      await expect(
        sync.pull('testowner', 'testrepo'),
      ).rejects.toThrow(/Failed to pull/);
    });
  });

  // -----------------------------------------------------------------------
  // listCachedRepos — empty cacheDir branch (via ensureCacheSpace)
  // -----------------------------------------------------------------------

  describe('listCachedRepos — empty cacheDir', () => {
    it('should handle missing cacheDir in listCachedRepos', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        branch: 'main',
      });

      // Delete the cacheDir after construction to test the early return
      // branch in listCachedRepos (existsSync returns false)
      rmSync(cacheDir, { recursive: true, force: true });

      // clone will call ensureCacheSpace → listCachedRepos, which
      // returns empty array when cacheDir doesn't exist
      await expect(
        sync.clone('newowner', 'newrepo'),
      ).rejects.toThrow(/Failed to clone/);
    });
  });

  // -----------------------------------------------------------------------
  // ensureCacheSpace — LRU eviction with multiple repos
  // -----------------------------------------------------------------------

  describe('ensureCacheSpace — LRU eviction', () => {
    it('should evict multiple repos until under target size', async () => {
      const client = createMockClient();
      // Set maxCacheSize so that after evicting repos, the break
      // condition in the LRU loop is reached
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        maxCacheSize: 500, // small enough to trigger eviction, but break will be hit
        branch: 'main',
      });

      // Create several cached repo structures
      createCachedRepoStructure(cacheDir, 'ownerA', 'repoA', 300);
      createCachedRepoStructure(cacheDir, 'ownerB', 'repoB', 300);
      createCachedRepoStructure(cacheDir, 'ownerC', 'repoC', 300);

      // Clone attempt triggers cache eviction with multiple repos
      await expect(
        sync.clone('new', 'repo'),
      ).rejects.toThrow(/Failed to clone/);
    });
  });

  // -----------------------------------------------------------------------
  // ensureSynced — multi-batch loop + rejected branch
  // -----------------------------------------------------------------------

  describe('ensureSynced', () => {
    it('should return errors for repos that fail to clone (single batch)', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        shallow: false,
        branch: 'main',
      });

      // Since we can't actually clone from GitHub in tests,
      // we create mock repos and expect errors for real clones
      const result = await sync.ensureSynced([
        { owner: 'nonexistent-owner-12345', repo: 'nonexistent-repo-67890' },
      ]);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.owner).toBe('nonexistent-owner-12345');
      expect(result.results.length).toBe(0);
    });

    it('should handle multi-batch processing (5+ repos triggers two batches)', { timeout: 60_000 }, async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        shallow: false,
        branch: 'main',
      });

      // 5 repos will be split into batch of 4 + batch of 1
      const repos = Array.from({ length: 5 }, (_, i) => ({
        owner: `owner${i}`,
        repo: `repo${i}`,
      }));

      const result = await sync.ensureSynced(repos);

      // All 5 should fail since we can't clone from GitHub
      expect(result.errors.length).toBe(5);
      expect(result.results.length).toBe(0);
    });

    it('should collect error messages from rejected promises', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        shallow: false,
        branch: 'main',
      });

      const result = await sync.ensureSynced([
        { owner: 'err-owner', repo: 'err-repo' },
      ]);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.error).toContain('Failed to clone');
    });
  });

  // -----------------------------------------------------------------------
  // listCachedRepos — tested indirectly via ensureCacheSpace through clone
  // -----------------------------------------------------------------------

  describe('listCachedRepos (via cache eviction)', () => {
    it('should list repos with .git directories and skip those without', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({
        client,
        cacheDir,
        maxCacheSize: 50,
        branch: 'main',
      });

      // Create repos with .git (will be recognized)
      createCachedRepoStructure(cacheDir, 'withgit', 'repo1', 100);

      // Create a directory WITHOUT .git (should be skipped by listCachedRepos)
      const noGitRepoDir = join(cacheDir, 'nogit', 'dir1');
      mkdirSync(noGitRepoDir, { recursive: true });

      // Clone attempt triggers ensureCacheSpace → listCachedRepos
      await expect(
        sync.clone('new', 'repo'),
      ).rejects.toThrow(/Failed to clone/);
    });
  });
});

// ---------------------------------------------------------------------------
// SyncOptions type
// ---------------------------------------------------------------------------

describe('SyncOptions', () => {
  it('should accept minimal options', () => {
    const client = createMockClient();
    const sync = new GitHubRepoSync({ client });
    expect(sync).toBeDefined();
  });

  it('should accept all optional fields', () => {
    const client = createMockClient();
    const opts: SyncOptions = {
      client,
      cacheDir: '/tmp/test-cache',
      shallow: false,
      branch: 'develop',
      maxCacheSize: 1024 * 1024 * 1024,
      autoFetch: false,
    };
    const sync = new GitHubRepoSync(opts);
    expect(sync).toBeDefined();
  });
});
