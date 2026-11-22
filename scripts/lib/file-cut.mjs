// @code-analyzer — A cut of one run, scored under the corpus's arithmetic
//
// **§85 retired every pre-judge gate in this tree, and the argument it used holds for one instrument only.** A pairwise
// judge is only asked about a finding that stands near a reference comment, so removing a finding from the unscored
// tail changes no counter: §85.2 measured 22 removals, 3 of them judged, and F1 fell. **Under `file-level-semantic-v1`
// every comment is charged** - §139's run emitted 307, covered 125 reference comments and had 216 comments that covered
// nothing - so the same removal is a gain unless the comment it removes was one of the few that bought something.
//
// The two instruments therefore price the same device differently, and the difference is not a modelling choice: it is
// which arithmetic the board scores. This module is the second arithmetic, over the verdicts the run already paid for.
//
// **The one rule that makes the walk agree with the scorer**: findings are grouped by pull request and then by path,
// because golden indices are per pull request and the protocol's lists are per file. That is exactly what
// `scoreFileSemantic` does, and this module calls it rather than reimplementing it - a second implementation of a score
// is a second score, which is the defect the whole campaign keeps paying for.

import { scoreFileSemantic } from '../../.github/scripts/lib/file-semantic.mjs';

/**
 * **One cut, as the corpus would have scored it.**
 *
 * `goldens` is the corpus's size and is passed in rather than counted from the kept findings, for the reason
 * `scripts/lib/operating-point.mjs` gives: **a cut does not change how many reference comments exist**, and a recall
 * computed from the cut's own misses rises every time the cut shrinks.
 *
 * The findings handed to the scorer carry their own path, which is what the walk groups by; **the goldens handed to it
 * carry none**, because the file-level protocol shows one file's reference comments at a time and a verdict it returns
 * therefore cannot be about another file's golden. The cross-file refusal inside the scorer has nothing to refuse on
 * this data, and an empty path is the honest description of a coordinate the scorer does not need.
 */
export function scoreFileCut({ findings, goldens, matchesOf }) {
  const byPull = new Map();
  for (const finding of findings) {
    const key = String(finding?.['pr'] ?? '');
    const bucket = byPull.get(key);
    if (bucket === undefined) byPull.set(key, [finding]);
    else bucket.push(finding);
  }

  /**
   * **A placeholder per reference comment, and the length is load-bearing.**
   *
   * The scorer bounds-checks every verdict index against this list and **silently skips the ones outside it** - a
   * sensible guard in the scorer and a trap here: passing an empty list dropped every verdict and reported a run that
   * covered nothing, which is the shape a wrong answer takes when it is not an error. The list is the corpus's size, so
   * no index a judge could return falls outside it.
   */
  const placeholders = Array.from({ length: Math.max(Number(goldens) || 0, 0) }, () => ({
    path: '',
  }));

  let hitNewGt = 0;
  let duplicateHits = 0;
  let coveredGoldens = 0;
  for (const bucket of byPull.values()) {
    const score = scoreFileSemantic({
      findings: bucket,
      goldens: placeholders,
      matches: bucket.map(matchesOf),
    });
    hitNewGt += score.hitNewGt;
    duplicateHits += score.duplicateHits;
    coveredGoldens += score.coveredGoldens;
  }

  const emitted = findings.length;
  const denominator = Math.max(Number(goldens) || 0, 1);
  const precision = emitted === 0 ? 0 : hitNewGt / emitted;
  const recall = coveredGoldens / denominator;
  return {
    emitted,
    hitNewGt,
    duplicateHits,
    coveredGoldens,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

/**
 * **There is no closed-form break-even for a removal here, and §85's threshold does not transfer.**
 *
 * The pairwise instrument cancels to `F1 = 2·TP/(emitted + goldens)`, so removing a comment pays when it removes more
 * false positives than true ones in a ratio §85 could write down (**24.9:1** on that run). Under this arithmetic the two
 * halves move on different denominators: precision is `hit/emitted` and recall is `covered/goldens`, and a comment that
 * covered nothing lowers the first without touching the second, while a comment that covered something new lowers both.
 * **The answer is therefore a number per cut and not a constant**, and it is the number `scoreFileCut` returns - which
 * is why the device is priced by the table rather than by a threshold written before it.
 */
