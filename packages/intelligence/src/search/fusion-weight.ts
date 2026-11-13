// **How much a semantic rank counts against a lexical one, decided by the question rather than by a constant.**
//
// Two sweeps in this repository measured the same constant and pointed in opposite directions. A symbol looked up from
// its own doc comment wants the lexical list to dominate: MRR@20 0.9119 at weight 1, 0.9636 at 0.1. A paraphrase wants
// the semantic one to: `found@10` 322 at weight 1, 347 at 4, and 25 questions between them. **One constant can only be
// wrong for one of the two**, and the constant was therefore the defect - not its value.
//
// The observation that separates them is not the *shape* of the question. Both sets are prose. It is whether the
// **lexical channel's best answer carries the question's own words**: a doc comment that is the query scores one
// because the document *is* the question; a paraphrase scores a quarter because the index has to be talked into it. That
// is `selfEvidence`, it is computed from the answer the channel already returned, and on the two corpora it separates
// them with 98.6 % accuracy at a single cut - measured locally, no model, no key.
//
// **The weights at the two ends are the sweeps' own optima, not new numbers**: 0.1 is where the doc-comment corpus peaks
// and 4 is the highest weight the CoSQA sweep scored, still rising. The middle stays 1 - the value the engine shipped -
// because a question the evidence cannot classify is not a question to move a default for.

import { tokenize } from './text-tokens.js';

import type { RankedResult } from './hybrid-search.js';
import type { GraphNode } from '@code-analyzer/shared';

/**
 * **The two cuts, and the single measurement behind them.**
 *
 * Over 500 CoSQA questions (median 0.250, 90th percentile 0.500) and 219 doc-comment queries (median 1.000, 10th
 * percentile 0.085), the best single threshold separates the two sets at **0.839 with 98.6 % accuracy**. The cut used
 * here is **0.8** - below the optimum on purpose, so that a question is only called answerable-in-its-own-words when it
 * nearly is - and **0.5**, which is the CoSQA 90th percentile and therefore the point above which a paraphrase stops
 * being typical.
 *
 * **A cut is a claim about a distribution, so the distributions are in `EVAL-CONTRACT.md` §30.** The classifier is not
 * recomputed per run: the two numbers it returns are read from the sweeps, and a future corpus that separates at 0.6
 * would have to move the cut rather than the arithmetic.
 */
export const SELF_EVIDENCE_CONFIDENT = 0.8;
export const SELF_EVIDENCE_GUESSING = 0.5;

/**
 * **The range the weight may take, and both ends were measured rather than chosen.**
 *
 * `docstring-search.test.ts` sweeps `[1, 0.5, 0.25, 0.1]` and `cosqa-retrieval.test.ts` sweeps
 * `COSQA_VECTOR_WEIGHTS`; the lowest and highest values each sweep scored are the bounds, so a weight this function
 * returns is always a weight some run has a figure for. **A bound nobody measured would be a second guess wearing the
 * first one's clothes.**
 */
export const FUSION_WEIGHT_BOUNDS = { min: 0.1, max: 4 } as const;

/** The weight the engine ran before this file existed, and still runs when the evidence cannot classify the question. */
const NEUTRAL_VECTOR_WEIGHT = 1;

/**
 * **The share of a question's distinct terms that one answer carries in its own indexed fields.**
 *
 * Name, qualified name, signature and doc comment - the four fields a document is *described* by, and deliberately not
 * `vocabulary`: a body that happens to contain the words is not a document that answers the question in its own words,
 * which is the distinction the CoSQA sweep found worth half a point of R@10 when the body field's weight moved.
 *
 * Distinct terms rather than occurrences, because the question is "does this answer know these words", and a question
 * that repeats a word it cannot find is not more findable for the repetition.
 */
export function selfEvidence(query: string, answer: GraphNode | undefined): number {
  if (!answer) return 0;

  const asked = new Set(tokenize(query));
  if (asked.size === 0) return 0;

  const carried = new Set(
    tokenize(
      [answer.name, answer.qualifiedName, answer.docstring ?? '', answer.signature ?? ''].join(' '),
    ),
  );

  let hits = 0;
  for (const term of asked) if (carried.has(term)) hits += 1;
  return hits / asked.size;
}

/**
 * **The fusion weight the two lists and the question imply.**
 *
 * Three outcomes, each with a reason a reader can check:
 *
 * - **the lexical list is answered in its own words** (`selfEvidence` at or above {@link SELF_EVIDENCE_CONFIDENT}) -
 *   a semantic rank counts a tenth of a lexical one, which is the weight the doc-comment corpus peaks at;
 * - **the lexical list cannot spell the question** (at or below {@link SELF_EVIDENCE_GUESSING}) - a semantic rank counts
 *   four, which is the best of the CoSQA sweep and the top of its grid;
 * - **anything else** - one, the value the engine shipped, because between the two the measurement says nothing.
 *
 * **An empty list on either side returns the neutral weight**, and that is a claim rather than a fallback: with one list
 * the weight is a constant multiplying every candidate, so it cannot change the order. Returning a bound there would be
 * reporting a comparison that did not happen - and the bound would then be quoted as if it had been measured against
 * something.
 */
