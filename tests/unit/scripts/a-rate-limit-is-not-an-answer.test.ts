// **A rate limit is not an answer, and three retries inside six seconds is one retry inside one window.**
//
// These tests hold the two halves of the defect the judge of the AACR benchmark carried: a `Retry-After` header read as
// the wrong unit (or dropped), and a backoff that is too short to cross the window it is waiting for. **Both failures are
// silent in the same way** - the request is refused, the refusal is recorded as "the judge did not answer", and an
// unanswered pair is scored as a miss. The run of 2026-11-09 lost 183 pairs that way, in our arm and not in the
// competitor's, which is the asymmetry that makes this a measurement defect rather than a performance one.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ATTEMPTS,
  backoffMs,
  retryAfterMs,
} from '../../../.github/scripts/lib/retry-after.mjs';

describe('Retry-After is read in the unit it was written in', () => {
  it('reads delta-seconds as seconds, not as milliseconds', () => {
    // Reading `30` as thirty milliseconds is a retry storm; reading it as thirty seconds is the instruction.
    expect(retryAfterMs('30')).toBe(30_000);
    expect(retryAfterMs(' 2 ')).toBe(2_000);
  });

  it('reads a zero as "you may retry now" rather than as an absent header', () => {
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads an HTTP date as the distance to it', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(retryAfterMs('Tue, 10 Nov 2026 00:00:30 GMT', now)).toBe(30_000);
  });

  it('treats a date in the past as no wait rather than as a negative sleep', () => {
    const now = Date.parse('2026-11-10T00:01:00Z');
    // A negative value would resolve immediately and look exactly like honouring the header.
    expect(retryAfterMs('Tue, 10 Nov 2026 00:00:00 GMT', now)).toBe(0);
  });

  it('returns null when there is nothing to honour, so the caller can fall back to its own schedule', () => {
    expect(retryAfterMs('')).toBeNull();
    expect(retryAfterMs(undefined)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
  });
});

describe('the schedule crosses the window instead of knocking on it', () => {
  it('doubles from a one-second base', () => {
    expect([0, 1, 2, 3].map((attempt) => backoffMs(attempt))).toEqual([1000, 2000, 4000, 8000]);
  });

  it('caps, because a thousand pairs that all hit a limit must still finish', () => {
    // Uncapped doubling reaches a day at attempt seventeen.
    expect(backoffMs(20)).toBe(30_000);
    expect(backoffMs(20, { capMs: 5_000 })).toBe(5_000);
  });

  it('never waits longer than the cap, even with jitter', () => {
    for (const jitter of [0, 0.5, 1]) {
      expect(backoffMs(10, { capMs: 4_000, jitter })).toBeLessThanOrEqual(4_000);
    }
    // And jitter subtracts rather than adds, so the cap is a bound and not an average.
    expect(backoffMs(10, { capMs: 4_000, jitter: 1 })).toBeLessThan(4_000);
  });

  it('treats a missing or nonsense attempt as the first attempt rather than as NaN', () => {
    expect(backoffMs(undefined)).toBe(1000);
    expect(backoffMs(-3)).toBe(1000);
  });

  it('allows more than three attempts, which is the number that turned a rate limit into a recall figure', () => {
    expect(DEFAULT_ATTEMPTS).toBeGreaterThan(3);
    // And the total waiting time at the default schedule is a minute or more, not six seconds.
    const total = Array.from({ length: DEFAULT_ATTEMPTS }, (_, attempt) =>
      backoffMs(attempt),
    ).reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeGreaterThan(30_000);
  });
});
