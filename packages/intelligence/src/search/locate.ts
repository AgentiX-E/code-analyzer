// @code-analyzer/intelligence — locating the file a question is about, without an index
//
// **The user story this answers is the one the product could not.** A checkout of twenty thousand files takes longer to
// index than a person will wait and more memory than a runner will give, and until now the answer to *"which file does
// this issue touch"* on such a checkout was an error. The error is honest and it is still an error: the reader has a
// repository, a question, and no ranking.
//
// **The fallback's document is a file's path and its imports.** Not its body - the body is what the analyser reads, and
// a fallback that read the body would be the same instrument with a smaller budget rather than a second one. A path says
// what a file is for, its imports say what it is wired to. That is enough to rank, and it costs one eight-kilobyte read
// per file rather than a parse.
//
// **And it takes a second arm when the caller has one.** Measured on Long Code Arena, this ranking beats the analyser's
// declaration pool by **0.12** on the 200-500-file band and loses to it by 0.15 on the smallest band - so a caller that
// already holds a declaration ranking gets `reciprocalRankFusion` of the two rather than a choice between them
// (`search/fusion.ts` states why the fusion is reciprocal rank and unweighted). An agent that has just run a search has
// exactly that list, and a reader who has just run `locate` on another revision has one too.
//
// **What this is not.** It is not the answer arm: it produces no prose, no explanation and no proof. It is a ranking,
// and the ranking is the half of the question that a reader can act on without waiting for an index.

import { walkSourceFiles } from './file-tree.js';
import { reciprocalRankFusion } from './fusion.js';
import { pathImportsRanking } from './path-imports.js';

import type { FileTreeOptions } from './file-tree.js';
import type { FusedRanking } from './fusion.js';
import type { PathImportsResult } from './path-imports.js';

/** How deep each arm is read before the fusion. **Two hundred, the depth every published column in this project reads.** */
export const FUSION_DEPTH = 200;

/** Options for {@link locateFiles}. **Every one of them is printed by the command that calls it.** */
export interface LocateOptions extends FileTreeOptions {
  /** How many paths to return. Defaults to ten, which is what a reader acts on. */
  readonly limit?: number;
  /** Files to rank instead of walking `root`. **The corpus case: the answer space is already a list.** */
  readonly files?: readonly string[];
  /**
   * A declaration-level ranking to fuse with the file-level one, **in the same coordinate system as `files`**.
   *
   * Absent means no fusion: the result is the file-level arm alone, which is what a reader with no index has. Present
   * means the order is `reciprocalRankFusion([declarations, file-level])`, and `fusion` carries the contributions.
   */
  readonly declarations?: readonly string[];
  /** How deep each arm is read before fusing. Defaults to {@link FUSION_DEPTH}. */
  readonly fusionDepth?: number;
  /** The fusion's rank constant. **Supplied only by an ablation.** */
  readonly k?: number;
}

/** A locate: the ranking, the universe it was drawn from, and whether that universe was complete. */
export interface LocateResult extends PathImportsResult {
  /** How many files were ranked. **The universe, stated, because a ranking over a prefix is a ranking.** */
  readonly answerSpace: number;
  /** The walk hit its cap. **A truncated universe makes the ranking a lower bound on the reachable answer.** */
  readonly truncated: boolean;
  /** The file-level arm alone, **the ranking before any fusion**. Published so the two can be told apart.** */
  readonly fileLevel: readonly string[];
  /** The fusion, or `null` when the caller supplied no declaration ranking. */
  readonly fusion: FusedRanking | null;
}

/**
 * Rank a checkout's files against a question, reading only paths and imports.
 *
 * **The universe cap is the walk's, not the ranking's.** `maxFiles` bounds how many files are described, and a checkout
 * that exceeds it still gets a ranking over the part that was described - truncated rather than refused, because a
 * ranking over forty thousand files is still a ranking and a refusal is not.
 *
 * **The arm depth and the returned depth are different numbers, and using one for both was the alternative.** A caller
 * that asks for ten files and supplies a two-hundred-entry declaration ranking needs the file-level arm read to the
 * same two hundred; reading it to ten would fuse a two-hundred-long list against a ten-long one, and the ten files the
 * reader never sees would be the ones that decided the order of the ten they do.
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
  const limit = options.limit ?? 10;
  const depth =
    options.declarations === undefined ? limit : Math.max(limit, options.fusionDepth ?? FUSION_DEPTH);
  const ranking = pathImportsRanking({
    checkout: root,
    files,
    query: question,
    limit: depth,
  });
  if (options.declarations === undefined) {
    return { ...ranking, answerSpace: files.length, truncated, fileLevel: ranking.ranked, fusion: null };
  }
  const fusion = reciprocalRankFusion(
    [
      { name: 'declarations', ranked: options.declarations },
      { name: 'file-level', ranked: ranking.ranked },
    ],
    { ...(options.k === undefined ? {} : { k: options.k }), limit },
  );
  return {
    ...ranking,
    ranked: fusion.ranked,
    answerSpace: files.length,
    truncated,
    fileLevel: ranking.ranked,
    fusion,
  };
}
