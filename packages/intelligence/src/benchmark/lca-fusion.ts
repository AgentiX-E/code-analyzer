// @code-analyzer/intelligence — the fused ranking, as a measurement arm
//
// **The iteration before this one measured two instruments and found that each wins where the other loses.** On Long
// Code Arena's 200-500-file band the analyser's declaration pool scores **0.2925** and a ranking built from a file's
// path and its imports scores **0.4130**; on the 0-50-file band the pool scores **0.6465** and the file-level reading
// **0.5010**. A product that published either one alone would be publishing a figure about a quarter of the corpus it
// was wrong about.
//
// **So the product fuses them, and this module is the column.** `search/fusion.ts` is the arithmetic - reciprocal rank,
// `k = RRF_K` - and it runs inside the child process as part of `askCodebase`; this module is how the row records what
// came out, and how a refused instance still gets a figure.
//
// **And the third arm, without which the column was a loss over the protocol.** The path-and-imports arm never reads a
// file's body, so on the 35 instances the analyser refused it scored **0.1441** against the lexical control's
// **0.3116** - and those 35 rows are 23 % of the protocol, which is why the fused figure over the protocol was
// **0.3919** against the control's **0.4242** while the same product was level with the control on the rows it could
// run. `search/file-body.ts` is the arm that reads the words, it runs where the analyser cannot, and it is a rung of
// the ladder below in the strongest possible sense: `body-alone` reproduces its column exactly.
//
// **The asymmetry is the honest part, and it survives the third arm.** A measured instance ran all three arms, so its
// row says `fused: true` and its ranking is the fusion. A refused instance ran the two file-level arms - the
// declaration arm *is* the analysis that was refused - so its row says `fused: false`, names the arms that did run, and
// carries their fusion's figure. **A column whose disclaimer is a boolean per row can be quoted; a column that averaged
// the two kinds together under one name could not.** The artifact publishes the split counts beside the mean.

import { averagePrecision, firstRelevantRank } from './lca-instrument.js';
import { RRF_K, reciprocalRankFusion } from '../search/fusion.js';

/** The declaration arm: the analyser's pool, collapsed to files. **Absent on a refused row, by definition.** */
export const FUSION_ARM_DECLARATIONS = 'declarations';

/** The path-and-imports arm: `search/path-imports.ts`, which reads eight kilobytes of a head and no body. */
export const FUSION_ARM_FILE_LEVEL = 'file-level';

/** The whole-body arm: `search/file-body.ts`, which reads sixty-four kilobytes and counts words. */
export const FUSION_ARM_FILE_BODY = 'file-body';

/** The three arms, in the order the fusion reads them. **Published, because a contribution without a source is a number.** */
export const FUSION_ARMS = [
  FUSION_ARM_DECLARATIONS,
  FUSION_ARM_FILE_LEVEL,
  FUSION_ARM_FILE_BODY,
] as const;

/**
 * The constants the sweep reads, **stated rather than searched, and bracketing the one that ships**.
 *
 * `k = 60` was the value the fusion shipped with, taken from the literature rather than fitted: Bruch, Gai and Ingber
 * (Pinecone, 2022) report that reciprocal rank fusion is **more sensitive to `k` than the folklore assumes**, so the
 * constant is a parameter whose shape has to be measured even though the shipped value may not move.
 *
 * **The first measurement of the ladder moved it.** Over the 109 measured rows of the 6 November 2026 run the five rungs
 * scored `k10 0.4734 · k30 0.4599 · k60 0.4598 · k120 0.4494 · k300 0.4482`, and leaving one language out at a time
 * selected `k = 10` in all three folds, with held-out gains of `+0.0316` (Python), `+0.0025` (Java) and `+0.0028`
 * (Kotlin). So the shipped constant is **10**, and the ladder now brackets it - two rungs below, two above - because a
 * sweep whose shipped value sits on its edge can say that a smaller constant is no worse and cannot say how much worse a
 * larger one is.
 *
 * **A ladder and not a search**, because a value chosen by the best row of this corpus is a value fitted to this corpus.
 * The ladder is a fixed list, published in the artifact before any figure is read; the constant that moved was moved by
 * a split the figure was not read on, and the fold that decided it is in the artifact beside it.
 */
export const FUSION_K_LADDER = [3, 5, 10, 30, 60] as const;

/** One weighting's figure on one instance. **What the weight ladder is made of.** */
export interface FusionAtWeighting {
  /** The rung's name. **Published, because a mean whose rung is unnamed cannot be compared with the next run's.** */
  readonly weighting: string;
  /** Average precision of the same arms fused at this weighting. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when no answer is in the list. */
  readonly rank: number | null;
}

