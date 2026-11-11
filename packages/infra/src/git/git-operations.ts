// @code-analyzer/infra — Git Operations
// Git integration using child_process.exec with proper error handling.

import { execFile as cpExecFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { assertGitArgument } from './assert-git-argument.js';

import type { GitDiff, DiffRange, StalenessResult } from '@code-analyzer/shared';

// **`execFile`, not `exec`, and the difference is the shell.** `exec` hands its string to `/bin/sh`, so every ref, commit
// range and file path this module interpolated was shell syntax - and a branch is named by whoever pushed it. **A pull
// request can name a branch `HEAD; curl …`**, which made `getDiff` a command injection with a two-word payload; CodeQL
// reported it eight times in this file before the argument vector replaced the string.
const execFileAsync = promisify(cpExecFile);

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

/**
 * The destination path of a `diff --git a/<old> b/<new>` header, or `null` if the header is not one.
 *
 * **`indexOf` rather than `a\/(.+?) b\/(.+)`**, for the reason the caller's comment gives: a lazy group between two
 * captures lets a long path be partitioned in as many ways as it has spaces. **The first ` b/` wins and not the last**,
 * because a path may contain a space and the separator git writes is exactly one - so `a/x b/y b/z` names `x b/y` as the
 * source. Starting the search after the `a/` prefix keeps a path that begins with `b/` from being read as the separator.
 */
function splitDiffHeader(headerLine: string): string | null {
  if (!headerLine.startsWith('a/')) return null;
  const separator = headerLine.indexOf(' b/', 2);
  if (separator < 0) return null;
  const destination = headerLine.slice(separator + 3);
  // Both sides of the header are non-empty in a header git writes, and a header with an empty side is not one.
  return separator > 2 && destination.length > 0 ? destination : null;
}

export function createGitOperations(repoPath: string): GitOperations {
  const resolvedPath = path.resolve(repoPath);

  /**
   * **Every argument is an element of an array, so nothing here can become shell syntax.**
   *
   * `-C <path>` is passed the same way, which also removes a quoting bug the string version had: a checkout whose path
   * contained a double quote produced a command `git` parsed as two.
   */
  function git(args: readonly string[]): Promise<string> {
    return execFileAsync('git', ['-C', resolvedPath, ...args], {
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
        throw new Error(`Git command failed: git ${args.join(' ')}\n${err.stderr}`);
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
      // **`\s+` before `b/` gave the engine a run to partition against a lazy group**, so a header whose path is a long
      // run of spaces cost the square of its length. Git separates the two paths with exactly one space - the same
      // correction `review/actionability.ts` carries - and a path containing a space is still read at its first ` b/`.
      // `splitDiffHeader` does that search with `indexOf`, which has one answer rather than a family of them.
      const filePath = splitDiffHeader(headerLine);
      if (filePath === null) continue;
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
        // As in `review/diff-parser.ts`: a run of digits could be split between the start and the count in as many ways
        // as it is long, and the trailing `\s+` multiplied them. Git writes one space, one comma, one space.
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d*))? \+(\d+)(?:,(\d*))? @@/);
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
      assertGitArgument(from, 'the from ref');
      assertGitArgument(to, 'the to ref');
      const output = await git(['diff', `-U${String(contextLines)}`, `${from}..${to}`]);
      return parseDiffOutput(output);
    },

    async getWorkspaceDiff(): Promise<GitDiff[]> {
      const output = await git(['diff', 'HEAD']);
      return parseDiffOutput(output);
    },

    async getCommitDiff(commit: string): Promise<GitDiff[]> {
      assertGitArgument(commit, 'the commit');
      const output = await git(['diff', `${commit}^..${commit}`]);
      return parseDiffOutput(output);
    },

    async getMergeBase(from: string, to: string): Promise<string> {
      assertGitArgument(from, 'the from ref');
      assertGitArgument(to, 'the to ref');
      return git(['merge-base', from, to]);
    },

    async getChangedFiles(from: string, to: string): Promise<string[]> {
      assertGitArgument(from, 'the from ref');
      assertGitArgument(to, 'the to ref');
      const output = await git(['diff', '--name-only', `${from}..${to}`]);
      return output ? output.split('\n') : [];
    },

    async getLastCommit(): Promise<string> {
      return git(['rev-parse', 'HEAD']);
    },

    async isDirty(): Promise<boolean> {
      const output = await git(['status', '--porcelain']);
      return output.length > 0;
    },

    async getStaleness(lastIndexedCommit: string): Promise<StalenessResult> {
      try {
        const head = await git(['rev-parse', 'HEAD']);
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
      // **Before the try, because the catch below rewrites every failure as "File not found"** - and a refusal reported as
      // a missing file is a refusal the caller will route around.
      assertGitArgument(ref, 'the ref');
      try {
        return await git(['show', `${ref}:${filePath}`]);
      } catch {
        throw new Error(`File not found: ${filePath} at ref ${ref}`);
      }
    },

    async getFileHash(ref: string, filePath: string): Promise<string> {
      assertGitArgument(ref, 'the ref');
      const output = await git(['ls-tree', ref, filePath]);
      // Output format: <mode> <type> <hash>\t<path>. `git ls-tree` exits 0 with
      // empty output when the path is absent from the tree, in which case there
      // is no third field and the empty hash is returned.
      const parts = output.split(/\s+/);
      return parts[2] ?? '';
    },

    async listBranches(): Promise<string[]> {
      const output = await git(['branch', '-a', '--format=%(refname:short)']);
      return output
        ? output
            .split('\n')
            .map((b) => b.trim())
            .filter(Boolean)
        : [];
    },

    async getCurrentBranch(): Promise<string> {
      return git(['rev-parse', '--abbrev-ref', 'HEAD']);
    },

    parseDiff(output: string): GitDiff[] {
      return parseDiffOutput(output);
    },
  };
}
