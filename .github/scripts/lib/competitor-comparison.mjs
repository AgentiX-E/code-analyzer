// @code-analyzer — The head-to-head, and whether this run is allowed to state one
//
// **Why this is a module rather than a field.** The artifact of the fifty-pull-request run of 2026-11-10 published
// `mcnemar: { oursOnly 83, theirsOnly 0, pValue 0, verdict: "significant at 0.05" }` while its own log said
// `competitor replay · replayed 0 · recorded 0 · missing 50 · findings 0`. **The competitor produced no findings because
// the competitor produced no rows**, and the field reported that as the strongest result in the project's history.
//
// The run was not lying twice. It was holding **two representations of one comparison**: `secondReviewer.comparable`,
// which knew the arm was absent, and a top-level `mcnemar`, which did not. **Two copies of one rule is how a figure ends
// up disagreeing with the sentence printed next to it**, and the disagreement was resolved in favour of the flattering
// one because the flattering one was the one a reader quotes.
//
// **So there is one function, it returns one object, and the object carries its own precondition.** Every reader - the
// artifact field, the console line, the next script that wants the number - reads the same object, and there is no
// second place to forget the check.

import { exactMcNemar } from './paired-test.mjs';

/**
 * The verdict a comparison carries when it is not allowed to state one.
 *
 * **A word rather than an absent field**, because **a missing key reads as "the harness forgot"** and a named verdict
 * reads as "the harness refused". The second is a fact about this run; the first sends the next person to look for a bug
 * that is not there.
 */
export const WITHHELD = 'withheld';

/** Round to four places, which is the precision this repository publishes p-values at. */
function round(value) {
  return Math.round(value * 10000) / 10000;
}

/**
 * **The comparison, or the reason there is not one.**
 *
 * A head-to-head needs both arms scored over **the same pull requests and the same goldens**. Ours always is - it is
 * this run. The competitor's may not be: a replayed row can be missing because the baseline does not cover this corpus,
 * because the judge moved, or because that pull request's goldens changed. **In every one of those cases the
 * competitor's figure would be computed over a smaller corpus than ours, and a precision stated over a smaller
 * denominator reads exactly like a worse reviewer.**
 *
 * Four conditions, and each of them alone is enough to withhold:
 *
 * 1. **no pull request was scored**, so there is nothing to compare;
 * 2. **no competitor row at all**, which is (3) with the reason a reader needs first;
 * 3. **the arms overlap on no pull request**, so there is no pair for the test to be about;
 * 4. **some pull request has no competitor row and the counts were not restricted to the pairing**, so the two figures
 *    are over two corpora.
 *
 * **Condition 4 is the one this function used to get wrong, in the safe direction.** It withheld whenever a single pull
 * request was missing, and the competitor's harness fails on a pull request in every run - so the rule was not
 * conservative, it was a decision never to answer. **The fix is not to lower the bar; it is to point the bar at the
 * right corpus.** A paired test is defined on the paired subset: a pull request only one arm scored contributes no
 * pair, so removing it from *both* sides preserves the measurement. What must move with it is the F1 each side is
 * quoted at, and that is the caller's obligation - stated here as `paired`, so a caller that restricted its counts says
 * so and a caller that did not gets the old refusal.
 *
 * **`oursOnly` is still reported when the comparison is withheld**, because it is a fact about our arm and a reader
 * rebuilding the coverage from the artifact needs it. **`theirsOnly` is not**, because it would be zero by construction
 * and **a guaranteed zero in a column reads as a shutout.**
 */
