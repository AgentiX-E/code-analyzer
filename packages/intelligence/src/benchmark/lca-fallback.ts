// @code-analyzer/intelligence — the file-level fallback, read as a measurement arm
//
// **The arm exists because the product's coverage is a published number.** A mean over the instances a runner could fit
// is not the mean the corpus publishes, and the instances it could not fit are the large repositories where ranking is
// hardest. `search/path-imports.ts` is the product's answer for exactly those instances; this module is that answer
// scored with the corpus's own ruler, on every instance the run reaches - **including the ones the analysis refused**,
// which is the only way a figure over a hundred and fifty instances can exist at all.
//
// **The ruler is the product's own.** `averagePrecision` and `firstRelevantRank` are the functions the retrieval arm's
// MAP column and the controls' columns are computed with; the depth is the product's pool depth; the answer space is the
// corpus's. A fallback scored with a different ruler would be a second measurement rather than a second reading of the
// same one.

import { averagePrecision, firstRelevantRank } from './lca-instrument.js';
import { pathImportsRanking } from '../search/path-imports.js';

/** What the fallback produced on one instance. **Published on refused rows as well as measured ones.** */
export interface FallbackResult {
  /** Average precision against the fixing commit, at the same depth every other column reads. */
  readonly map: number;
  /** Where the first fixing file sits in the fallback's ranking, or `null` when it is not there. */
  readonly rank: number | null;
  /** How many files the fallback ranked. **The universe, stated, because a fallback that ranked a prefix would lie.** */
  readonly documents: number;
  /** Files whose head could not be read. */
  readonly unreadableFiles: number;
  /** Import statements found across the answer space. **Zero means the extraction missed the language, not that files have no imports.** */
  readonly importLines: number;
  /** The first ten of the ranking, so a reader can see why the number is what it is. */
  readonly ranked: readonly string[];
}

/** Score one checkout's path-and-imports ranking against the fixing commit. */
export function fallbackArm(input: {
  readonly checkout: string;
  readonly files: readonly string[];
  readonly query: string;
  readonly expected: readonly string[];
  readonly depth: number;
}): FallbackResult {
  const result = pathImportsRanking({
    checkout: input.checkout,
    files: input.files,
    query: input.query,
    limit: input.depth,
  });
  return {
    map: averagePrecision([...result.ranked], input.expected, input.depth),
    rank: firstRelevantRank([...result.ranked], input.expected),
    documents: result.documents,
    unreadableFiles: result.unreadableFiles,
    importLines: result.importLines,
    ranked: result.ranked.slice(0, 10),
  };
}
