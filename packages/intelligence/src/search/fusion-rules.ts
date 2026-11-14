// **Four ways to fuse two ranked lists, and the reason the fifth one is the product's current answer.**
//
// §39 measured the product's rule and retired two candidates for it, and the retirement left a number that is harder to
// argue with than either: on 454 rewritten questions the shipped rule scores **0.6498** while the lexical list it
// re-weights scores **0.7930**. **The fusion is worse than not fusing.** The rule was not the only thing wrong - the
// mechanism it feeds was never measured against the alternatives a retrieval system has had for thirty years:
//
// - `rrf` with a weight (what the engine does): reciprocal ranks, one global weight per question;
// - `combmnz`: normalised score summation times the number of channels that returned the document (Lee, 1997;
//   Shaw & Fox, 1994) - **parameter-free**, and it rewards *agreement* rather than imposing a weight;
// - `supported`: reciprocal ranks where the semantic channel may only contribute for documents it stands behind -
//   above its own list's mean - and contributes nothing for the rest. This is the one that targets the measured loss
//   directly: at weight 4 the vector channel cost **139 questions** on a corpus where it finds fewer answers than the
//   lexical channel, and every one of them is a document the vector channel was *sure* about and wrong about;
// - `qpp`: reciprocal ranks at a weight derived from **query performance prediction** - how far each channel's head
//   stands above that channel's own bulk - which is the family the information-retrieval literature uses to answer
//   "whose ranking should I trust" (Cronen-Townsend & Croft, 2002; Shtok et al., 2012).
//
// **Nothing here is adopted.** These are candidates with a figure or without one, and `EVAL-CONTRACT.md` §40 registers
// the criteria they have to clear before any of them replaces `fuseResults` - the same discipline that retired §39's two
// candidates on a single question.

import { FUSION_WEIGHT_BOUNDS } from './fusion-weight.js';
import { compareNodeIdentity } from './ranking.js';

import type { HybridSearchResult, RankedResult } from './hybrid-search.js';

/**
 * **The candidates, by name, in the order the artifact publishes them.**
 *
 * Exported as a tuple rather than a union so a harness can iterate the set and a new candidate cannot be measured by
 * one corpus and forgotten by the other: **a rule with a figure on one corpus and no figure on the second is a rule
 * nobody has falsified.**
 */
export const FUSION_RULE_NAMES = ['rrf', 'combmnz', 'supported', 'qpp', 'qpp3'] as const;
export type FusionRuleName = (typeof FUSION_RULE_NAMES)[number];

/** The reciprocal-rank constant the engine ships, used by every rule that reads a rank. */
export const DEFAULT_RRF_K = 60;

/**
 * **How many answers make a channel's head, and why there are two answers to that.**
 *
 * One and three, both measured, because the choice is a claim about which statistic predicts and **this file is not
 * entitled to that claim before a run**. A single answer's margin is the head standing clear of the list; a three-answer
 * head is the head standing clear of the list *as a group*, which is steadier and is the depth `selfEvidence` was read at
 * when §39 falsified it. `qpp` reads the first, `qpp3` the second, and the artifact publishes both columns so the choice
 * can be made from numbers rather than from an argument about which is more stable.
 */
export const HEAD_DEPTH = 1;
export const HEAD_DEPTH_WIDE = 3;

export interface FusionRuleOptions {
  /** The reciprocal-rank constant. Read by `rrf`, `supported` and `qpp`; ignored by `combmnz`. */
  k?: number;
  /** The semantic channel's weight. Read by `rrf` and `supported`; ignored by `combmnz` and `qpp`. */
  vectorWeight?: number;
  limit?: number;
}

