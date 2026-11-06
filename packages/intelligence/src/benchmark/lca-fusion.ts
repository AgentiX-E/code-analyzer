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

/**
 * The constants the sweep reads, **stated rather than searched**.
 *
 * `k = 60` is the value the fusion ships with, taken from the literature rather than fitted here. Bruch, Gai and Ingber
 * (Pinecone, 2022) report that reciprocal rank fusion is **more sensitive to `k` than the folklore assumes**, so the
 * constant is a parameter whose shape has to be measured even though the shipped value may not move: a ladder over two
 * orders of magnitude says whether 60 sits on a plateau or on a knife edge, and it says it on every row of the same run
 * rather than in a second experiment.
 *
 * **A ladder and not a search**, because a value chosen by the best row of this corpus is a value fitted to this
 * corpus. The ladder is a fixed list, published in the artifact before any figure is read.
 */
export const FUSION_K_LADDER = [10, 30, 60, 120, 300] as const;

/** One constant's figure on one instance. **What the sweep is made of.** */
export interface FusionAtK {
  /** The rank constant this figure was computed with. */
  readonly k: number;
  /** Average precision of the same two arms fused at this constant. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when no answer is in the list. */
  readonly rank: number | null;
}

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

/**
 * The fused column for one finished row, **decided by the row rather than by the process that produced it**.
 *
 * **This function exists because the branch that called it was wrong, and the gate said so.** The parent used to choose
 * between the two constructors above on `outcome.kind === 'row'` - did the child write a row - which is a fact about
 * the process and not about the instance. A child whose analysis threw writes a **refused** row, so a refusal arrived
 * through the branch that means "both arms ran": one row of a real run published `fused: true` beside
 * `skipped: "the analysis failed: ..."`, `coverage.fused` came to 110 against 109 measured, and the gate refused the
 * artifact twice - once for the split not adding up and once for a flag contradicting its own refusal sentence.
 *
 * **One call site per row, one decision, taken from the row's own refusal.** A row that measured nothing has no
 * declaration arm to fuse with, whatever produced the silence, so it declines to the file-level arm - and a row whose
 * fallback is missing entirely publishes no fused figure rather than a zero standing in for one.
 */
export function fusionFor(input: {
  /** The row's refusal sentence, or `null` when it was measured. **The only thing that decides which arm ran.** */
  readonly skipped: string | null;
  /** The row's own figure, which is the fused one when the row is measured. */
  readonly map: number;
  readonly rank: number | null;
  readonly ranked: readonly string[];
  /** The file-level arm on this instance, which the parent computed before the child started. */
  readonly fallback: {
    readonly map: number;
    readonly rank: number | null;
    readonly ranked: readonly string[];
  } | null;
  readonly k?: number;
}): FusionResult | null {
  if (input.skipped === null) {
    return fusedResult({
      map: input.map,
      rank: input.rank,
      ranked: input.ranked,
      ...(input.k === undefined ? {} : { k: input.k }),
    });
  }
  if (input.fallback === null) return null;
  return declinedFusion({
    map: input.fallback.map,
    rank: input.fallback.rank,
    ranked: input.fallback.ranked,
    ...(input.k === undefined ? {} : { k: input.k }),
  });
}
