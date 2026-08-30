// @code-analyzer/intelligence — GitHub Repo Sync deterministic branch tests
//
// The sibling github-repo-sync.test.ts is excluded from the coverage run
// because its fresh-clone cases invoke a real `git clone` against github.com,
// which hangs in sandboxed/offline environments. This file instead mocks
// `node:child_process` execSync so the git operations return instantly and
// deterministically, and covers every branch that is NOT already guarded by a
// `/* v8 ignore */` annotation in repo-sync.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHubRepoSync } from '../github/repo-sync.js';
import type { SyncOptions } from '../github/repo-sync.js';
import { GitHubApiClient } from '../github/client.js';

// Mock execSync so `git clone` / `git fetch` / `git rev-parse` never spawn a
// real process (which would block on network access in sandboxed CI).
const execSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

function makeClient(): GitHubApiClient {
  return new GitHubApiClient({ token: 'ghp_test' });
}

function createTempDir(): string {
  const dir = join(tmpdir(), `ca-repo-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createCachedRepo(
  baseDir: string,
  owner: string,
  repo: string,
  fileSize: number,
  mtime: Date | null = null,
): string {
  const repoDir = join(baseDir, owner, repo);
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  writeFileSync(join(repoDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(repoDir, 'dummy.txt'), 'x'.repeat(fileSize));
  if (mtime) {
    utimesSync(repoDir, mtime, mtime);
  }
  return repoDir;
}

function createDirWithoutGit(baseDir: string, owner: string, name: string): string {
  const dir = join(baseDir, owner, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'file.txt'), 'x'.repeat(50));
  return dir;
}

describe('GitHubRepoSync — deterministic branches', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = createTempDir();
    execSyncMock.mockReset();
    execSyncMock.mockImplementation((cmd: string) =>
      cmd.includes('rev-parse') ? 'mock-sha\n' : '',
    );
  });

  afterEach(() => {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // -----------------------------------------------------------------------
  // Constructor `??` defaults
  // -----------------------------------------------------------------------

  it('falls back to the default cache dir when none is provided', () => {
    const sync = new GitHubRepoSync({ client: makeClient() });
    expect(sync.getPath('o', 'r')).toContain(join('.code-analyzer', 'repos'));
  });

  it('uses the provided cacheDir / shallow / maxCacheSize / autoFetch', () => {
    const opts: SyncOptions = {
      client: makeClient(),
      cacheDir,
      shallow: false,
      branch: 'develop',
      maxCacheSize: 1024,
      autoFetch: false,
    };
    const sync = new GitHubRepoSync(opts);
    expect(sync.getPath('o', 'r')).toContain(cacheDir);
    expect(sync.isCached('o', 'r')).toBe(false);
  });

  it('creates a non-existent cache directory on construction', () => {
    const newDir = join(cacheDir, 'nested', 'new');
    expect(existsSync(newDir)).toBe(false);
    new GitHubRepoSync({ client: makeClient(), cacheDir: newDir });
    expect(existsSync(newDir)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // remove / clearCache / getCacheSize
  // -----------------------------------------------------------------------

  it('remove returns false for a non-cached repo and true after removal', () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir });
    expect(sync.remove('o', 'missing')).toBe(false);
    createCachedRepo(cacheDir, 'o', 'present', 10);
    expect(sync.remove('o', 'present')).toBe(true);
    expect(sync.remove('o', 'present')).toBe(false);
  });

  it('clearCache recreates the directory, and tolerates a missing dir', () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir });
    createCachedRepo(cacheDir, 'o', 'r', 10);
    sync.clearCache();
    expect(existsSync(cacheDir)).toBe(true);
    rmSync(cacheDir, { recursive: true, force: true });
    expect(() => sync.clearCache()).not.toThrow();
  });

  it('getCacheSize returns 0 for a missing dir and sums nested files', () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir });
    rmSync(cacheDir, { recursive: true, force: true });
    expect(sync.getCacheSize()).toBe(0);
    mkdirSync(cacheDir, { recursive: true });

    const nested = join(cacheDir, 'o', 'r', 'sub');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(cacheDir, 'o', 'r', 'f.txt'), 'hello'); // 5 bytes
    writeFileSync(join(nested, 'g.txt'), 'world!'); // 6 bytes
    expect(sync.getCacheSize()).toBeGreaterThanOrEqual(11);
  });

  // -----------------------------------------------------------------------
  // clone — already cached (autoFetch disabled)
  // -----------------------------------------------------------------------

  it('returns the cached SHA without syncing when autoFetch is disabled', async () => {
    const sync = new GitHubRepoSync({
      client: makeClient(),
      cacheDir,
      autoFetch: false,
      branch: 'main',
    });
    createCachedRepo(cacheDir, 'o', 'r', 10);
    const result = await sync.clone('o', 'r');
    expect(result.commitSha).toBe('mock-sha');
    expect(result.synced).toBe(false);
    expect(result.branch).toBe('main');
  });

  // -----------------------------------------------------------------------
  // clone — fresh path (mocked git) + ensureCacheSpace below the limit
  // -----------------------------------------------------------------------

  it('clones fresh below the cache limit without eviction', async () => {
    const sync = new GitHubRepoSync({
      client: makeClient(),
      cacheDir,
      maxCacheSize: 5 * 1024 * 1024 * 1024,
      branch: 'main',
    });
    const result = await sync.clone('o', 'newrepo');
    expect(result.synced).toBe(true);
    expect(result.commitSha).toBe('mock-sha');
  });

  // -----------------------------------------------------------------------
  // clone — fresh path + LRU eviction (ensureCacheSpace listCachedRepos)
  // -----------------------------------------------------------------------

  it('evicts LRU repos and stops once the target size is reached', async () => {
    const base = new Date(Date.now() - 60_000);
    // One large repo (oldest) plus two small ones; total 1200 > max 1000.
    createCachedRepo(cacheDir, 'a', 'big', 1000, new Date(base.getTime()));
    createCachedRepo(cacheDir, 'a', 'small1', 100, new Date(base.getTime() + 1000));
    createCachedRepo(cacheDir, 'a', 'small2', 100, new Date(base.getTime() + 2000));
    // A directory without .git — must be skipped by listCachedRepos.
    createDirWithoutGit(cacheDir, 'a', 'not-a-repo');

    const sync = new GitHubRepoSync({
      client: makeClient(),
      cacheDir,
      maxCacheSize: 1000,
      branch: 'main',
    });

    const result = await sync.clone('b', 'newrepo');
    expect(result.synced).toBe(true);
    // The big repo was evicted (size 1200 → 1000 freed → 200 ≤ 700 target).
    expect(sync.isCached('a', 'big')).toBe(false);
    // The two small repos survive because the loop broke early.
    expect(sync.isCached('a', 'small1')).toBe(true);
    expect(sync.isCached('a', 'small2')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // pull — delegate to clone, fetch when cached, `?? 'main'` branch
  // -----------------------------------------------------------------------

  it('pull delegates to clone when the repo is not cached', async () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir, branch: 'main' });
    const result = await sync.pull('o', 'notcached');
    expect(result.synced).toBe(true);
    expect(result.commitSha).toBe('mock-sha');
  });

  it('pull fetches a cached repo and defaults the branch to main', async () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir }); // no branch
    createCachedRepo(cacheDir, 'o', 'r', 10);
    const result = await sync.pull('o', 'r');
    expect(result.branch).toBe('main');
    expect(result.commitSha).toBe('mock-sha');
  });

  // -----------------------------------------------------------------------
  // ensureSynced — error collection (Error and non-Error rejection reasons)
  // -----------------------------------------------------------------------

  it('collects the error message when clone rejects with an Error', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('clone exploded');
    });
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir, branch: 'main' });
    const result = await sync.ensureSynced([{ owner: 'o', repo: 'r' }]);
    expect(result.results).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('clone exploded');
  });

  it('serializes a non-Error rejection reason into the error message', async () => {
    execSyncMock.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain string failure';
    });
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir, branch: 'main' });
    const result = await sync.ensureSynced([{ owner: 'o', repo: 'r' }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.error).toContain('plain string failure');
  });

  it('splits a list of five repos into two batches', async () => {
    const sync = new GitHubRepoSync({ client: makeClient(), cacheDir, branch: 'main' });
    const result = await sync.ensureSynced([
      { owner: 'o0', repo: 'r0' },
      { owner: 'o1', repo: 'r1' },
      { owner: 'o2', repo: 'r2' },
      { owner: 'o3', repo: 'r3' },
      { owner: 'o4', repo: 'r4' },
    ]);
    // All five succeed against the mocked git, filling two batches of 4 + 1.
    expect(result.results).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
  });
});
