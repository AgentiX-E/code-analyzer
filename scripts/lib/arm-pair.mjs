// @code-analyzer — Two arms, one corpus, one cut: the pairing a device is priced by
//
// **A device is priced by running it twice inside one dispatch and comparing the two arms at one operating point.** Two
// ways of getting that comparison wrong both produce a plausible number, and both were made in this repository within
// one day of each other:
//
// - **the table at one cut and the pairing at another.** The window control's F1 was computed at the published gate and
//   the first paired test was computed over the full emission, and the two disagreed by seventeen goldens in the `both`
//   cell. **Both were arithmetic over the same artifacts**; the failure was that a reader would take the p-value and the
//   delta as one result about one configuration, and they were about two.
// - **a pairing over two sets that were never drawn from the same corpus.** An arm scored over 100 pull requests against
//   an arm scored over 60 reports a large `offOnly` that is a fact about the runs and not about the device.
//
// So the coverage set is read from `coverage.byPullRequest[].covered` - **the rows the published point was computed over**
// - and an artifact without that block is refused rather than paired as an empty set, because `both: 0, p: 1` reads like
// independence and is really a missing field.

import { pairedComparison } from '../../.github/scripts/lib/paired-test.mjs';
import { applyCut, describeCut, registeredCuts, score } from './operating-point.mjs';

/** The credit a finding's verdicts allow, which is the row of the judged matrix the score reads. */
const creditOf = (finding) => finding?.['matchedGoldens'] ?? [];

/**
 * **The `(pull request, golden)` pairs an arm was credited with, at the point it published.**
 *
 * A golden index alone is unique only inside its own pull request, which is why the key carries both - two pull requests
 * both numbering from zero would otherwise share credit the corpus holds separately.
 */
export function coverageSet(artifact) {
  const rows = artifact?.coverage?.byPullRequest;
  if (!Array.isArray(rows)) {
    throw new Error(
      'an artifact with no coverage.byPullRequest cannot be paired: an empty set would report both 0 and p 1, ' +
        'which reads as independence and is a missing field',
    );
  }
  const set = new Set();
  for (const pull of rows) {
    for (const at of pull?.covered ?? []) set.add(`${String(pull?.pr)}#${String(at)}`);
  }
  return set;
}

/** Which keys the two arms' configurations differ in, so a comparison can say what it is a comparison of. */
function variedKeys(off, on) {
  const left = off?.configuration ?? {};
  const right = on?.configuration ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const varied = [];
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) varied.push(key);
  }
  return varied.sort();
}

/**
 * **What the two arms did together**, per pull request and golden.
 *
 * `off` and `on` are named rather than `ours` and `theirs`, because **a device has a switch and a competitor does not**:
 * the competitor comparison already has `oursOnly`/`theirsOnly` and reusing those words here would make two different
 * questions look like one.
 */
export function pairArms(off, on) {
  const offSet = coverageSet(off);
  const onSet = coverageSet(on);
  const paired = pairedComparison(offSet, onSet);
  return {
    both: paired.both,
    offOnly: paired.oursOnly,
    onOnly: paired.theirsOnly,
    pValue: paired.pValue,
    verdict: paired.verdict,
    off: { covered: offSet.size },
    on: { covered: onSet.size },
    varied: variedKeys(off, on),
  };
}

/**
 * **One table, both arms, every registered cut**, with the delta signed `on − off`.
 *
 * The denominator is `truePositives + falseNegatives` from each artifact's own published point, so **both arms divide by
 * the same corpus** - a cut that keeps a tenth of the emission must not report the recall of the tenth it kept, and two
 * arms scored against two denominators would make the delta a difference of two ratios rather than a difference of two
 * reviewers.
 */
export function cutComparison(off, on, budgets) {
  // **The full-emission block when the artifact has one, and the published point otherwise** - the same reading the
  // single-arm CLI takes, because two readers of one denominator is how two tables about one run come to disagree.
  const corpusOf = (artifact) => {
    const published = artifact?.['fullEmission'] ?? artifact;
    return Number(published?.['truePositives'] ?? 0) + Number(published?.['falseNegatives'] ?? 0);
  };
  const offGoldens = corpusOf(off);
  const onGoldens = corpusOf(on);
  if (offGoldens <= 0 || onGoldens <= 0) {
    throw new Error(
      'an artifact that does not say how many goldens it was scored against cannot be cut',
    );
  }
  const offFindings = off?.rankedFindings ?? [];
  const onFindings = on?.rankedFindings ?? [];
  return registeredCuts(budgets).map(({ steps }) => {
    const left = score(applyCut(offFindings, steps), creditOf, offGoldens);
    const right = score(applyCut(onFindings, steps), creditOf, onGoldens);
    return {
      cut: describeCut(steps),
      steps,
      off: left,
      on: right,
      delta: right.f1 - left.f1,
    };
  });
}
