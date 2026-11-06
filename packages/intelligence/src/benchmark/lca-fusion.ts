// @code-analyzer/intelligence — the fused ranking, as a measurement arm
//
// **The iteration before this one measured two instruments and found that each wins where the other loses.** On Long
// Code Arena's 200-500-file band the analyser's declaration pool scores **0.2925** and a ranking built from a file's
// path and its imports scores **0.4130**; on the 0-50-file band the pool scores **0.6465** and the file-level reading
// **0.5010**. A product that published either one alone would be publishing a figure about a quarter of the corpus it
// was wrong about.
//
// **So the product fuses them, and this module is the column.** `search/fusion.ts` is the arithmetic - unweighted
// reciprocal rank, `k = 60` - and it runs inside the child process as part of `askCodebase`; this module is how the row
// records what came out, and how a refused instance still gets a figure.
//
// **The asymmetry is the honest part.** A measured instance ran both arms, so its row says `fused: true` and its
// ranking is the fusion. A refused instance ran only the file-level arm, because the declaration arm is the analysis
// that was refused - so its row says `fused: false`, names the one arm, and carries that arm's figure. **A column whose
// disclaimer is a boolean per row can be quoted; a column that averaged the two kinds together under one name could
// not.** The artifact publishes the split counts beside the mean.

import { RRF_K } from '../search/fusion.js';

/** The two arms, in the order the fusion reads them. **Published, because a contribution without a source is a number.** */
export const FUSION_ARMS = ['declarations', 'file-level'] as const;

/** One instance's fused ranking: what it scored, how deep, and whether both arms took part. */
export interface FusionResult {
  /** Average precision of the fused ranking, at the depth every other column reads. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when no answer is in the list. */
  readonly rank: number | null;
  /** **Whether the declaration arm took part.** `false` means this row was refused and the ranking is the file-level arm. */
  readonly fused: boolean;
  /** The arms that produced this ranking. **One of them when `fused` is false.** */
  readonly arms: readonly string[];
  /** The rank constant the fusion used. **A figure whose constant is not published cannot be reproduced.** */
  readonly k: number;
  /** The first ten paths, so a reader can see why the number is what it is. */
  readonly ranked: readonly string[];
}

/** A row that ran both arms. `map` and `answerRank` are the ones the row already publishes. */
export function fusedResult(input: {
  readonly map: number;
  readonly rank: number | null;
  readonly ranked: readonly string[];
  readonly k?: number;
}): FusionResult {
  return {
    map: input.map,
    rank: input.rank,
    fused: true,
    arms: [...FUSION_ARMS],
    k: input.k ?? RRF_K,
    ranked: input.ranked.slice(0, 10),
  };
}

/**
 * A row that ran one arm, **which is the row the analysis was refused on**.
 *
 * The figure is the file-level arm's own, restated rather than recomputed: a second computation would be a second
 * ruler, and the artifact's job is to say which arm produced which number rather than to produce a third one.
 */
export function declinedFusion(input: {
  readonly map: number;
  readonly rank: number | null;
  readonly ranked: readonly string[];
  readonly k?: number;
}): FusionResult {
  return {
    map: input.map,
    rank: input.rank,
    fused: false,
    arms: ['file-level'],
    k: input.k ?? RRF_K,
    ranked: input.ranked.slice(0, 10),
  };
}
