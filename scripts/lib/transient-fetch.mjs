// @code-analyzer — the three attempts a transient failure is worth, and no attempt for a permanent one

/**
 * **A 500 is not a 404, and the corpus paid for the difference twice.**
 *
 * The run of 2026-11-16 asked for 100 pull requests and read 98: two `.diff` requests came back `500` with **4 615 and
 * 4 486 requests left in the hour**, and the harness recorded them as pull requests the corpus could not supply. They
 * were not. A 500 with a budget left is a request that failed, and a request that failed is a request that is tried
 * again — while a 404 is a URL that is wrong and a 401 is a token that is absent, and **retrying those four times
 * spends the hour's budget to learn what the first response already said.**
 *
 * The cost of not having this: the denominator moved from 724 goldens to 715, the two arms of a comparison stopped being
 * comparable, and the only repair was another 2.5-hour dispatch. **A retry is cheaper than a dispatch by four orders of
 * magnitude, and it is the same code either way.**
 */
export const TRANSIENT_STATUSES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);

/** **Whether a status is worth another attempt.** A missing status is not: an exception is handled by its own branch. */
export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.includes(Number(status));
}

/**
 * **The waits, in order, capped rather than unbounded.**
 *
 * Doubling from `baseMs`, because the failures this exists for are a service under load and **a fixed interval is a
 * second request into the same overload.** The cap is the length of a CI step's patience rather than a rate-limit
 * window: a fetch that needs more than a few seconds is a fetch the run should record as lost and move on from, and a
 * run that waits two minutes for one diff has spent the corpus's budget on the pull request it could not read.
 */
export function retryDelays({ attempts = 4, baseMs = 400, capMs = 5_000 } = {}) {
  const delays = [];
  for (let i = 0; i < Math.max(0, attempts - 1); i += 1)
    delays.push(Math.min(baseMs * 2 ** i, capMs));
  return delays;
}

/**
 * **One attempt, retried while the answer says the failure is temporary.**
 *
 * `attempt` returns `{ ok: true, ... }` or `{ ok: false, reason, retryable? }`, and **the retryable flag is the
 * attempt's own judgement** rather than a status read here: a fetch that threw on a socket reads its own error, and a
 * caller that decided "5xx" for it would be turning a DNS failure into four DNS failures.
 *
 * **The last reason survives.** An attempt that failed four times is still an attempt that failed, and the sentence it
 * brings back is what the artifact records in `prsWithoutDiffReasons` — **so the reader can tell a service having a bad
 * minute from a corpus with a typo in it**, which is the distinction §38 established and this function must not lose.
 *
 * `sleep` is injected so a test can assert the schedule without waiting it.
 */
export async function withRetry(
  attempt,
  { attempts = 4, baseMs = 400, capMs = 5_000, sleep } = {},
) {
  const delays = retryDelays({ attempts, baseMs, capMs });
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last = { ok: false, reason: 'no attempt was made' };
  for (let i = 0; i <= delays.length; i += 1) {
    last = await attempt(i);
    if (last?.ok) return { ...last, attempts: i + 1 };
    if (last?.retryable !== true) return { ...last, attempts: i + 1 };
    if (i < delays.length) await wait(delays[i]);
  }
  return { ...last, attempts: delays.length + 1 };
}
