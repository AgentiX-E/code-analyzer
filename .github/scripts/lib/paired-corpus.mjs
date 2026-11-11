// @code-analyzer — Which pull requests both arms were scored on, and what each arm found there
//
// **Why the comparison needed a corpus rather than a coverage threshold.**
//
// The run of 2026-11-11 scored 36 pull requests. Its competitor arm had a row for 33 of them, and the head-to-head was
// published `withheld` - which was correct, because our figure was computed over 36 and theirs over 33. **But that rule
// could only ever say `withheld`**: the competitor's harness fails on a pull request in every run (four of thirty-six in
// the `defect` arm, six in the advisory arm), so "every pull request has a row" is a precondition that is never
// satisfied, and a precondition that is never satisfied is a decision never to answer the question.
//
// **A paired test is defined on the paired subset.** A pull request only one arm scored contributes no pair, so it
// contributes nothing to McNemar; removing it from *both* sides preserves the measurement instead of corrupting it. What
// must move with the removal is **the F1 each side is quoted at** - which is why this module hands back the pull
// requests instead of a correction to a figure that has already been computed. The caller scores both arms over the
// rows it gets back, and the two figures are then the same measurement by construction.
//
// **And the second half, which is why the discordance function takes one rule.** The pairing counted ours under the
// pre-registered actionability gate and theirs with every finding it emitted, so their arm took credit for findings the
// rule rejects and ours did not - the same one-sidedness the 2026-11-10 audit named, still live in the code written to
// fix it. `goldenDiscordance(pairs, rule)` takes **one rule and two rows**, so a second rule has no parameter to arrive
// through.

/** The reason a pull request we scored is not in the pairing. */
export const COMPETITOR_ROW_ABSENT = 'the competitor has no row for this pull request';

/** The reason a pull request the competitor scored is not in the pairing. */
export const OUR_ROW_ABSENT = 'this run has no scored row for this pull request';

/**
 * **The pull requests both arms scored, and the names of those they did not.**
 *
 * Returns rows rather than counts, because **a count cannot be scored**: the caller needs the `matches` and `keep` of
 * each side to recompute the two operating points over the same corpus, and a function that returned only how many
 * pairs there are would leave the caller to filter by key a second time - which is the second copy of a rule that this
 * file exists to remove.
 *
 * **One row per key.** Two rows under one key are two rows about one pull request; counting them as two pairs would
 * count one measurement twice, in whichever direction the duplicate fell.
 */
export function pairedCorpus({ ours = [], theirs = [], keyOf = (pull) => pull.key } = {}) {
  const ourByKey = new Map();
  for (const pull of ours) {
    const key = keyOf(pull);
    if (!ourByKey.has(key)) ourByKey.set(key, pull);
  }
  const theirByKey = new Map();
  for (const pull of theirs) {
    const key = keyOf(pull);
    if (!theirByKey.has(key)) theirByKey.set(key, pull);
  }

  const pairs = [];
  const excluded = [];
  // **In our order**, because a report that reorders the corpus between two runs makes two runs of the same corpus look
  // like two corpora.
  for (const [key, pull] of ourByKey) {
    const counterpart = theirByKey.get(key);
    if (counterpart === undefined) {
      excluded.push({ key, reason: COMPETITOR_ROW_ABSENT });
      continue;
    }
    pairs.push({ key, ours: pull, theirs: counterpart });
  }

  const theirsOnly = [];
  for (const key of theirByKey.keys()) {
    if (!ourByKey.has(key)) theirsOnly.push({ key, reason: OUR_ROW_ABSENT });
  }

  return { pullRequests: pairs.length, pairs, excluded, theirsOnly };
}

/**
 * **Which goldens one arm covers and the other does not, under one rule.**
 *
 * The rule is the emission rule the run registered before it started - a function from a scored row to the golden
 * indices that row's surviving findings match. **The same function is applied to both arms**, which is the whole point:
 * the rule is a property of the comparison, not of the reviewer being measured.
 *
 * Discordance is counted per golden, keyed by pull request, because McNemar's test is over pairs of observations and one
 * observation here is *"did this reviewer cover this golden"*.
 */
export function goldenDiscordance(pairs = [], rule) {
  if (typeof rule !== 'function') {
    throw new TypeError('goldenDiscordance needs the emission rule both arms were scored under');
  }

  const coveredKeys = (side) => {
    const keys = new Set();
    for (const pair of pairs) {
      const row = pair[side];
      if (row === undefined || row === null) continue;
      for (const index of rule(row).indices) keys.add(`${pair.key}#${String(index)}`);
    }
    return keys;
  };

  const ourKeys = coveredKeys('ours');
  const theirKeys = coveredKeys('theirs');

  let oursOnly = 0;
  for (const key of ourKeys) if (!theirKeys.has(key)) oursOnly += 1;
  let theirsOnly = 0;
  for (const key of theirKeys) if (!ourKeys.has(key)) theirsOnly += 1;

  return { oursOnly, theirsOnly };
}