export function compareAgainstCompetitor({ oursOnly, theirsOnly, coverage, paired }) {
  const requested = Math.max(0, Math.trunc(Number(coverage?.requested ?? 0)));
  const covered = Math.max(0, Math.trunc(Number(coverage?.covered ?? 0)));
  // **`missing` is the larger of what the caller reported and what the arithmetic implies**, because `0` is the one
  // value that admits every comparison and it is also the default a caller gets by saying nothing. A caller that states
  // ten requested and four covered has six holes whether or not it remembered to count them, and **a gate that trusts a
  // third number over the two it can check is a gate that a forgotten field walks through.**
  const reported = Math.max(0, Math.trunc(Number(coverage?.missing ?? 0)));
  const missing = Math.max(reported, requested - covered);
  const share = requested === 0 ? 0 : round(covered / requested);
  const normalised = { requested, covered, missing, share };

  // **`null` when the caller did not state a pairing**, and `0` when it stated one with nothing in it - two different
  // facts that would be the same number, which is why the absent case is `undefined` before it is anything else.
  const pairedPullRequests =
    paired === undefined || paired === null
      ? null
      : Math.max(0, Math.trunc(Number(paired.pullRequests ?? 0)));

  let withheldReason = null;
  if (requested === 0) {
    withheldReason = 'this run scored no pull requests, so there is nothing to compare against';
  } else if (covered === 0) {
    withheldReason =
      `the competitor arm produced no row at all - ${String(missing)} of ${String(requested)} pull requests are ` +
      'missing - so a head-to-head would be a comparison against nothing';
  } else if (pairedPullRequests === 0) {
    withheldReason =
      'no pull request both arms scored, so the paired test has no pair to be about and a verdict would be about ' +
      'the arithmetic rather than about the reviewers';
  } else if (missing > 0 && pairedPullRequests === null) {
    withheldReason =
      `${String(missing)} of ${String(requested)} pull requests have no competitor row, so its figure would be ` +
      'computed over a smaller corpus than ours and the two numbers would not be the same measurement';
  }

  if (withheldReason !== null) {
    return {
      comparable: false,
      verdict: WITHHELD,
      withheldReason,
      oursOnly: Math.max(0, Math.trunc(Number(oursOnly ?? 0))),
      theirsOnly: null,
      pValue: null,
      coverage: normalised,
      scope: null,
    };
  }

  const ours = Math.max(0, Math.trunc(Number(oursOnly ?? 0)));
  const theirs = Math.max(0, Math.trunc(Number(theirsOnly ?? 0)));
  const pValue = exactMcNemar(ours, theirs);
  // **The corpus the two figures are over, carried on every stated verdict.** `whole corpus` and `paired subset` are
  // the only two honest answers, and the second one has a denominator a reader has to be told.
  const scope =
    missing === 0
      ? { basis: 'whole corpus', pullRequests: covered, requested, excluded: 0 }
      : { basis: 'paired subset', pullRequests: pairedPullRequests, requested, excluded: missing };
  return {
    comparable: true,
    verdict: pValue <= 0.05 ? 'significant at 0.05' : 'not significant at 0.05',
    withheldReason: null,
    oursOnly: ours,
    theirsOnly: theirs,
    pValue: round(pValue),
    coverage: normalised,
    scope,
  };
}

/**
 * **The one line the log prints, derived from the same object the artifact stores.**
 *
 * Not a second reading of the counts: **a console line assembled from the raw counts would keep printing a shutout after
 * the artifact had stopped**, which is the state the 2026-11-10 run was in for a whole iteration.
 */
export function describeComparison(comparison) {
  const { requested, covered, missing } = comparison.coverage;
  if (!comparison.comparable) {
    return (
      `comparison ${WITHHELD} · ${missing} of ${requested} pull requests have no competitor row · ` +
      `coverage ${covered}/${requested}`
    );
  }
  // **The scope travels with the p-value**, because a discordance count is a count of pairs and a reader who quotes the
  // p-value without the number of pull requests it was computed over has quoted a different claim.
  const scope =
    comparison.scope !== null && comparison.scope.basis === 'paired subset'
      ? ` · on ${String(comparison.scope.pullRequests)} of ${String(comparison.scope.requested)} pull requests`
      : '';
  return (
    `comparison ${comparison.verdict} · ours-only ${comparison.oursOnly} · theirs-only ${comparison.theirsOnly} · ` +
    `p ${comparison.pValue} · coverage ${covered}/${requested}${scope}`
  );
}
