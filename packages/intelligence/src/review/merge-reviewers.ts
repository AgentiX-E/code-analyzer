// @code-analyzer/intelligence — two reviewers, one comment list, and a merge that cannot be worse than a cut
//
// **Two arms of `43676036390` reviewed the same hundred pull requests and disagreed in a way that is worth money.** The
// five lanes found **198 distinct goldens**; the reading agent found **171**; **only 93 were in common**. The union is
// **276 of 724 (38 %)**, against 27 % for either reviewer alone - so the second reviewer is not a second opinion about
// the same code, it is a second *field of view*, and 78 goldens exist that no lane reaches.
//
// **It also spends 1 920 comments to say it.** Cut to twelve per pull request the union is 890 comments at F1 0.2243
// against the lanes' 653 at 0.2121: **+0.0122 for 36 % more comments**, because the two producers describe the same
// defect from different heights - a lane flags the branch, the reader flags the line above it, and both are posted.
// **A merge that removed the restatements and kept the 78 unique goldens is 770 comments at 0.2422** (§56), and that is
// the number this module exists to reach.
//
// **Three decisions make it measurable and safe.**
//
//   1. **It selects; it does not rewrite.** The model is asked which candidates to keep, never how to phrase one. A kept
//      candidate carries the verdict it was already judged with, so the device can be priced on artifacts that exist
//      instead of on a second paid run - and a run that changes the wording cannot be compared with one that did not.
//   2. **It never sees an answer key.** The prompt carries the two reviewers' sentences and the budget. The word
//      `golden` appears in this file four times and in the prompt zero times, and a test asserts that.
//   3. **It cannot be worse than the cut it replaces.** A candidate list that already fits the budget buys no call at
//      all; an answer that does not parse, or that keeps nothing, falls back to `mergeCandidates` - which is the
//      measured rule - and the outcome says which of the three paths decided, so a figure is never attributed to a model
//      that declined to answer.
//
// **The fallback is the point, not the safety net.** `docs/EVAL-CONTRACT.md` §56 prices three merges: positional
// de-duplication at 0.2215, plain score order at 0.2243 and the model's judgement at up to 0.2422. The first two are
// what the fallback is for; the third is the hypothesis.

import type { LLMProvider } from './llm/provider.js';

/** One candidate comment, as the merge sees it. **`ref` is the caller's key and the only thing the answer may name.** */
export interface MergeCandidate {
  readonly ref: string;
  readonly source: 'lanes' | 'reader';
  readonly path: string;
  readonly line: number;
  readonly category: string;
  readonly score: number;
  readonly text: string;
}

/** Why a candidate is not in the merged list. */
export type MergeDropReason = 'duplicate' | 'over-budget' | 'not-kept' | 'unknown-ref';

export interface MergeDropped {
  readonly ref: string;
  readonly reason: MergeDropReason;
  /** Set when `reason` is `duplicate`: the kept candidate that says the same thing. */
  readonly of?: string;
}

export interface MergeOutcome {
  readonly kept: MergeCandidate[];
  readonly dropped: MergeDropped[];
  /**
   * **Which of the three paths decided**, so a figure about a merge can be attributed to a model or to arithmetic.
   * `budget` means no call was needed; `model` means the answer was used; `fallback` means the answer was refused and
   * `detail` says why.
   */
  readonly decidedBy: 'budget' | 'model' | 'fallback';
  readonly detail: string;
  /** Completions bought by this merge. **Zero is the common case**, and a cost figure that assumed one would be wrong. */
  readonly calls: number;
  /**
   * **How many candidates each reviewer contributed, because a merge of one list and nothing is a sort.**
   *
   * R-29 was registered as a merge of the five lanes and the reading reviewer and ran with the lanes emptied upstream, so
   * its artifact carried 394 candidates for 46 pull requests - one reviewer's worth - and no field that could say so.
   * **A device whose input can be empty without the artifact noticing is a device that can be measured as something
   * else**, so the two counts travel with the outcome and the harness sums them.
   */
  readonly sides: { readonly lanes: number; readonly reader: number };
}

/** How many candidates each reviewer contributed, which is the only field that says a union was a union. */
const sidesOf = (candidates: readonly MergeCandidate[]) => ({
  lanes: candidates.filter((entry) => entry.source === 'lanes').length,
  reader: candidates.filter((entry) => entry.source === 'reader').length,
});

