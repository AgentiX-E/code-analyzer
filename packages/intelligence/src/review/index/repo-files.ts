// @code-analyzer/intelligence — the index finally has a reader that can see a checkout
//
// **§100 put the index in front of the sentence and left it without a supply.** Every caller of `buildRepoIndex` had
// already decided which files to read: a benchmark that fetched the changed files, a report that globbed
// `packages/*/src`. **A repository on disk is the source none of them had**, and it is the one a product has - an action
// runs inside a checkout, so the whole graph is already on local disk and costs no request to read.
//
// **Four refusals, and each one is a cap the caller can see.**
//
// 1. **A dependency is not this repository.** `node_modules` alone holds more files than every source tree in it, and an
//    index over it would report rates about other people's code. The skip list is a default and the caller may change
//    it, because a corpus whose sources *are* under `vendor/` is a real repository.
// 2. **An artefact is not a declaration.** `dist/`, `build/`, `target/` hold compiled copies of files the walk already
//    read, and reading both would double every count and make `impactOf` answer with a `.js` file nobody edits.
// 3. **A file too large to be source is skipped rather than truncated**, and the byte count it was refused for is in the
//    stats: a truncated file would produce an import whose specifier is cut in half, which is a *wrong* edge rather than
//    a missing one.
// 4. **A cap that hides files says so.** `skippedOverCap` exists so a caller cannot mistake a repository of twenty
//    thousand files for the two thousand it indexed - **a silent cap is an index that reports a smaller repository as a
//    fact**.
//
// **Why synchronous.** The caller is a review that is about to spend a model call on the result: a walk of a few
// thousand files is tens of milliseconds, it is not the slow part, and a promise here would buy nothing but a reason for
// every test of the index to become asynchronous.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { RepoFile } from './repo-index.js';

/** What the walk will and will not read. Every field has a default that is safe for a checkout of a real repository. */
export interface RepoFileLimits {
  /** Extensions, with the dot. **The default is exactly the set the index can read**, so the walk cannot add files that
   * would raise `stats.files` without raising what the index knows. */
  readonly extensions?: readonly string[];
  readonly skipDirectories?: readonly string[];
  /** Files. Two thousand is more than any of the corpora this repository measures on, and a cap above that is a walk
   * that will not finish inside a review. */
  readonly maxFiles?: number;
  /** Bytes per file. Half a megabyte, because a source file larger than that is generated and an import cut out of it
   * would be a wrong edge rather than a missing one. */
  readonly maxFileBytes?: number;
  /** Bytes for the whole walk. **A repository is not the only thing that can be large**: a monorepo of forty thousand
   * source files is a checkout a review can still afford to look at, and holding all of it in memory is not. */
  readonly maxTotalBytes?: number;
  /**
   * **The files the caller will not read, said as a rule rather than as a list.** The extension is the index's
   * question; this is the caller's - a `.d.ts` is a declaration of a file the walk already read, and a `.test.ts` is
   * not what a review of `src` is about. **A file the caller refused is not counted as considered**, so the counts stay
   * rates over the corpus the caller asked for.
   */
  readonly accept?: (path: string) => boolean;
}

/** What the walk did, in the terms a caller can check. */
export interface RepoTreeStats {
  /** Whether the root was a directory at all. **A review that cannot see a checkout must still run.** */
  readonly readable: boolean;
  /** Files whose extension the caller asked for, whether or not they were read. */
  readonly considered: number;
  readonly read: number;
  readonly bytes: number;
  readonly skippedBySize: number;
  /** Files the cap hid. **The field that keeps a capped walk from reporting a smaller repository as a fact.** */
  readonly skippedOverCap: number;
  /** Files the byte cap hid, counted apart from the file cap because the two caps bind for different repositories. */
  readonly skippedOverBytes: number;
  readonly skippedUnreadable: number;
  readonly directoriesSkipped: number;
}

/** A checkout as the index takes it: files, and what reading them cost. */
export interface RepoTree {
  readonly files: readonly RepoFile[];
  readonly stats: RepoTreeStats;
}

/** The languages `repo-index.ts` has a reader for, which is the only reason to read a file at all. */
const DEFAULT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.java',
  '.kt',
  '.kts',
  '.groovy',
  '.py',
  '.swift',
  '.ets',
] as const;

/** Directories that are never this repository's sources. */
const DEFAULT_SKIP = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
] as const;

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** The extension of a path, lowercased, or `''`. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

/**
 * **Every file under `root` that the index can read, sorted by path.**
 *
 * Sorted rather than in `readdir` order, because **an index built twice from one repository must be the same index**:
 * the edge list is sorted by path, and a walk that handed back the filesystem's order would make two runs' statistics
 * differ for a reason no one could reproduce.
 */
export function readRepoFiles(root: string, limits: RepoFileLimits = {}): RepoTree {
  const extensions = new Set(limits.extensions ?? DEFAULT_EXTENSIONS);
  const skip = new Set(limits.skipDirectories ?? DEFAULT_SKIP);
  const maxFiles = Math.max(1, limits.maxFiles ?? DEFAULT_MAX_FILES);
  const maxFileBytes = Math.max(1, limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  const maxTotalBytes = Math.max(1, limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES);
  const accept = limits.accept ?? (() => true);

  const empty = (readable: boolean): RepoTree => ({
    files: [],
    stats: {
      readable,
      considered: 0,
      read: 0,
      bytes: 0,
      skippedBySize: 0,
      skippedOverCap: 0,
      skippedOverBytes: 0,
      skippedUnreadable: 0,
      directoriesSkipped: 0,
    },
  });

  try {
    if (!statSync(root).isDirectory()) return empty(false);
  } catch {
    return empty(false);
  }

  const out: RepoFile[] = [];
  let considered = 0;
  let bytes = 0;
  let skippedBySize = 0;
  let skippedOverCap = 0;
  let skippedOverBytes = 0;
  let skippedUnreadable = 0;
  let directoriesSkipped = 0;

  const walk = (relative: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      // **A symbolic link is not followed.** A checkout can hold a link to a parent directory, and a walk that followed
      // one would index the repository once per link, or never finish.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) {
          directoriesSkipped += 1;
          continue;
        }
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!extensions.has(extensionOf(path))) continue;
      if (!accept(path)) continue;
      considered += 1;
      if (out.length >= maxFiles) {
        skippedOverCap += 1;
        continue;
      }
      try {
        const size = statSync(join(root, path)).size;
        if (size > maxFileBytes) {
          skippedBySize += 1;
          continue;
        }
        if (bytes + size > maxTotalBytes) {
          skippedOverBytes += 1;
          continue;
        }
        const text = readFileSync(join(root, path), 'utf8');
        bytes += text.length;
        out.push({ path, text });
      } catch {
        skippedUnreadable += 1;
      }
    }
  };

  walk('');

  out.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    files: out,
    stats: {
      readable: true,
      considered,
      read: out.length,
      bytes,
      skippedBySize,
      skippedOverCap,
      skippedOverBytes,
      skippedUnreadable,
      directoriesSkipped,
    },
  };
}
