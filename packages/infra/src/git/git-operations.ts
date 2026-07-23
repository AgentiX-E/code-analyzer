// @code-analyzer/infra — Git Operations
// Git integration using child_process.exec with proper error handling.

import { exec as cpExec } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type {
  GitDiff,
  DiffRange,
  StalenessResult,
} from '@code-analyzer/shared';

const execAsync = promisify(cpExec);

export interface GitOperations {
  getDiff(from: string, to: string, contextLines?: number): Promise<GitDiff[]>;
  getWorkspaceDiff(): Promise<GitDiff[]>;
  getCommitDiff(commit: string): Promise<GitDiff[]>;
  getMergeBase(from: string, to: string): Promise<string>;
  getChangedFiles(from: string, to: string): Promise<string[]>;
  getLastCommit(): Promise<string>;
  isDirty(): Promise<boolean>;
  getStaleness(lastIndexedCommit: string): Promise<StalenessResult>;
  getFileContent(ref: string, filePath: string): Promise<string>;
  getFileHash(ref: string, filePath: string): Promise<string>;
  listBranches(): Promise<string[]>;
  getCurrentBranch(): Promise<string>;
  parseDiff(output: string): GitDiff[];
}

export function createGitOperations(repoPath: string): GitOperations {
  const resolvedPath = path.resolve(repoPath);

  function git(args: string): Promise<string> {
    return execAsync(`git -C "${resolvedPath}" ${args}`, {
      maxBuffer: 50 * 1024 * 1024, // 50MB
    })
      .then(({ stdout }) => stdout.trim())
      .catch((err: Error & { stderr?: string; code?: number }) => {
        /* v8 ignore next */
        const message = err.stderr ?? err.message;
        throw new Error(`Git command failed: git ${args}\n${message}`);
      });
  }

  function parseDiffOutput(output: string): GitDiff[] {
    if (!output) return [];
    const diffs: GitDiff[] = [];
    const fileSections = output.split('diff --git ').filter(Boolean);

    for (const section of fileSections) {
      const lines = section.split('\n');
      /* v8 ignore next */
      const headerLine = lines[0] ?? '';
      const pathMatch = headerLine.match(/^a\/(.+?)\s+b\/(.+)$/);
      if (!pathMatch) continue;

      /* v8 ignore next */
      const filePath = pathMatch[2] ?? pathMatch[1] ?? '';
      let changeType: GitDiff['changeType'] = 'modified';
      let oldPath: string | undefined;

      // Detect change type from subsequent headers
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        /* v8 ignore next */
        const line = lines[i] ?? '';
        if (line.startsWith('new file mode')) changeType = 'added';
        else if (line.startsWith('deleted file mode')) changeType = 'deleted';
        else if (line.startsWith('rename from ')) {
          changeType = 'renamed';
          oldPath = line.replace('rename from ', '').trim();
        }
      }

      // Parse hunks
      const ranges: DiffRange[] = [];
      for (let i = 1; i < lines.length; i++) {
        /* v8 ignore next */
        const line = lines[i] ?? '';
        const hunkMatch = line.match(/^@@ -(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
        if (hunkMatch) {
          /* v8 ignore next */
          const oldStart = parseInt(hunkMatch[1] ?? '0', 10);
          const oldLines = parseInt(hunkMatch[2] || '1', 10);
          /* v8 ignore next */
          const newStart = parseInt(hunkMatch[3] ?? '0', 10);
          const newLines = parseInt(hunkMatch[4] || '1', 10);

          ranges.push({
            oldStart,
            newStart,
            oldEnd: oldStart + oldLines - 1,
            newEnd: newStart + newLines - 1,
            changeType: 'modified',
          });
        }
      }

      diffs.push({
        filePath,
        oldHash: '',
        newHash: '',
        ranges,
        changeType,
        oldPath,
      });
    }

    return diffs;
  }

  return {
    async getDiff(from: string, to: string, contextLines = 3): Promise<GitDiff[]> {
      const output = await git(`diff -U${contextLines} ${from}..${to}`);
      return parseDiffOutput(output);
    },

    async getWorkspaceDiff(): Promise<GitDiff[]> {
      const output = await git(`diff HEAD`);
      return parseDiffOutput(output);
    },

    async getCommitDiff(commit: string): Promise<GitDiff[]> {
      const output = await git(`diff ${commit}^..${commit}`);
      return parseDiffOutput(output);
    },

    async getMergeBase(from: string, to: string): Promise<string> {
      return git(`merge-base ${from} ${to}`);
    },

    async getChangedFiles(from: string, to: string): Promise<string[]> {
      const output = await git(`diff --name-only ${from}..${to}`);
      return output ? output.split('\n') : [];
    },

    async getLastCommit(): Promise<string> {
      return git(`rev-parse HEAD`);
    },

    async isDirty(): Promise<boolean> {
      const output = await git(`status --porcelain`);
      return output.length > 0;
    },

    async getStaleness(lastIndexedCommit: string): Promise<StalenessResult> {
      try {
        const head = await git(`rev-parse HEAD`);
        if (head === lastIndexedCommit) {
          return {
            nodeId: 0,
            nodeQname: '',
            isStale: false,
          };
        }
        return {
          nodeId: 0,
          nodeQname: '',
          isStale: true,
          reason: `HEAD (${head}) != last indexed commit (${lastIndexedCommit})`,
        };
      } catch {
        return {
          nodeId: 0,
          nodeQname: '',
          isStale: true,
          reason: 'Unable to determine staleness',
        };
      }
    },

    async getFileContent(ref: string, filePath: string): Promise<string> {
      try {
        return await git(`show ${ref}:${filePath}`);
      } catch {
        throw new Error(`File not found: ${filePath} at ref ${ref}`);
      }
    },

    async getFileHash(ref: string, filePath: string): Promise<string> {
      const output = await git(`ls-tree ${ref} "${filePath}"`);
      // Output format: <mode> <type> <hash>\t<path>
      const parts = output.split(/\s+/);
      /* v8 ignore next */
      return parts[2] ?? '';
    },

    async listBranches(): Promise<string[]> {
      const output = await git(`branch -a --format='%(refname:short)'`);
      return output ? output.split('\n').map((b) => b.trim()).filter(Boolean) : [];
    },

    async getCurrentBranch(): Promise<string> {
      return git(`rev-parse --abbrev-ref HEAD`);
    },

    parseDiff(output: string): GitDiff[] {
      return parseDiffOutput(output);
    },
  };
}
