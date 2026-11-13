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