/** Twelve per pull request, which is the operating point §54 prices and the policy the product ships. */
export const MERGE_BUDGET_PER_PULL_REQUEST = 12;

/**
 * **The order a merge reduces to when no model decides**, and the order an over-generous answer is cut down in.
 *
 * Score first, then **the lanes before the reader**, then the caller's order. The tie-break is not cosmetic: on
 * `43676036390` the lanes score 0.156 precision at full emission and the reader 0.181, but the lanes' findings are the
 * ones the product's own rules produced, so a tie goes to the finding that exists without a model call.
 */
const compare = (left: MergeCandidate, right: MergeCandidate): number =>
  right.score - left.score || (left.source === right.source ? 0 : left.source === 'lanes' ? -1 : 1);

/** The measured cut: score order per pull request, truncated at the budget. */
export function mergeCandidates(
  candidates: readonly MergeCandidate[],
  budget: number,
): MergeOutcome {
  const ordered = [...candidates].sort(compare);
  const kept = ordered.slice(0, Math.max(0, budget));
  const keptRefs = new Set(kept.map((entry) => entry.ref));
  return {
    // **Counted from the candidates rather than passed in**, because a caller that passed the wrong numbers would publish
    // a merge of two lists that never met, and the components are already labelled on every candidate.
    sides: sidesOf(candidates),
    kept,
    dropped: ordered
      .filter((entry) => !keptRefs.has(entry.ref))
      .map((entry) => ({ ref: entry.ref, reason: 'over-budget' as const })),
    decidedBy: 'budget',
    detail: '',
    calls: 0,
  };
}

/**
 * **The merge task, in the model's words.**
 *
 * Four properties are load-bearing and each of them is a sentence a reader can disagree with:
 *
 * - **The overlap is stated**, because a model told only "merge these" will return both lists concatenated.
 * - **The keep criteria are about the reader's use of the comment** - a consequence a maintainer would act on, quoted
 *   code, a category nothing covers - rather than about which reviewer produced it. **A prompt that says "prefer the
 *   reader" would produce a merge that is a filter**, and the arm's own measurement says the reader alone is worse.
 * - **Rewriting is forbidden**, because the device's measurement depends on the sentences being the ones that were
 *   judged. A model that improves a sentence would move the score by a route the artifact cannot separate from the
 *   selection.
 * - **The budget is stated in the same sentence as the count**, so an answer that keeps twenty can be recognised as
 *   over-generous rather than as a different reading of "merge".
 */
export function mergePrompt(candidates: readonly MergeCandidate[], budget: number): string {
  const lines = candidates.map((entry) => {
    const text = entry.text.replace(/\s+/gu, ' ').trim().slice(0, 240);
    return `[${entry.ref}] ${entry.source} · ${entry.path}:${String(entry.line)} · ${entry.category} · score ${entry.score.toFixed(2)} · ${text}`;
  });
  return [
    'You are merging two reviewers of one pull request into a single list of comments to post.',
    '',
    'Reviewer "lanes" applies fixed rules to the changed lines. Reviewer "reader" read the repository and quoted the',
    'code it is describing. They overlap: two candidates that raise the same issue about the same code are duplicates',
    'even when the wording differs, and two candidates about different issues at the same line are not.',
    '',
    `Keep at most ${String(budget)} candidates.`,
    '',
    'Prefer, in this order: a candidate that states a consequence a maintainer would act on; a candidate that names',
    'the code it is about; a candidate whose category no kept candidate covers yet.',
    '',
    'Do not rewrite, merge or improve a sentence. This list decides which comments are posted, not how they read.',
    '',
    'Answer with JSON only, no prose:',
    '{"keep": ["<ref>", ...], "duplicates": [{"drop": "<ref>", "of": "<ref>"}]}',
    '',
    'Candidates:',
    ...lines,
  ].join('\n');
}

export interface MergeAnswer {
  readonly keep: string[];
  readonly duplicates: ReadonlyArray<{ readonly drop: string; readonly of: string }>;
}

/**
 * **The answer, whatever the model wrapped it in.**
 *
 * Models put JSON in a fence, prefix it with a sentence, or emit a trailing comment. **The parse should not fail because
 * of the wrapper** - what should fail is an answer with no object in it at all, or one whose `keep` is not a list, and
 * those return `null` so the caller falls back rather than treating a refusal as an empty merge.
 */
