// **Two numbers a paid run must not be allowed to invent for itself: how many pull requests it reads, and what it may
// spend doing so.**
//
// Both were literals in the bench script - `MAX_PRS = 14` and `AACR_MAX_USD ?? 12` - and **a literal that a dispatch
// input can override without arithmetic is a ceiling that stops protecting anything the moment the corpus grows.** The
// run of 2026-11-10 measured 0.57 USD for fourteen pull requests; a fifty-pull-request run is expected to cost about
// 2.3 USD and would have been admitted by the same 5 USD ceiling that was written for fourteen. **The ceiling has to be
// a rate, not a constant**, and a rate is arithmetic, and arithmetic in a workflow's `env:` block is arithmetic nobody
// tests.
//
// **So it lives here, as two pure functions, with the numbers and the reason for them written beside each other.**

/**
 * **What one pull request has cost us to score, replayed competitor arm included, with the margin a ceiling needs.**
 *
 * `replay` is a review and a judge: 0.57 USD over 14 pull requests on 2026-11-10, so **0.041 USD per pull request**, and
 * the rate below is that rounded up four times - **a ceiling is for a retry storm, not for an estimate.** `record` adds
 * the competitor's own run, 5.89 USD over the same fourteen, so 0.42 per pull request and 0.5 is the same margin over
 * the sum.
 */
export const CEILING_USD_PER_PULL_REQUEST = { replay: 0.15, record: 0.5 };

/**
 * **What a pull request costs when the reviewer is an agent rather than five lanes, and why the number is provisional.**
 *
 * The agent reads the repository: a plan, four rounds of tool calls and a filter pass per group, over prompts that carry
 * file text rather than three lines of hunk context. **That is a different shape of spend and it has not been measured
 * yet** - so this rate is deliberately generous rather than fitted, and the artifact records the ceiling it ran under so
 * the next iteration can replace it with a measurement instead of an estimate. **A ceiling set below the cost of a
 * valid run is a ceiling that produces a low recall and calls it a reviewer.**
 */
export const CEILING_USD_PER_PULL_REQUEST_AGENT = 0.35;

/**
 * **The smallest ceiling that still admits the run the script was written for.**
 *
 * A rate alone would refuse a small corpus it should clearly allow (fourteen pull requests at 0.15 is 2.1 USD, and the
 * observed cost is 0.64), and a floor alone is what this replaces. **The two together are the bound**: it never falls
 * below a valid run of the corpus the registration was written against, and it grows with the corpus instead of being
 * silently exceeded by it.
 */
export const CEILING_USD_FLOOR = { replay: 2, record: 12 };

/**
 * **The number of pull requests a run will read.**
 *
 * **A dispatch input arrives as a string, and `Number('')` is 0 and `Number('abc')` is NaN** - both of which the loader
 * downstream would take as "read no rows" and report as a corpus of zero goldens with a precision of zero. **A run that
 * scored nothing would then look like a run that found nothing**, which is the failure mode this repository has a rule
 * about. So a value that is not a positive integer is refused here, loudly, before a model is called.
 */
export function requestedPullRequests(raw, { fallback = 14 } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`MAX_PRS must be a positive integer, received ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * **What this run may spend, from its size and what it intends to buy.**
 *
 * `override` is kept because a deliberate one-off is a legitimate thing to want and **because the artifact records the
 * number the run was bounded by** - so an overridden ceiling is visible in the artifact rather than in someone's memory.
 * An empty string counts as no override: the workflow passes the variable conditionally, and a conditional `env:` that
 * falls through sets it to `''` rather than leaving it unset.
 */
export function spendCeilingUsd({ pullRequests, mode, override, agent = false }) {
  const explicit = Number(override);
  if (
    override !== undefined &&
    override !== null &&
    String(override).trim() !== '' &&
    Number.isFinite(explicit) &&
    explicit > 0
  ) {
    return explicit;
  }
  const key = mode === 'record' ? 'record' : 'replay';
  // **The agent rate replaces the lane rate rather than adding to it**, because the arm runs one reviewer or the other:
  // a `record` run needs both, so the two rates are summed there and only there.
  const rate =
    (agent ? CEILING_USD_PER_PULL_REQUEST_AGENT : CEILING_USD_PER_PULL_REQUEST[key]) +
    (agent && key === 'record' ? CEILING_USD_PER_PULL_REQUEST.record : 0);
  const scaled = rate * requestedPullRequests(pullRequests);
  return Math.max(CEILING_USD_FLOOR[key], Math.round(scaled * 100) / 100);
}

/**
 * **Where in the corpus a run starts, so that a confirmation is not measured on the rows that produced the hypothesis.**
 *
 * The discovery for R-17 was made on the first fifty pull requests of AACR-Bench; the confirmation has to be a run of
 * the hundred that follow, or **a threshold placed between two measured groups and then confirmed on the same rows is a
 * threshold fitted to them.** A corpus size alone cannot say that, because it always starts at zero.
 *
 * **The same refusal as `requestedPullRequests`**: a value that is not a non-negative integer is not silently treated as
 * zero, because **"read the first fifty" arriving as `NaN` would produce a second discovery run reported as a
 * confirmation** - which is the one outcome this parameter exists to prevent.
 */
export function skippedPullRequests(raw, { fallback = 0 } = {}) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `AACR_SKIP_PRS must be a non-negative integer, received ${JSON.stringify(raw)}`,
    );
  }
  return value;
}
