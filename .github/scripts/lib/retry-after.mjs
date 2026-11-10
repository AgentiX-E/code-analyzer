// **How long to wait before asking a model the same question again.**
//
// The judge of the AACR benchmark retried three times with waits of one, two and three seconds and ignored the
// `Retry-After` header entirely. **The run of 2026-11-09 left 183 pairs unanswered out of roughly 3 800**, and a pair
// that goes unanswered is scored as a miss - so **a rate limit silently became a recall figure**, in one arm and not the
// other, because the arm with more calls hit the limit more often.
//
// **Waiting the wrong amount is the whole defect**, and it has two halves that fail differently:
//
//   1. **Too short.** Three retries inside six seconds is three retries inside one rate-limit window: the same request,
//      refused three times, and the third refusal is recorded as the model having nothing to say.
//   2. **A header read as the wrong unit.** `Retry-After` is either a number of seconds or an HTTP date, and both appear
//      in the wild. Reading `Retry-After: 30` as 30 milliseconds is a retry storm; reading a date as `NaN` is no wait
//      at all.
//
// **So this is arithmetic with a test beside it rather than a `setTimeout` in a catch block**, which is where it was.

/**
 * **The wait a `Retry-After` header asks for, in milliseconds - or `null` when it asks for nothing legible.**
 *
 * `now` is passed in rather than read, because **a function that reads the clock cannot be tested on the day a date
 * crosses a leap second** and because a test that has to wait thirty seconds is a test nobody runs.
 */
export function retryAfterMs(header, now = Date.now()) {
  const text = String(header ?? '').trim();
  if (text === '') return null;
  // **Delta-seconds first**, because that is what rate limiters actually send and because `Number('30')` would otherwise
  // have to be excluded by hand from the date branch below.
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    // A zero is a legitimate instruction - "you may retry now" - and is not the same as an absent header.
    return Math.max(0, seconds) * 1000;
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  // **A date in the past means "now", not a negative sleep**, which would return immediately and read as a retry storm.
  return Math.max(0, at - now);
}

/**
 * **The exponential wait when no header says otherwise.**
 *
 * `attempt` is zero-based. The base doubles and is capped, and **the cap matters more than the curve**: a corpus of a
 * thousand pairs that all hit a limit must still finish, and an uncapped doubling reaches a day at attempt seventeen.
 *
 * **`jitter` is a parameter rather than `Math.random()` inside**, so the same reasoning as `now` applies: a test can
 * assert the shape of the schedule instead of the shape of a random number. Callers pass a jittered value; the default
 * of zero makes the schedule exact.
 */
export function backoffMs(attempt, { baseMs = 1000, capMs = 30_000, jitter = 0 } = {}) {
  const step = Math.max(0, Math.floor(Number(attempt) || 0));
  const raw = Math.min(capMs, baseMs * 2 ** step);
  if (!jitter) return raw;
  // **Jitter downwards rather than symmetrically**, so a retry never waits longer than the cap it was given.
  return Math.max(0, Math.round(raw - raw * Math.min(1, Math.max(0, jitter)) * 0.5));
}

/**
 * **When to give up, stated as a number of attempts rather than as a feeling about patience.**
 *
 * Six attempts with the capped schedule above is a little over a minute of waiting for one pair. **A pair that has not
 * been answered in a minute is a fact about the run and belongs in the artifact**; three attempts inside six seconds was
 * a fact about the retry policy being counted as a fact about the reviewer.
 */
export const DEFAULT_ATTEMPTS = 6;
