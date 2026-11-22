// @code-analyzer — Filing one instrument's verdicts onto the findings they are about
//
// **An aggregate cannot be cut.** The corpus's arithmetic republishes three totals - findings, goldens covered, comments
// that bought something new - and every remaining device in `docs/EVAL-CONTRACT.md` asks a question of the form "which
// of these comments should a reviewer have filed". A run that published only the totals therefore priced each device at
// one more dispatch, which is the defect `scripts/aacr-operating-point.mjs` removed for the pairwise instrument and
// which the corpus's own arithmetic still carried: the second instrument's per-comment verdicts were computed, summed,
// and thrown away.
//
// **This module is the join and nothing else.** The verdicts arrive per pull request, in the position the plan handed
// out; the rows arrive in the order the artifact publishes them; and the two are the same order because the plan is
// built from that list. The join is small enough to look obvious and was worth extracting anyway, because **the failure
// mode is silent and flattering**: a verdict filed on the wrong row leaves every total unchanged and moves the score of
// a cut that was never run.

/**
 * **Each row, with the verdict this instrument gave the finding it is about.**
 *
 * `keys[index]` is `{ pr, at }` - the pull request the row came from and the finding's position inside that pull
 * request. `matchesByPull.get(pr)` is that pull request's array of per-finding verdicts, or `undefined`/absent when the
 * instrument could not answer it.
 *
 * **A row with no verdict keeps no field at all.** `fileLevelGoldens: []` would be a verdict ("this comment covers
 * nothing") and `fileLevelGoldens: null` would be a value a consumer has to remember to check; **an absent field is a
 * question the second instrument was not asked**, and a reader that defaults it to `matchedGoldens` - the pairwise
 * verdict it already has - is doing what §137.5 requires of the fallback. Two shapes produce that absence and both are
 * allowed: a pull request the pass could not answer, and a position the plan never assigned.
 */
export function fileLevelOnFindings({ rows, keys, matchesByPull }) {
  if (rows.length !== keys.length) {
    throw new Error(
      `${rows.length} rows but ${keys.length} coordinates, so a verdict would be filed on the wrong finding`,
    );
  }
  return rows.map((row, index) => {
    const key = keys[index];
    const perPull = matchesByPull.get(String(key?.pr));
    if (perPull === undefined) return row;
    const verdict = perPull[key.at];
    return verdict === undefined ? row : { ...row, fileLevelGoldens: verdict };
  });
}

/**
 * **The verdicts one instrument gave, per pull request, keyed the way the rows are.**
 *
 * Built from the array the judge pass returns and the list it was planned from: the pass answers by *position* in that
 * list, and the rows are keyed by the pull request's own identifier, so this is the one place the two coordinate systems
 * are reconciled. **`undefined` is carried through rather than replaced**, for the reason the module above gives.
 */
export function verdictsByPull({ pulls, matches }) {
  const byPull = new Map();
  pulls.forEach((pull, index) => {
    byPull.set(String(pull.pr), matches[index]);
  });
  return byPull;
}
