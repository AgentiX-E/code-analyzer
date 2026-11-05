// @code-analyzer/intelligence — the answer space of a checkout, as paths, without a parser
//
// **A fallback that could not enumerate its own answer space would not be a fallback.** The analyser's answer space
// comes out of the index - every file the parser accepted, in the graph. This module produces the same kind of list
// from the filesystem alone: a sorted set of repository-relative POSIX paths, filtered to source files. It reads no
// file, holds no graph and has no clock, so it is the only part of the product that can describe a twenty-thousand-file
// checkout on a runner that would be killed for trying to parse it.
//
// **Sorted, because a ranking over an unsorted universe is a ranking over a filesystem.** `readdir` order is not a
// promise; every figure this project publishes is set-based, and a list whose order moved between two runs would let a
// tie-break produce a number that changes when nothing changed.

import { readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

/**
 * The extensions the fallback considers source.
 *
 * **The eleven languages this project prioritises come first**, then the rest of the analyser's parsers, then the
 * configuration formats a question can name (`pom.xml`, `application.yml`, `package.json`). A locate over a repository
 * whose answer is a manifest is a real question - *"where is the retry timeout configured"* - and excluding the file
 * that holds it would make the fallback answer a narrower question than the one asked.
 */
export const SOURCE_EXTENSIONS: readonly string[] = [
  // The priority languages.
  '.java',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.groovy',
  '.xml',
  '.yaml',
  '.yml',
  '.json',
  '.kt',
  '.kts',
  '.swift',
  '.ets',
  '.arkts',
  // The rest of the analyser's parsers.
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.scala',
  '.dart',
  '.lua',
  '.sh',
  '.sql',
  '.css',
  '.scss',
  '.html',
  '.vue',
  '.svelte',
];

/**
 * Directories that are not the project's own code.
 *
 * **A name list rather than a heuristic**, because a heuristic that guesses wrong on a directory called `lib` would
 * either hide a third of a Java repository or walk a hundred thousand vendored files. Each name here is either a
 * version-control directory, a dependency directory, or a build output directory - none of them is where a fixing
 * commit lands, and all of them are large.
 */
export const SKIPPED_DIRECTORIES: readonly string[] = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  'target',
  'build',
  'dist',
  'out',
  '.gradle',
  '.idea',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
];

/** Ceiling on the answer space, **stated so a truncated universe is a published fact rather than a silent one**. */
export const MAX_SOURCE_FILES = 200_000;

/** Options for {@link walkSourceFiles}. **Printed by the command that uses them.** */
export interface FileTreeOptions {
  /** Extensions to keep, each including the dot. Defaults to {@link SOURCE_EXTENSIONS}. */
  readonly extensions?: readonly string[];
  /** Directory names to skip. Defaults to {@link SKIPPED_DIRECTORIES}. */
  readonly skipDirectories?: readonly string[];
  /** Stop after this many files. Defaults to {@link MAX_SOURCE_FILES}. */
  readonly maxFiles?: number;
}

/** The answer space, and whether the walk stopped early. */
export interface FileTree {
  /** Repository-relative POSIX paths, sorted. */
  readonly files: readonly string[];
  /** The walk hit `maxFiles` and stopped. **A truncated universe makes every figure over it a lower bound.** */
  readonly truncated: boolean;
}

/**
 * Every source file under `root`, as repository-relative POSIX paths.
 *
 * **The walk is depth-first and iterative-free of state beyond its own recursion**, which is what a directory tree
 * needs: a checkout deep enough to exhaust the stack is a checkout no analyser would survive either.
 *
 * **Symlinked directories are not followed.** A cycle would make the walk infinite and a `node_modules` symlinked from
 * three packages would multiply the universe; `readdir` marks a symlink as neither a file nor a directory, so skipping
 * the ones that are not files is the whole of the rule.
 */
export function walkSourceFiles(root: string, options: FileTreeOptions = {}): FileTree {
  const extensions = options.extensions ?? SOURCE_EXTENSIONS;
  const skip = new Set(options.skipDirectories ?? SKIPPED_DIRECTORIES);
  const maxFiles = options.maxFiles ?? MAX_SOURCE_FILES;
  const suffixes = extensions.map((extension) => extension.toLowerCase());

  const files: string[] = [];
  let truncated = false;

  const walk = (directory: string): void => {
    if (truncated) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue;
        walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const name = entry.name.toLowerCase();
      // **The suffix test is on the file's own name and not on the path**, so a directory called `json` cannot make
      // every file under it a candidate.
      if (!suffixes.some((suffix) => name.endsWith(suffix))) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      files.push(relative(root, join(directory, entry.name)).split(sep).join(posix.sep));
    }
  };

  walk(root);
  return { files: files.sort(), truncated };
}