/** One constant's figure on one instance. **What the sweep is made of.** */
export interface FusionAtK {
  /** The rank constant this figure was computed with. */
  readonly k: number;
  /** Average precision of the same arms fused at this constant. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when no answer is in the list. */
  readonly rank: number | null;
}

/**
 * How much each arm counts. **A named configuration, so the ladder is a list of decisions rather than of numbers.**
 *
 * `equal` is what the fusion shipped for four iterations and it is the rung the shipped column reads until a fold
 * selects another. **A weight is not a free parameter and that is why the ladder is short and stated in advance**: the
 * corpus that would select it is the corpus the figure is read on, so the selection is done out of fold and published
 * with the fold that made it, exactly as the rank constant was.
 */
export interface FusionWeighting {
  /** The rung's name, **published beside every figure computed with it**. */
  readonly name: string;
  /** Multiplier on the declaration arm. **Zero removes the arm** rather than contributing nothing - see `FusionOptions`. */
  readonly declarations: number;
  /** Multiplier on the path-and-imports arm. */
  readonly fileLevel: number;
  /** Multiplier on the whole-body arm. */
  readonly fileBody: number;
}

/**
 * The ladder, **and its last rung is not a candidate for shipping but a control for the column**.
 *
 * `body-alone` zeroes the other two arms, so the fused figure it produces must equal the body arm's own column to the
 * last digit on every row. That equality is the mechanism test for the whole block: if the ladder's own rung disagrees
 * with the arm it names, the weights are not reaching the arithmetic, and a reader would be comparing a column against
 * a number that had nothing to do with it. The gate refuses an artifact where they disagree.
 *
 * **`body-doubled` and `declarations-doubled` bracket the shipped rung in both directions**, because a sweep that only
 * looks up cannot say how much it would lose by looking down.
 */
export const FUSION_WEIGHT_LADDER: readonly FusionWeighting[] = [
  { name: 'equal', declarations: 1, fileLevel: 1, fileBody: 1 },
  { name: 'body-doubled', declarations: 1, fileLevel: 1, fileBody: 2 },
  { name: 'declarations-doubled', declarations: 2, fileLevel: 1, fileBody: 1 },
  { name: 'body-alone', declarations: 0, fileLevel: 0, fileBody: 1 },
];

/**
 * The weighting the product ships. **`equal`, until a fold says otherwise, and the reason it starts there is evidence.**
 *
 * The three arms score 0.4584, 0.3781 and 0.4152 on the same 115 rows - within 0.08 of one another, so a weighting
 * proportional to those figures would be 1.2 : 1.0 : 1.1, which is not a decision a measurement that noisy can support.
 * **An unweighted fusion of comparably good arms is the configuration with nothing fitted into it**, and the ladder
 * beside it is what a later run reads to find out whether that is still true.
 */
export const FUSION_WEIGHTING: FusionWeighting = FUSION_WEIGHT_LADDER[0]!;

/** The weights in the shape `reciprocalRankFusion` reads. **One translation, so a name cannot drift from a number.** */
export function armWeights(weighting: FusionWeighting): Record<string, number> {
  return {
    [FUSION_ARM_DECLARATIONS]: weighting.declarations,
    [FUSION_ARM_FILE_LEVEL]: weighting.fileLevel,
    [FUSION_ARM_FILE_BODY]: weighting.fileBody,
  };
}

/** The arms one instance actually produced. **A missing arm is absent rather than empty**, which the report distinguishes. */
export interface FusionArms {
  readonly declarations?: readonly string[];
  readonly fileLevel?: readonly string[];
  readonly fileBody?: readonly string[];
}

/**
 * Fuse whichever arms an instance has, at one weighting and one constant.
 *
 * **A missing arm is skipped rather than fused as an empty list.** An empty list contributes nothing and admits nothing,
 * so the two are arithmetically the same and structurally different: a row must be able to say that the declaration arm
 * did not run, and a caller reading `arms` should not have to guess whether `[]` meant "nothing matched" or "no parser".
 */
export function fuseFileRankings(input: {
  readonly arms: FusionArms;
  readonly weighting?: FusionWeighting;
  readonly k?: number;
  readonly limit?: number;
}): readonly string[] {
  const weighting = input.weighting ?? FUSION_WEIGHTING;
  const ranked: { name: string; ranked: readonly string[] }[] = [];
  if (input.arms.declarations !== undefined) {
    ranked.push({ name: FUSION_ARM_DECLARATIONS, ranked: input.arms.declarations });
  }
  if (input.arms.fileLevel !== undefined) {
    ranked.push({ name: FUSION_ARM_FILE_LEVEL, ranked: input.arms.fileLevel });
  }
  if (input.arms.fileBody !== undefined) {
    ranked.push({ name: FUSION_ARM_FILE_BODY, ranked: input.arms.fileBody });
  }
  return reciprocalRankFusion(ranked, {
    weights: armWeights(weighting),
    k: input.k ?? RRF_K,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }).ranked;
}

