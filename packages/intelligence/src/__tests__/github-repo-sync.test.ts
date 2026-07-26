// @code-analyzer/intelligence — GitHub Repo Sync Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('GitHubRepoSync', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = createTempDir();
  });

  afterEach(() => {
    try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* */ }
  });

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
  });

  describe('isCached', () => {
    it('should return false for non-cached repos', () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir });
      expect(sync.isCached('owner', 'nonexistent')).toBe(false);
    });
  });

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
  });

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
  });

  describe('ensureSynced', () => {
    it('should return results and errors for a list of repos', async () => {
      const client = createMockClient();
      const sync = new GitHubRepoSync({ client, cacheDir, shallow: false });

      // Since we can't actually clone from GitHub in tests,
      // we create mock repos and expect errors for real clones
      const result = await sync.ensureSynced([
        { owner: 'nonexistent-owner-12345', repo: 'nonexistent-repo-67890' },
      ]);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]!.owner).toBe('nonexistent-owner-12345');
      expect(result.results.length).toBe(0);
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
