// `mapWithConcurrency` is the reason a wider ladder is affordable, so its two promises - results in input order, and no
// work started after a failure - are tested rather than assumed. **The order test is the one that matters**: a version
// that collected completions as they settled would pass every other test here and silently permute a measurement.

import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../utils/concurrency.js';

/** A promise that resolves after `ms`, so completion order can be made the opposite of input order. */
const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('mapWithConcurrency', () => {
  it('returns results in input order even when the work finishes in reverse', async () => {
    const items = [40, 30, 20, 10];
    const results = await mapWithConcurrency(items, 4, (ms) => after(ms, ms));
    expect(results).toEqual([40, 30, 20, 10]);
  });

  it('passes each item its own position', async () => {
    const seen: Array<[string, number]> = [];
    await mapWithConcurrency(['a', 'b', 'c'], 2, async (item, index) => {
      seen.push([item, index]);
      return index;
    });
    expect(seen.sort((left, right) => left[1] - right[1])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('runs exactly one item at a time when the limit is one', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5], 1, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await after(1, null);
      inFlight -= 1;
      return item;
    });
    expect(peak).toBe(1);
  });

  it('never exceeds the limit it was given', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      5,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await after(1, null);
        inFlight -= 1;
        return item;
      },
    );
    expect(peak).toBe(5);
  });

  it('starts every item at once when the limit is wider than the list', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3], 10, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await after(2, null);
      inFlight -= 1;
      return item;
    });
    expect(peak).toBe(3);
  });

  it('returns an empty array and calls nothing for an empty list', async () => {
    let calls = 0;
    const results = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return null;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a limit of %s instead of falling back to serial',
    async (limit) => {
      let calls = 0;
      await expect(
        mapWithConcurrency([1, 2], limit, async () => {
          calls += 1;
          return null;
        }),
      ).rejects.toThrow(RangeError);
      // **Nothing was started**, so the cost of the mistake is the throw and not a run.
      expect(calls).toBe(0);
    },
  );

  it('stops starting new work after a failure, and reports the first error', async () => {
    const started: number[] = [];
    const run = async (item: number): Promise<number> => {
      started.push(item);
      // **Item 1 fails immediately while item 0 is still open**, which is the case a naive `Promise.all` over a
      // pre-built array of promises cannot produce: it would have started every item before the first rejection.
      if (item === 1) throw new Error(`item ${item} failed`);
      await after(5, null);
      return item;
    };

    await expect(mapWithConcurrency([0, 1, 2, 3, 4], 1, run)).rejects.toThrow('item 1 failed');
    // Serial: 0 ran, 1 failed, and 2..4 never started.
    expect(started).toEqual([0, 1]);
  });

  it('lets the items already in flight finish before throwing', async () => {
    const settled: number[] = [];
    const run = async (item: number): Promise<number> => {
      if (item === 0) throw new Error('first');
      await after(10, null);
      settled.push(item);
      return item;
    };

    await expect(mapWithConcurrency([0, 1, 2, 3], 3, run)).rejects.toThrow('first');
    // **Items 1 and 2 were in flight when 0 failed and are not abandoned**: a caller that returned early would report
    // a bill it had not finished paying.
    expect(settled.sort((left, right) => left - right)).toEqual([1, 2]);
  });

  it('keeps the first failure when a second worker fails too, and starts nothing further', async () => {
    // **Two workers, two failures.** The first sets the flag; the second finds it set and must not overwrite the message
    // - a caller reading "item 1 failed" when item 0 failed first is reading the consequence instead of the cause. The
    // remaining two items are never started, which is the branch a single-worker test cannot reach.
    const started: number[] = [];
    const run = async (item: number): Promise<number> => {
      started.push(item);
      // Item 0 fails first; item 1 fails five milliseconds later, while the queue is already stopped.
      await after(item === 0 ? 0 : 5, null);
      if (item <= 1) throw new Error(`item ${item} failed`);
      return item;
    };

    await expect(mapWithConcurrency([0, 1, 2, 3], 2, run)).rejects.toThrow('item 0 failed');
    expect(started.sort((left, right) => left - right)).toEqual([0, 1]);
  });

  it('rethrows a non-Error value unchanged', async () => {
    await expect(
      mapWithConcurrency([1], 1, async () => {
        // **A rejected `fetch` can throw a string**, and rewriting it as an `Error` here would hide exactly the case
        // this test is about: the caller has to see what the callee threw.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'a string, not an Error';
      }),
    ).rejects.toBe('a string, not an Error');
  });

  it('handles a thousand items without exhausting the stack', async () => {
    const items = Array.from({ length: 1000 }, (_, index) => index);
    const results = await mapWithConcurrency(items, 8, async (item) => item * 2);
    expect(results).toHaveLength(1000);
    expect(results[999]).toBe(1998);
  });
});
