import { describe, expect, it } from 'vitest';

import {
  isTransientStatus,
  retryDelays,
  withRetry,
  type AttemptResult,
} from '../../../scripts/lib/transient-fetch.mjs';

/**
 * **The run of 2026-11-16 read 98 of the 100 pull requests it asked for.**
 *
 * Two `.diff` requests returned `500` with 4 615 and 4 486 requests left in the hour, and the harness recorded them as
 * pull requests the corpus could not supply. The denominator moved from 724 goldens to 715, two runs that were meant to
 * be one experiment stopped being comparable, and the only repair was another dispatch. **Nothing in these two failures
 * was permanent** — a service returned an error on one request and had budget for a thousand more.
 *
 * So the file asserts the two things that make a retry honest rather than decorative: **it happens for the statuses
 * that are worth it and not for the ones that are not**, and **the reason survives the attempts** so an artifact can
 * still say which of the three causes it was.
 */
describe('a diff that failed once is not a pull request that does not exist', () => {
  it('retries a 500 and not a 404', () => {
    expect(isTransientStatus(500)).toBe(true);
    expect(isTransientStatus(502)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(504)).toBe(true);
    expect(isTransientStatus(429)).toBe(true);
    expect(isTransientStatus(408)).toBe(true);

    expect(isTransientStatus(404)).toBe(false);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(403)).toBe(false);
    expect(isTransientStatus(422)).toBe(false);
    // **A string, because the status arrives from a header or a `Response` and either can be either.**
    expect(isTransientStatus('500')).toBe(true);
    expect(isTransientStatus(undefined)).toBe(false);
  });

  it('waits longer each time, and stops waiting at all', () => {
    expect(retryDelays({ attempts: 4, baseMs: 400, capMs: 5_000 })).toEqual([400, 800, 1600]);
    expect(retryDelays({ attempts: 1 })).toEqual([]);
    expect(retryDelays({ attempts: 0 })).toEqual([]);
    // **The cap is the step's patience**, so a long schedule is three waits rather than a minute of them.
    expect(retryDelays({ attempts: 6, baseMs: 400, capMs: 1_000 })).toEqual([
      400, 800, 1_000, 1_000, 1_000,
    ]);
  });

  it('succeeds on the second attempt when the first one failed temporarily', async () => {
    const waits: number[] = [];
    // **The answers are typed as what the retry loop is promised**, because a `calls++` index is `undefined`-able and the
    // failure mode of an exhausted list is a test that reads `undefined.ok` rather than a test that says the third
    // attempt was never made.
    const answers: AttemptResult[] = [
      {
        ok: false,
        reason: 'the diff request returned 500 with 4615 requests left in the hour',
        retryable: true,
      },
      { ok: true, diff: 'diff --git a/x b/x' },
    ];
    let calls = 0;
    const result = await withRetry(
      () =>
        answers[calls++] ?? {
          ok: false,
          reason: 'the fixture ran out of answers',
          retryable: false,
        },
      { attempts: 4, baseMs: 400, sleep: async (ms) => void waits.push(ms) },
    );

    expect(result.ok).toBe(true);
    // **Through the index signature the value actually arrives on**, which is the declaration's honest shape: an attempt
    // carries `ok`, its reason and whatever value the caller's own success puts beside them.
    expect(result['diff']).toBe('diff --git a/x b/x');
    expect(result.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(waits).toEqual([400]);
  });

  it('does not spend the hour on a failure the first answer already explained', async () => {
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return { ok: false, reason: 'the diff request returned 404', retryable: false };
      },
      { attempts: 4, sleep: async () => {} },
    );

    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.reason).toContain('404');
  });

  it('keeps the reason from the last attempt, because a lost pull request still has to say why', async () => {
    const reasons = ['returned 500', 'returned 502', 'returned 503', 'returned 504'];
    let calls = 0;
    const result = await withRetry(
      () => ({ ok: false, reason: `the diff request ${reasons[calls++]}`, retryable: true }),
      { attempts: 4, sleep: async () => {} },
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(4);
    expect(result.reason).toBe('the diff request returned 504');
  });

  it('treats an attempt that says nothing about retrying as final', async () => {
    // **An attempt that did not label its failure has not earned four of them.** The socket failures and the corpus
    // URLs each know which they are; a default of "retry" would turn a typo into four attempts.
    let calls = 0;
    const result = await withRetry(
      () => {
        calls += 1;
        return { ok: false, reason: 'threw' };
      },
      { attempts: 4, sleep: async () => {} },
    );

    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
  });

  it('is bounded even when the attempt never stops failing', async () => {
    let calls = 0;
    const waits: number[] = [];
    await withRetry(
      () => {
        calls += 1;
        return { ok: false, reason: 'still 500', retryable: true };
      },
      { attempts: 4, baseMs: 1, sleep: async (ms) => void waits.push(ms) },
    );

    expect(calls).toBe(4);
    expect(waits).toEqual([1, 2, 4]);
  });
});
