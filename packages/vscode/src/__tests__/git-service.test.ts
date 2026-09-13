// @code-analyzer/vscode — Git Service Tests

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitService } from '../services/git-service.js';

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService();
  });

  describe('getWorkspaceDiff', () => {
    // A throwaway repository holding one committed file and one uncommitted edit, so the
    // mapping is exercised every run.
    //
    // This replaced a test that asked the *ambient* repository for its diff and asserted
    // only `Array.isArray`. That version ran the mapper only when the developer happened
    // to have uncommitted changes, so the same commit measured 99.52% functions on a
    // clean tree and 100% on a dirty one — a number that depended on the working tree
    // rather than on the code. On CI, where the checkout is clean, the mapper was never
    // executed at all.
    let repo: string;

    beforeAll(() => {
      repo = mkdtempSync(join(tmpdir(), 'vscode-git-service-'));
      execSync('git init -q', { cwd: repo });
      execSync('git config user.email "test@test.com"', { cwd: repo });
      execSync('git config user.name "Test User"', { cwd: repo });
      writeFileSync(join(repo, 'tracked.ts'), 'export const value = 1;\n');
      execSync('git add -A', { cwd: repo });
      execSync('git commit -qm "initial"', { cwd: repo });
      // `getWorkspaceDiff` shells out to `git diff HEAD`, which reports tracked
      // modifications — so the file must be committed before it is edited.
      writeFileSync(join(repo, 'tracked.ts'), 'export const value = 2;\n');
    });

    afterAll(() => {
      rmSync(repo, { recursive: true, force: true });
    });

    it('maps an uncommitted change to path, status and oldPath', async () => {
      const diffs = await service.getWorkspaceDiff(repo);

      expect(diffs).toEqual([{ path: 'tracked.ts', status: 'modified', oldPath: undefined }]);
    });

    it('returns empty array for non-git directory', async () => {
      const diffs = await service.getWorkspaceDiff('/tmp/nonexistent-repo');
      expect(diffs).toEqual([]);
    });

    it('returns empty array for invalid path', async () => {
      const diffs = await service.getWorkspaceDiff('/tmp/nonexistent-directory-xyz');
      expect(diffs).toEqual([]);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns "unknown" for non-git directory', async () => {
      const branch = await service.getCurrentBranch('/tmp/nonexistent');
      expect(branch).toBe('unknown');
    });
  });

  describe('isDirty', () => {
    it('returns false for non-git directory', async () => {
      const dirty = await service.isDirty('/tmp/nonexistent');
      expect(dirty).toBe(false);
    });
  });

  describe('getLastCommit', () => {
    it('returns empty string for non-git directory', async () => {
      const commit = await service.getLastCommit('/tmp/nonexistent');
      expect(commit).toBe('');
    });
  });

  describe('listBranches', () => {
    it('returns empty array for non-git directory', async () => {
      const branches = await service.listBranches('/tmp/nonexistent');
      expect(branches).toEqual([]);
    });
  });
});