/** One instance's fused ranking: what it scored, how deep, and whether both arms took part. */
export interface FusionResult {
  /** Average precision of the fused ranking, at the depth every other column reads. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when no answer is in the list. */
  readonly rank: number | null;
  /** **Whether the declaration arm took part.** `false` means this row was refused and the ranking is file-level only. */
  readonly fused: boolean;
  /** The arms that produced this ranking. **The ones that ran, in the fusion's own order.** */
  readonly arms: readonly string[];
  /** The rank constant the fusion used. **A figure whose constant is not published cannot be reproduced.** */
  readonly k: number;
  /** The weighting it used. **A figure whose weights are not published cannot be reproduced either.** */
  readonly weighting: string;
  /** The first ten paths, so a reader can see why the number is what it is. */
  readonly ranked: readonly string[];
}

/**
 * The fused column for one finished row, **and on a refused row it is now a fusion rather than a single arm's figure**.
 *
 * **This function exists because the branch that called it was wrong, and the gate said so.** The parent used to choose
 * between "both arms ran" and "one did" on `outcome.kind === 'row'` - did the child write a row - which is a fact about
 * the process and not about the instance. A child whose analysis threw writes a **refused** row, so a refusal arrived
 * through the branch that means "both arms ran": one row of a real run published `fused: true` beside
 * `skipped: "the analysis failed: ..."`, `coverage.fused` came to 110 against 109 measured, and the gate refused the
 * artifact twice - once for the split not adding up and once for a flag contradicting its own refusal sentence.
 *
 * **One call site per row, one decision, taken from the row's own refusal.** A row that measured nothing has no
 * declaration arm to fuse, whatever produced the silence - and since iteration 81 it does have two file-level arms, so
 * it declines to **their fusion** rather than to one of them. A row with neither publishes no fused figure rather than
 * a zero standing in for one.
 *
 * **The score is computed here rather than transcribed on the refused branch**, because there is now more than one arm
 * to combine and a transcription would have to pick one. On a measured row it is still a transcription: the child ran
 * the product's own fusion and a second computation here would be a second ruler.
 */
export function fusionFor(input: {
  /** The row's refusal sentence, or `null` when it was measured. **The only thing that decides which arms ran.** */
  readonly skipped: string | null;
  /** The row's own figure, which is the fused one when the row is measured. */
  readonly map: number;
  readonly rank: number | null;
  readonly ranked: readonly string[];
  /** The path-and-imports arm on this instance, which the parent computed before the child started. */
  readonly fallback: {
    readonly map: number;
    readonly rank: number | null;
    readonly candidates: readonly string[];
  } | null;
  /** The whole-body arm on the same instance, computed at the same time and for the same reason. */
  readonly body?: {
    readonly map: number;
    readonly rank: number | null;
    readonly candidates: readonly string[];
  } | null;
  /** The fixing commit's files. **Needed only on a refused row, where the ranking is computed rather than transcribed.** */
  readonly expected: readonly string[];
  /** The depth the fused figure reads, which is the depth every column reads. */
  readonly depth: number;
  readonly k?: number;
  readonly weighting?: FusionWeighting;
}): FusionResult | null {
  const k = input.k ?? RRF_K;
  const weighting = input.weighting ?? FUSION_WEIGHTING;
  if (input.skipped === null) {
    return {
      map: input.map,
      rank: input.rank,
      fused: true,
      arms: [...FUSION_ARMS],
      k,
      weighting: weighting.name,
      ranked: input.ranked.slice(0, 10),
    };
  }
  const arms: FusionArms = {
    ...(input.fallback === null ? {} : { fileLevel: input.fallback.candidates }),
    ...(input.body === undefined || input.body === null ? {} : { fileBody: input.body.candidates }),
  };
  if (arms.fileLevel === undefined && arms.fileBody === undefined) return null;
  const fused = fuseFileRankings({ arms, weighting, k });
  return {
    map: averagePrecision(fused, input.expected, input.depth),
    rank: firstRelevantRank(fused, input.expected),
    fused: false,
    arms: [
      ...(arms.fileLevel === undefined ? [] : [FUSION_ARM_FILE_LEVEL]),
      ...(arms.fileBody === undefined ? [] : [FUSION_ARM_FILE_BODY]),
    ],
    k,
    weighting: weighting.name,
    ranked: fused.slice(0, 10),
  };
}
