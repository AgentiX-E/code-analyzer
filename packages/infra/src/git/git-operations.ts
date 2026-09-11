// @code-analyzer/infra — Git Operations
// Git integration using child_process.exec with proper error handling.

import { exec as cpExec } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { GitDiff, DiffRange, StalenessResult } from '@code-analyzer/shared';

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
      .catch((err: Error & { stderr: string }) => {
        // Invariant: every rejection raised by a spawned process carries
        // `stderr` as a string -- non-zero exit, signal death, timeout and
        // maxBuffer overflow all do, even when the captured text is empty. The
        // single failure mode without it (ERR_INVALID_ARG_VALUE, for a NUL byte
        // in the command) is thrown synchronously by exec() itself and therefore
        // never reaches this handler. An `err.message` fallback would be dead.
        throw new Error(`Git command failed: git ${args}\n${err.stderr}`);
      });
  }

  function parseDiffOutput(output: string): GitDiff[] {
    if (!output) return [];
    const diffs: GitDiff[] = [];
    const fileSections = output.split('diff --git ').filter(Boolean);

    for (const section of fileSections) {
      const lines = section.split('\n');
      // `section` survived `.filter(Boolean)`, so it is never the empty string
      // and `split` therefore always yields at least one element.
      const headerLine = lines[0]!;
      const pathMatch = headerLine.match(/^a\/(.+?)\s+b\/(.+)$/);
      if (!pathMatch) continue;

      // Both capture groups are mandatory `(.+)`, so they always participate and
      // the destination path is always present.
      const filePath = pathMatch[2]!;
      let changeType: GitDiff['changeType'] = 'modified';
      let oldPath: string | undefined;

      // Detect change type from subsequent headers
      for (let i = 1; i < Math.min(lines.length, 10); i++) {
        // The index is bounded by `lines.length`, so it always resolves.
        const line = lines[i]!;
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
        // The index is bounded by `lines.length`, so it always resolves.
        const line = lines[i]!;
        const hunkMatch = line.match(/^@@ -(\d+),?(\d*)\s+\+(\d+),?(\d*)\s+@@/);
        if (hunkMatch) {
          // The two start offsets are mandatory `(\d+)` groups and therefore
          // always capture a digit string; only the counts may be omitted.
          const oldStart = parseInt(hunkMatch[1]!, 10);
          const oldLines = parseInt(hunkMatch[2] || '1', 10);
          const newStart = parseInt(hunkMatch[3]!, 10);
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
      // Output format: <mode> <type> <hash>\t<path>. `git ls-tree` exits 0 with
      // empty output when the path is absent from the tree, in which case there
      // is no third field and the empty hash is returned.
      const parts = output.split(/\s+/);
      return parts[2] ?? '';
    },

    async listBranches(): Promise<string[]> {
      const output = await git(`branch -a --format='%(refname:short)'`);
      return output
        ? output
            .split('\n')
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
    },

    async getCurrentBranch(): Promise<string> {
      return git(`rev-parse --abbrev-ref HEAD`);
    },

    parseDiff(output: string): GitDiff[] {
      return parseDiffOutput(output);
    },
  };
}