export function deriveVectorWeight(
  lexical: readonly RankedResult[],
  vector: readonly RankedResult[],
  query: string,
): number {
  if (lexical.length === 0 || vector.length === 0) return NEUTRAL_VECTOR_WEIGHT;

  const evidence = selfEvidence(query, lexical[0]!.node);
  if (evidence >= SELF_EVIDENCE_CONFIDENT) return FUSION_WEIGHT_BOUNDS.min;
  if (evidence <= SELF_EVIDENCE_GUESSING) return FUSION_WEIGHT_BOUNDS.max;
  return NEUTRAL_VECTOR_WEIGHT;
}

/**
 * **How many of a channel's answers are asked before its vote is decided.**
 *
 * Five, because a top-one read of a channel is a read of its luckiest slot: a list whose first answer carries nothing
 * and whose next four carry the question is a list that found the answer, and `selfEvidence` on `list[0]` would report
 * it as a list that found nothing. Five is also the cut the CoSQA recall columns are published at (`recallAt5`), so the
 * statistic is read at a depth the corpus already reports.
 */
export const EVIDENCE_DEPTH = 5;

/**
 * **One term in twenty, which is what stops an empty list from dividing by zero and a thin list from shouting.**
 *
 * The ratio is `(vector + λ) / (lexical + λ)`. With `λ` at zero, a lexical list that carries nothing - the paraphrase
 * case this rule exists for - would send the ratio to infinity on a single stray term. At **0.05 the smoothing is worth
 * exactly one carried term in twenty**, so it moves a two-term answer by a tenth and a twenty-term answer by a
 * four-hundredth: **the same absolute slack everywhere, which is the property a smoothing constant should have.**
 */
export const EVIDENCE_SMOOTHING = 0.05;

/**
 * **The share of the question one channel's own answers carry, averaged over the answers it stands behind.**
 *
 * This is `selfEvidence` read at {@link EVIDENCE_DEPTH} rather than at the first slot, and it is the half of the weight
 * that the one-sided rule never computed. **A channel that cannot spell a question has nothing to say about it**, and
 * "cannot spell" is a fact about the list, not about the corpus: the same index spells a doc comment and cannot spell a
 * paraphrase of it, and only one of the two is a reason to hand the vote to the other channel.
 */
export function channelEvidence(
  query: string,
  answers: readonly RankedResult[],
  depth: number = EVIDENCE_DEPTH,
): number {
  const window = answers.slice(0, Math.max(0, depth));
  if (window.length === 0) return 0;

  let total = 0;
  for (const answer of window) total += selfEvidence(query, answer.node);
  return total / window.length;
}

/**
 * **The weight as a comparison between the two channels rather than a verdict about one of them - a candidate rule.**
 *
 * `deriveVectorWeight` reads the lexical list alone, so its answer is "how much does the index know about this
 * question". On four released repositories that question has the wrong sign: the rewritten-question corpus scores
 * **0.6500** at the weight it derives and **0.7930** at the lexical list alone, because a paraphrase is exactly the case
 * where *neither* channel can spell the question and the rule reads that as a reason to trust the vector one
 * (`EVAL-CONTRACT.md` §38.1). **The rule was fitted on CoSQA, where the vector channel is the stronger one - 340 answers
 * in its top ten against the lexical channel's 206 - and applied to a corpus where it is the weaker one.**
 *
 * The comparison is the repair: **a channel's vote is worth as much as the share of the question its own answers
 * carry.** Two channels carrying the same share are two channels with nothing to choose between, and the weight stays
 * at one; a vector list carrying three times less of the question counts a third, which is where the four-repository
 * sweep finds its optimum (0.35); a vector list carrying the whole question while the lexical list carries none counts
 * the bound.
 *
 * **This is a candidate and not the product's rule.** Nine hundred and fifty-four questions across two corpora have a
 * figure for it (§39 records which), a corpus where it loses would retire it, and `deriveVectorWeight` remains what
 * `search()` and `ask()` call until a run has measured the two side by side.
 */
export function evidenceRatioWeight(
  lexical: readonly RankedResult[],
  vector: readonly RankedResult[],
  query: string,
  depth: number = EVIDENCE_DEPTH,
): number {
  if (lexical.length === 0 || vector.length === 0) return NEUTRAL_VECTOR_WEIGHT;

  const ratio =
    (channelEvidence(query, vector, depth) + EVIDENCE_SMOOTHING) /
    (channelEvidence(query, lexical, depth) + EVIDENCE_SMOOTHING);

  return Math.min(FUSION_WEIGHT_BOUNDS.max, Math.max(FUSION_WEIGHT_BOUNDS.min, ratio));
}
