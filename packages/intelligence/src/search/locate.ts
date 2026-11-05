// @code-analyzer/intelligence — locating the file a question is about, without an index
//
// **The user story this answers is the one the product could not.** A checkout of twenty thousand files takes longer to
// index than a person will wait and more memory than a runner will give, and until now the answer to *"which file does
// this issue touch"* on such a checkout was an error. The error is honest and it is still an error: the reader has a
// repository, a question, and no ranking.
//
// **The fallback's document is a file's path and its imports.** Not its body - the body is what the analyser reads, and
// a fallback that read the body would be the same instrument with a smaller budget rather than a second one. A path says
// what a file is for; its imports say what it is wired to. That is enough to rank, and it costs one eight-kilobyte read
// per file rather than a parse.
//
// **What this is not.** It is not the answer arm: it produces no prose, no explanation and no proof. It is a ranking,
// and the ranking is the half of the question that a reader can act on without waiting for an index.

import { walkSourceFiles } from './file-tree.js';
import { pathImportsRanking } from './path-imports.js';

import type { FileTreeOptions } from './file-tree.js';
import type { PathImportsResult } from './path-imports.js';

/** Options for {@link locateFiles}. **Every one of them is printed by the command that calls it.** */
export interface LocateOptions extends FileTreeOptions {
  /** How many paths to return. Defaults to ten, which is what a reader acts on. */
  readonly limit?: number;
  /** Files to rank instead of walking `root`. **The corpus case: the answer space is already a list.** */
  readonly files?: readonly string[];
}

/** A locate: the ranking, the universe it was drawn from, and whether that universe was complete. */
export interface LocateResult extends PathImportsResult {
  /** How many files were ranked. **The universe, stated, because a ranking over a prefix is not a ranking.** */
  readonly answerSpace: number;
  /** The walk hit its cap. **A truncated universe makes the ranking a lower bound on the reachable answer.** */
  readonly truncated: boolean;
}

/**
 * Rank a checkout's files against a question, reading only paths and imports.
 *
 * **The universe cap is the walk's, not the ranking's.** `maxFiles` bounds how many files are described, and a checkout
 * that exceeds it still gets a ranking over the part that was described - truncated rather than refused, because a
 * ranking over forty thousand files is still a ranking and a refusal is not.
 */
export function locateFiles(
  root: string,
  question: string,
  options: LocateOptions = {},
): LocateResult {
  let files: readonly string[];
  let truncated = false;
  if (options.files === undefined) {
    const walked = walkSourceFiles(root, options);
    files = walked.files;
    truncated = walked.truncated;
  } else {
    files = options.files;
  }
  const ranking = pathImportsRanking({
    checkout: root,
    files,
    query: question,
    limit: options.limit ?? 10,
  });
  return { ...ranking, answerSpace: files.length, truncated };
}
