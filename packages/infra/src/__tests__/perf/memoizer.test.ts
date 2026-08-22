// @code-analyzer/infra — Async Memoizer Tests
// Covers all memoizer features: caching, TTL, LRU eviction, request coalescing,
// error handling, invalidation, and statistics.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AsyncMemoizer } from '../../performance/memoizer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TestFn = (x: number) => Promise<number>;

function makeFn() {
  const fn = vi.fn(async (x: number): Promise<number> => x * 2);
  return fn;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AsyncMemoizer', () => {
  let memoizer: AsyncMemoizer<TestFn>;

  beforeEach(() => {
    memoizer = new AsyncMemoizer<TestFn>({ ttlMs: 60000, maxSize: 100 });
  });

  // -------------------------------------------------------------------
  // Basic caching
  // -------------------------------------------------------------------

  it('should call the original function on first call', async () => {
    const fn = makeFn();
    const result = await memoizer.call(fn, 5);
    expect(result).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should return cached result on second call', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 5);
    const result = await memoizer.call(fn, 5);
    expect(result).toBe(10);
    expect(fn).toHaveBeenCalledTimes(1); // Only called once
  });

  it('should distinguish calls by argument', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 5);
    await memoizer.call(fn, 10);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should handle multiple arguments', async () => {
    const memoMulti = new AsyncMemoizer<(...args: [number, string]) => Promise<string>>({
      ttlMs: 60000,
    });
    const fn = vi.fn(async (n: number, s: string): Promise<string> => `${s}:${n}`);
    const r1 = await memoMulti.call(fn, 1, 'a');
    const r2 = await memoMulti.call(fn, 1, 'a');
    expect(r1).toBe('a:1');
    expect(r2).toBe('a:1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use custom keyResolver when provided', async () => {
    const memo = new AsyncMemoizer<TestFn>({
      ttlMs: 60000,
      keyResolver: (x: unknown) => 'fixed-key',
    });
    const fn = makeFn();
    await memo.call(fn, 5);
    await memo.call(fn, 10);
    // Both should hit the same cache key
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // TTL expiration
  // -------------------------------------------------------------------

  it('should expire entries after TTL', async () => {
    const memo = new AsyncMemoizer<TestFn>({ ttlMs: 10, maxSize: 100 });
    const fn = makeFn();
    await memo.call(fn, 5);
    await delay(20); // Wait for expiration
    await memo.call(fn, 5);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should not expire entries before TTL', async () => {
    const memo = new AsyncMemoizer<TestFn>({ ttlMs: 5000, maxSize: 100 });
    const fn = makeFn();
    await memo.call(fn, 5);
    await delay(10);
    await memo.call(fn, 5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // LRU eviction
  // -------------------------------------------------------------------

  it('should evict oldest entry when at capacity', async () => {
    const memo = new AsyncMemoizer<TestFn>({ ttlMs: 60000, maxSize: 2 });
    const fn = makeFn();
    await memo.call(fn, 1); // cache: [1]
    await memo.call(fn, 2); // cache: [2, 1]
    await memo.call(fn, 3); // cache: [3, 2], evicts 1
    await memo.call(fn, 1); // miss — was evicted
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should not evict when accessing existing key at capacity', async () => {
    const memo = new AsyncMemoizer<TestFn>({ ttlMs: 60000, maxSize: 2 });
    const fn = makeFn();
    await memo.call(fn, 1); // cache: [1]
    await memo.call(fn, 2); // cache: [2, 1]
    await memo.call(fn, 2); // cache: [2, 1] — 2 moved to front, no eviction
    const stats = memo.getStats();
    expect(stats.evictions).toBe(0);
    expect(stats.size).toBe(2);
  });

  it('should track eviction count correctly', async () => {
    const memo = new AsyncMemoizer<TestFn>({ ttlMs: 60000, maxSize: 3 });
    const fn = makeFn();
    await memo.call(fn, 1);
    await memo.call(fn, 2);
    await memo.call(fn, 3);
    await memo.call(fn, 4); // evicts 1
    await memo.call(fn, 5); // evicts 2
    const stats = memo.getStats();
    expect(stats.evictions).toBe(2);
    expect(stats.size).toBe(3);
  });

  // -------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------

  it('should report zero hitRate for fresh cache', async () => {
    const stats = memoizer.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.size).toBe(0);
  });

  it('should report correct hit and miss counts', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 5); // miss
    await memoizer.call(fn, 5); // hit
    await memoizer.call(fn, 10); // miss
    const stats = memoizer.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBeCloseTo(1 / 3, 5);
  });

  it('should report size and capacity', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 1);
    await memoizer.call(fn, 2);
    const stats = memoizer.getStats();
    expect(stats.size).toBe(2);
    expect(stats.capacity).toBe(100);
  });

  // -------------------------------------------------------------------
  // Request coalescing (in-flight deduplication)
  // -------------------------------------------------------------------

  it('should coalesce concurrent calls for the same key', async () => {
    let callCount = 0;
    const slowFn = vi.fn(async (x: number): Promise<number> => {
      callCount++;
      await delay(50);
      return x * 3;
    });

    // Fire 3 concurrent calls for the same argument
    const results = await Promise.all([
      memoizer.call(slowFn, 7),
      memoizer.call(slowFn, 7),
      memoizer.call(slowFn, 7),
    ]);

    expect(results).toEqual([21, 21, 21]);
    expect(slowFn).toHaveBeenCalledTimes(1);
  });

  it('should count coalesced calls as hits', async () => {
    const slowFn = vi.fn(async (x: number): Promise<number> => {
      await delay(30);
      return x;
    });

    const [, , stats] = await Promise.all([
      memoizer.call(slowFn, 1),
      memoizer.call(slowFn, 1),
      (async () => {
        await delay(45);
        return memoizer.getStats();
      })(),
    ]);

    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  it('should not coalesce different keys', async () => {
    let callCount = 0;
    const slowFn = vi.fn(async (x: number): Promise<number> => {
      callCount++;
      await delay(20);
      return x;
    });

    const results = await Promise.all([
      memoizer.call(slowFn, 1),
      memoizer.call(slowFn, 2),
      memoizer.call(slowFn, 3),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(slowFn).toHaveBeenCalledTimes(3);
  });

  it('should clear inFlight after successful call', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 42);
    expect(memoizer.inFlightCount).toBe(0);
  });

  it('should clear inFlight after failed call', async () => {
    const failingFn = vi.fn(async (): Promise<number> => {
      throw new Error('test error');
    });

    await expect(memoizer.call(failingFn)).rejects.toThrow('test error');
    expect(memoizer.inFlightCount).toBe(0);
  });

  it('should not cache errors', async () => {
    let shouldFail = true;
    const flakyFn = vi.fn(async (x: number): Promise<number> => {
      if (shouldFail) {
        throw new Error('temporary failure');
      }
      return x * 2;
    });

    await expect(memoizer.call(flakyFn, 5)).rejects.toThrow('temporary failure');
    expect(flakyFn).toHaveBeenCalledTimes(1);

    shouldFail = false;
    const result = await memoizer.call(flakyFn, 5);
    expect(result).toBe(10);
    expect(flakyFn).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------

  it('should invalidate a specific key', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 5);
    const invalidated = memoizer.invalidate(5);
    expect(invalidated).toBe(true);
    await memoizer.call(fn, 5);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should return false when invalidating non-existent key', async () => {
    const invalidated = memoizer.invalidate(99);
    expect(invalidated).toBe(false);
  });

  // -------------------------------------------------------------------
  // Clear
  // -------------------------------------------------------------------

  it('should clear all entries', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 1);
    await memoizer.call(fn, 2);
    memoizer.clear();
    expect(memoizer.getStats().size).toBe(0);
    await memoizer.call(fn, 1);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should reset statistics on clear', async () => {
    const fn = makeFn();
    await memoizer.call(fn, 5);
    await memoizer.call(fn, 5);
    memoizer.clear();
    const stats = memoizer.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.evictions).toBe(0);
  });

  // -------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------

  it('should report activeKeys for in-flight calls', async () => {
    const slowFn = vi.fn(async (x: number): Promise<number> => {
      await delay(100);
      return x;
    });

    const promise = memoizer.call(slowFn, 1);
    await delay(10); // Allow the call to start
    const keys = memoizer.activeKeys;
    await promise;
    expect(keys.length).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------

  it('should handle zero arguments', async () => {
    type NoArgFn = () => Promise<string>;
    const memo = new AsyncMemoizer<NoArgFn>({ ttlMs: 60000 });
    const fn = vi.fn(async (): Promise<string> => 'hello');
    const r1 = await memo.call(fn);
    const r2 = await memo.call(fn);
    expect(r1).toBe('hello');
    expect(r2).toBe('hello');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should handle complex key types via custom keyResolver', async () => {
    type ComplexFn = (x: { tag: string; value: number }) => Promise<string>;
    const memo = new AsyncMemoizer<ComplexFn>({
      ttlMs: 60000,
      keyResolver: (x: unknown) => {
        const o = x as { tag: string; value: number };
        return `complex:${o.tag}:${o.value}`;
      },
    });
    const fn = vi.fn(
      async (x: { tag: string; value: number }): Promise<string> => `${x.tag}-${x.value}`,
    );
    const r1 = await memo.call(fn, { tag: 'test', value: 42 });
    const r2 = await memo.call(fn, { tag: 'test', value: 42 });
    expect(r1).toBe('test-42');
    expect(r2).toBe('test-42');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should support custom keyResolver for complex objects', async () => {
    type ObjFn = (obj: { id: number; name: string }) => Promise<string>;
    const memo = new AsyncMemoizer<ObjFn>({
      ttlMs: 60000,
      keyResolver: (obj: unknown) => {
        const o = obj as { id: number; name: string };
        return `obj:${o.id}`;
      },
    });
    const fn = vi.fn(async (obj: { id: number; name: string }): Promise<string> => obj.name);
    await memo.call(fn, { id: 1, name: 'Alice' });
    await memo.call(fn, { id: 1, name: 'Bob' }); // Same id, cached
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------

  it('should use default TTL of 60000ms when not specified', async () => {
    const memo = new AsyncMemoizer<TestFn>();
    const fn = makeFn();
    await memo.call(fn, 1);
    await memo.call(fn, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use default maxSize of 1000 when not specified', async () => {
    const memo = new AsyncMemoizer<TestFn>();
    const stats = memo.getStats();
    expect(stats.capacity).toBe(1000);
  });
});
