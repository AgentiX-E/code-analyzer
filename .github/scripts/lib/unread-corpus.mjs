// @code-analyzer — What a run lost, and whether it is allowed to call the result a measurement
//
// **The run of 2026-11-11 reviewed 38 of 50 pull requests and said so in one word.** `prsWithoutDiff: 12` appeared in the
// artifact, `unfetched += 1` appeared in the code, and **nothing anywhere named which twelve or why** - so the run could
// not distinguish a rate limit from a typo in the corpus from a network fault, and the three have different repairs.
//
// **And a corpus that shrank by a quarter is not the corpus the registration was written against.** Recall over 349
// goldens is not recall over 452, and the artifact is the only place a reader can find that out. So the loss travels as
// a list, and the share travels with it, because **a share is the thing a reader compares against the size of the effect
// they were hoping to see.**

/**
 * **How much of the corpus a run actually read.**
 *
 * `lost` and `share` are derived from the two counts rather than stored, because **a third number is a third chance to
 * disagree** - the rule this project has now applied to a coverage gate, a spend ceiling and this.
 */
export function unreadCorpus({ requested, unread }) {
  const total = Math.max(0, Math.trunc(Number(requested ?? 0)));
  const lost = Math.max(0, Math.trunc(Number(unread ?? 0)));
  return {
    requested: total,
    unread: Math.min(lost, total),
    read: Math.max(0, total - lost),
    share: total === 0 ? 0 : Math.round((Math.min(lost, total) / total) * 10000) / 10000,
  };
}

/**
 * **The line the log prints, or `null` when nothing was lost.**
 *
 * `null` rather than an empty string, because **a caller that has to decide whether to print is a caller that decides the
 * same thing twice** - and the second decision is where a run with twelve missing pull requests ends up printing nothing.
 *
 * The first reason is quoted because **a list of twelve identical rate-limit messages is twelve lines nobody reads**, and
 * the reading that matters is "which of the three causes is it".
 */
export function describeUnread({ requested, unread, pulls }) {
  const facts = unreadCorpus({ requested, unread });
  if (facts.unread === 0) return null;
  const first = Array.isArray(pulls) && pulls.length > 0 ? String(pulls[0]?.reason ?? '') : '';
  return (
    `unread · ${String(facts.unread)} of ${String(facts.requested)} pull requests ` +
    `(${String(Math.round(facts.share * 100))} % of the corpus) · ` +
    (first === '' ? 'no reason recorded' : first)
  );
}

/**
 * **Whether a run's figures are a measurement of the corpus it was asked for, or of the part of it that arrived.**
 *
 * The threshold is one in twenty - **the largest loss that cannot move a recall figure by more than its own error bar on
 * this corpus** - and it is a *disclosure* rather than a refusal: a run that read 49 of 50 is still a result, and a run
 * that read 38 of 50 is a result about 38 pull requests. **What is not allowed is printing the second as the first**,
 * which is why the share travels in the artifact and the log.
 */
export const UNREAD_DISCLOSURE_THRESHOLD = 0.05;

export function readTheWholeCorpus({ requested, unread }) {
  return unreadCorpus({ requested, unread }).share <= UNREAD_DISCLOSURE_THRESHOLD;
}