/**
 * **Each channel's own scores, in that channel's own units, as a z-score.**
 *
 * The two channels do not share a scale: a BM25 score is an unbounded sum of term weights and a cosine is bounded by
 * one, so **a sum of the two raw numbers is a weighted sum whose weights nobody chose.** A z-score makes the two
 * comparable without a parameter, which is the whole point of this file.
 *
 * **A degenerate list gets a z-score of one for every member rather than zero.** A list of one, or of uniform scores,
 * has no spread to normalise by - and calling every member "average" would make `combmnz` unable to tell a document two
 * channels returned from a document one channel returned. **Presence is the information such a list does carry**, so
 * the statistic falls back to it instead of discarding it.
 */
export function zScores(list: readonly RankedResult[]): Map<number, number> {
  if (list.length < 2) {
    return new Map(list.map((hit) => [hit.node.id, 1]));
  }

  let sum = 0;
  for (const hit of list) sum += hit.score;
  const mean = sum / list.length;

  let variance = 0;
  for (const hit of list) variance += (hit.score - mean) ** 2;
  const deviation = Math.sqrt(variance / list.length);

  if (deviation === 0) {
    return new Map(list.map((hit) => [hit.node.id, 1]));
  }

  return new Map(list.map((hit) => [hit.node.id, (hit.score - mean) / deviation]));
}

/**
 * **How far a channel's head stands above that channel's own bulk, in its own units.**
 *
 * `(mean of the head - mean of the list) / standard deviation of the list`, read at {@link HEAD_DEPTH} by default.
 * Three properties, each of them the reason for one of the terms:
 *
 * - **it is scale-free**, so a BM25 list and a cosine list can be compared - the same reason {@link zScores} exists;
 * - **it is a term of a query-performance predictor and not an invention**: the head standing clear of the bulk is what
 *   `NQC` (Shtok et al., 2012) measures with the standard deviation of the top scores, and what a clarity score
 *   (Cronen-Townsend & Croft, 2002) measures with a divergence from the collection;
 * - **it never needs the collection**, which matters here because the collection model is the one thing this engine
 *   does not have in the shape the literature assumes.
 *
 * It is **non-negative by construction**: the mean of a prefix cannot be below the mean of the list it is a prefix of.
 */
export function headSeparation(list: readonly RankedResult[], depth: number = HEAD_DEPTH): number {
  if (list.length < 2) return 0;

  let sum = 0;
  for (const hit of list) sum += hit.score;
  const mean = sum / list.length;

  let variance = 0;
  for (const hit of list) variance += (hit.score - mean) ** 2;
  const deviation = Math.sqrt(variance / list.length);
  if (deviation === 0) return 0;

  const head = list.slice(0, Math.min(depth, list.length));
  let headSum = 0;
  for (const hit of head) headSum += hit.score;
  return (headSum / head.length - mean) / deviation;
}

/**
 * **The weight that makes each channel's vote proportional to how clearly its own head stands out.**
 *
 * `(1 + separation of the vector head) / (1 + separation of the lexical head)`, clamped to the measured bounds.
 *
 * **The one is not smoothing, it is the unit**: a channel whose head sits exactly at its bulk scores zero, and two such
 * channels are two channels with nothing to choose between - which must read as one, not as zero over zero. Adding one
 * to both sides makes the tie the fixed point of the ratio, and it is the only parameter-shaped thing in this file that
 * is not a measured value. It is stated here, in the code, because a reader who finds it in an artifact cannot see it.
 */
export function qppVectorWeight(
  lexical: readonly RankedResult[],
  vector: readonly RankedResult[],
  depth: number = HEAD_DEPTH,
): number {
  if (lexical.length === 0 || vector.length === 0) return 1;
  const ratio = (1 + headSeparation(vector, depth)) / (1 + headSeparation(lexical, depth));
  return Math.min(FUSION_WEIGHT_BOUNDS.max, Math.max(FUSION_WEIGHT_BOUNDS.min, ratio));
}

/** One channel's ranks, 1-based, with the first occurrence winning a duplicate. */
function ranksOf(list: readonly RankedResult[]): Map<number, number> {
  const ranks = new Map<number, number>();
  for (let index = 0; index < list.length; index++) {
    const id = list[index]!.node.id;
    if (!ranks.has(id)) ranks.set(id, index + 1);
  }
  return ranks;
}

