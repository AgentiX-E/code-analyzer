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
export function spendCeilingUsd({ pullRequests, mode, override }) {
  const explicit = Number(override);
  if (override !== undefined && override !== null && String(override).trim() !== '' && Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const key = mode === 'record' ? 'record' : 'replay';
  const scaled = CEILING_USD_PER_PULL_REQUEST[key] * requestedPullRequests(pullRequests);
  return Math.max(CEILING_USD_FLOOR[key], Math.round(scaled * 100) / 100);
}
