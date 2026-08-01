// @code-analyzer/vscode — Git Service
// Provides git operation wrappers for the VS Code extension.
// Delegates to @code-analyzer/infra git-operations.

import { createGitOperations } from '@code-analyzer/infra';

export interface DiffInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export class GitService {
  /**
   * Get workspace diffs (uncommitted changes).
   */
  async getWorkspaceDiff(workspaceRoot: string): Promise<DiffInfo[]> {
    try {
      const git = createGitOperations(workspaceRoot);
      const diffs = await git.getWorkspaceDiff();
      return diffs.map((d) => ({
        path: d.filePath,
        status: d.changeType as DiffInfo['status'],
        oldPath: d.oldPath,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(workspaceRoot: string): Promise<string> {
    try {
      const git = createGitOperations(workspaceRoot);
      return await git.getCurrentBranch();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if the workspace has uncommitted changes.
   */
  async isDirty(workspaceRoot: string): Promise<boolean> {
    try {
      const git = createGitOperations(workspaceRoot);
      return await git.isDirty();
    } catch {
      return false;
    }
  }

  /**
   * Get the last commit hash.
   */
  async getLastCommit(workspaceRoot: string): Promise<string> {
    try {
      const git = createGitOperations(workspaceRoot);
      return await git.getLastCommit();
    } catch {
      return '';
    }
  }

  /**
   * List all branches.
   */
  async listBranches(workspaceRoot: string): Promise<string[]> {
    try {
      const git = createGitOperations(workspaceRoot);
      return await git.listBranches();
    } catch {
      return [];
    }
  }
}