/**
 * **The list a rule produces, with the same shape and the same tie-break the engine's fusion returns.**
 *
 * The tie-break is copied rather than reinvented: **a rule measured under a different ordering convention would be a
 * rule measured against a different engine**, and §29 already paid for a tie broken by insertion order once.
 */
export function fuseByRule(
  rule: FusionRuleName,
  lexical: readonly RankedResult[],
  vector: readonly RankedResult[],
  options: FusionRuleOptions = {},
): HybridSearchResult[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const nodes = new Map<number, HybridSearchResult>();
  const lexRanks = ranksOf(lexical);
  const vecRanks = ranksOf(vector);

  const entry = (id: number, node: HybridSearchResult['node']): HybridSearchResult => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const created: HybridSearchResult = { node, bm25Score: 0, vectorScore: 0, combinedScore: 0 };
    nodes.set(id, created);
    return created;
  };

  for (const hit of lexical) entry(hit.node.id, hit.node).bm25Score = hit.score;
  for (const hit of vector) entry(hit.node.id, hit.node).vectorScore = hit.score;

  const add = (id: number, value: number): void => {
    const target = nodes.get(id);
    if (target) target.combinedScore += value;
  };

  switch (rule) {
    case 'rrf': {
      const weight = options.vectorWeight ?? 1;
      for (const [id, rank] of lexRanks) add(id, 1 / (k + rank));
      for (const [id, rank] of vecRanks) add(id, weight / (k + rank));
      break;
    }

    case 'combmnz': {
      // **Agreement is the only thing rewarded, and nothing is weighted.** The z-scores put the two channels in one
      // unit, the count multiplies a document that both channels returned - the `MNZ` of CombMNZ - and **no per-question
      // weight is chosen, which is the property that makes this candidate falsifiable in a way the tuned constant is
      // not**: it has no number to tune.
      const zLex = zScores(lexical);
      const zVec = zScores(vector);
      for (const [id] of nodes) {
        const fromLexical = zLex.get(id) ?? 0;
        const fromVector = zVec.get(id) ?? 0;
        const channels = (lexRanks.has(id) ? 1 : 0) + (vecRanks.has(id) ? 1 : 0);
        add(id, (fromLexical + fromVector) * channels);
      }
      break;
    }

    case 'supported': {
      // **The semantic channel may add documents it stands behind, and may not reorder the ones it does not.** A
      // document at or above the vector list's own mean is a document that list is above average about; everything
      // below it contributes only its lexical rank. §39's measured loss came from the opposite: at weight four the
      // vector channel reordered 139 questions wrong on a corpus where it finds fewer answers than the lexical one.
      const weight = options.vectorWeight ?? 1;
      const zVec = zScores(vector);
      for (const [id, rank] of lexRanks) add(id, 1 / (k + rank));
      for (const [id, rank] of vecRanks) {
        if ((zVec.get(id) ?? 0) >= 0) add(id, weight / (k + rank));
      }
      break;
    }

    case 'qpp':
    case 'qpp3': {
      const depth = rule === 'qpp3' ? HEAD_DEPTH_WIDE : HEAD_DEPTH;
      const weight = options.vectorWeight ?? qppVectorWeight(lexical, vector, depth);
      for (const [id, rank] of lexRanks) add(id, 1 / (k + rank));
      for (const [id, rank] of vecRanks) add(id, weight / (k + rank));
      break;
    }
  }

  const sorted = Array.from(nodes.values()).sort((left, right) => {
    const byFused = right.combinedScore - left.combinedScore;
    if (byFused !== 0) return byFused;
    const byLexical = right.bm25Score - left.bm25Score;
    if (byLexical !== 0) return byLexical;
    const byVector = right.vectorScore - left.vectorScore;
    return byVector !== 0 ? byVector : compareNodeIdentity(left.node, right.node);
  });

  return options.limit !== undefined && options.limit > 0 ? sorted.slice(0, options.limit) : sorted;
}
