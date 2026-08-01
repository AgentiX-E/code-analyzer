// @code-analyzer/vscode — Git Service Tests

import { describe, it, expect } from 'vitest';
import { GitService } from '../services/git-service.js';

describe('GitService', () => {
  let service: GitService;

  beforeEach(() => {
    service = new GitService();
  });

  describe('getWorkspaceDiff', () => {
    it('returns empty array for non-git directory', async () => {
      const diffs = await service.getWorkspaceDiff('/tmp/nonexistent-repo');
      expect(diffs).toEqual([]);
    });

    it('returns empty array for invalid path', async () => {
      const diffs = await service.getWorkspaceDiff('/tmp/nonexistent-directory-xyz');
      expect(diffs).toEqual([]);
    });

    it('handles current working directory', async () => {
      const diffs = await service.getWorkspaceDiff(process.cwd());
      expect(Array.isArray(diffs)).toBe(true);
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