export function parseMergeAnswer(answer: string): MergeAnswer | null {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const keep = record['keep'];
  if (!Array.isArray(keep)) return null;
  const duplicatesRaw = record['duplicates'];
  const duplicates = Array.isArray(duplicatesRaw)
    ? duplicatesRaw
        .filter(
          (entry): entry is { drop: string; of: string } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as Record<string, unknown>)['drop'] === 'string' &&
            typeof (entry as Record<string, unknown>)['of'] === 'string',
        )
        .map((entry) => ({ drop: entry.drop, of: entry.of }))
    : [];
  return { keep: keep.filter((entry): entry is string => typeof entry === 'string'), duplicates };
}

export interface MergeRequest {
  readonly lanes: readonly MergeCandidate[];
  readonly reader: readonly MergeCandidate[];
  readonly provider: LLMProvider;
  readonly budget?: number;
  readonly tag?: string;
}

/**
 * **The merge, with the fallback made explicit.**
 *
 * The order of the guards is the order of the costs: no second reviewer and no call; a list that fits the budget and no
 * call; then one completion. **An answer is refused rather than repaired** when it is unparseable, when it keeps nothing,
 * or when every ref it named was imaginary - each with its own `detail`, because a fallback rate that cannot say which
 * failure produced it is a number that hides its own cause.
 */
export async function mergeReviewers(request: MergeRequest): Promise<MergeOutcome> {
  const budget = request.budget ?? MERGE_BUDGET_PER_PULL_REQUEST;
  const candidates = [...request.lanes, ...request.reader];
  if (request.reader.length === 0) {
    // **Nothing to merge is not a merge.** The reader filed no comment on this pull request - its own filing check
    // refuses a draft whose quoted code cannot be located - and a call that asked a model to choose among one
    // reviewer's candidates would be buying a decision that has one answer.
    const outcome = mergeCandidates(candidates, budget);
    return { ...outcome, detail: 'one reviewer: the reader filed nothing for this pull request' };
  }
  if (candidates.length <= budget) {
    return mergeCandidates(candidates, budget);
  }

  const answer = await request.provider.complete(mergePrompt(candidates, budget), {
    temperature: 0,
    maxTokens: 800,
    tag: request.tag ?? 'review:merge',
  });
  const parsed = parseMergeAnswer(answer.content);
  const fallback = (detail: string): MergeOutcome => ({
    ...mergeCandidates(candidates, budget),
    decidedBy: 'fallback',
    detail,
    calls: 1,
  });
  if (parsed === null) return fallback('unparseable answer: no JSON object with a keep list');

  const byRef = new Map(candidates.map((entry) => [entry.ref, entry]));
  const ordered = [...candidates].sort(compare);
  const kept: MergeCandidate[] = [];
  const dropped: MergeDropped[] = [];
  const named = new Set<string>();
  for (const ref of parsed.keep) {
    if (named.has(ref)) continue;
    named.add(ref);
    const found = byRef.get(ref);
    if (found === undefined) {
      dropped.push({ ref, reason: 'unknown-ref' });
      continue;
    }
    kept.push(found);
  }
  if (kept.length === 0)
    return fallback('empty keep list: the answer named no candidate this pull request has');

  // **The model's list is re-sorted rather than trusted in order**, and cut at the budget, because a merge that keeps
  // twenty candidates has answered a different question than the one it was asked.
  kept.sort(compare);
  const withinBudget = kept.slice(0, Math.max(0, budget));
  const keptRefs = new Set(withinBudget.map((entry) => entry.ref));
  for (const entry of kept) {
    if (!keptRefs.has(entry.ref)) dropped.push({ ref: entry.ref, reason: 'over-budget' });
  }
  const duplicated = new Map(parsed.duplicates.map((entry) => [entry.drop, entry.of]));
  for (const entry of ordered) {
    if (keptRefs.has(entry.ref)) continue;
    if (named.has(entry.ref)) continue;
    const of = duplicated.get(entry.ref);
    if (of !== undefined) dropped.push({ ref: entry.ref, reason: 'duplicate', of });
    else dropped.push({ ref: entry.ref, reason: 'not-kept' });
  }
  return {
    // **The whole candidate list, not the kept subset**, or the artifact would report a union that shrank whenever the
    // model kept few rows.
    sides: sidesOf(ordered),
    kept: withinBudget,
    dropped,
    decidedBy: 'model',
    detail: '',
    calls: 1,
  };
}
