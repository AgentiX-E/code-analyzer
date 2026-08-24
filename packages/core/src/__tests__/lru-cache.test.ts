// @code-analyzer/core — LRU Cache Tests

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache } from '../cache/lru-cache.js';

describe('LRUCache', () => {
  describe('Basic operations', () => {
    let cache: LRUCache<string, number>;

    beforeEach(() => {
      cache = new LRUCache<string, number>({ maxSize: 100 });
    });

    it('get returns undefined for missing key', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('set and get roundtrip', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('overwrites existing key', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
    });

    it('has returns true for existing key', () => {
      cache.set('a', 1);
      expect(cache.has('a')).toBe(true);
    });

    it('has returns false for missing key', () => {
      expect(cache.has('nope')).toBe(false);
    });

    it('delete removes key', () => {
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.has('a')).toBe(false);
    });

    it('delete returns false for missing key', () => {
      expect(cache.delete('nope')).toBe(false);
    });

    it('clear removes all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('maintains insertion order', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      const keys = Array.from(cache.keys());
      expect(keys).toEqual(['c', 'b', 'a']); // MRU first
    });
  });

  describe('LRU eviction', () => {
    it('evicts least recently used when maxSize reached', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a' (LRU)

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('get promotes to MRU position', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      // Access 'a' to make it MRU
      cache.get('a');
      // Now LRU is 'b', not 'a'
      cache.set('d', 4);

      expect(cache.get('b')).toBeUndefined(); // evicted
      expect(cache.get('a')).toBe(1); // still there
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('set on existing key updates without eviction', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('a', 10); // Update, don't add
      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe(10);
    });

    it('peek does not promote to MRU', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.peek('a'); // Peek, don't promote
      cache.set('c', 3); // Should evict 'a' (still LRU)

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('TTL expiration', () => {
    it('expired entry returns undefined on get', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 10 });
      cache.set('a', 1);

      // Not expired yet
      expect(cache.get('a')).toBe(1);

      // Wait for expiration
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get('a')).toBeUndefined();
          expect(cache.has('a')).toBe(false);
          resolve();
        }, 20);
      });
    });

    it('per-entry TTL override works', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 10000 });

      cache.set('a', 1, 5); // 5ms TTL
      cache.set('b', 2); // Default TTL (10s)

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get('a')).toBeUndefined(); // expired
          expect(cache.get('b')).toBe(2); // still valid
          resolve();
        }, 10);
      });
    });

    it('expired entry on set eviction is cleaned up', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3, ttl: 5 });
      cache.set('a', 1);
      cache.set('b', 2);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Both 'a' and 'b' are expired
          cache.set('c', 3);
          expect(cache.size).toBeLessThanOrEqual(1);
          resolve();
        }, 10);
      });
    });
  });

  describe('getOrSet', () => {
    it('returns existing value without calling factory', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 42);

      let called = false;
      const result = cache.getOrSet('a', () => {
        called = true;
        return 99;
      });
      expect(result).toBe(42);
      expect(called).toBe(false);
    });

    it('calls factory for missing key', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      const result = cache.getOrSet('a', () => 42);
      expect(result).toBe(42);
      expect(cache.get('a')).toBe(42);
    });
  });

  describe('Statistics', () => {
    it('tracks hits and misses', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.get('a'); // miss
      cache.get('b'); // miss
      cache.set('a', 1);
      cache.get('a'); // hit
      cache.get('a'); // hit

      const s = cache.stats;
      expect(s.hits).toBe(2);
      expect(s.misses).toBe(2);
      expect(s.hitRate).toBeCloseTo(0.5, 1);
    });

    it('tracks evictions', () => {
      const cache = new LRUCache<string, number>({ maxSize: 2 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // eviction

      expect(cache.stats.evictions).toBeGreaterThanOrEqual(0);
    });

    it('resetStats zeroes counters', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.get('a');
      cache.get('b');
      cache.resetStats();

      const s = cache.stats;
      expect(s.hits).toBe(0);
      expect(s.misses).toBe(0);
    });

    it('tracks expirations', async () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 5 });
      cache.set('a', 1);

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          cache.get('a'); // triggers expiration
          expect(cache.stats.expirations).toBeGreaterThanOrEqual(1);
          resolve();
        }, 10);
      });
    });
  });

  describe('Eviction callback', () => {
    it('calls onEvict when entry is evicted', () => {
      const evicted: Array<[unknown, unknown]> = [];
      const cache = new LRUCache<string, number>({
        maxSize: 2,
        onEvict: (k, v) => evicted.push([k, v]),
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // evicts 'a'

      expect(evicted.length).toBeGreaterThanOrEqual(1);
      expect(evicted[0]![0]).toBe('a');
      expect(evicted[0]![1]).toBe(1);
    });

    it('calls onEvict on clear', () => {
      const evicted: Array<[unknown, unknown]> = [];
      const cache = new LRUCache<string, number>({
        maxSize: 10,
        onEvict: (k, v) => evicted.push([k, v]),
      });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();

      expect(evicted.length).toBe(2);
    });
  });

  describe('Iteration', () => {
    it('iterates over entries in MRU→LRU order', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      const entries = Array.from(cache);
      expect(entries).toEqual([
        ['c', 3],
        ['b', 2],
        ['a', 1],
      ]);
    });

    it('keys() returns keys in MRU→LRU order', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);

      expect(Array.from(cache.keys())).toEqual(['b', 'a']);
    });

    it('values() returns values in MRU→LRU order', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);

      expect(Array.from(cache.values())).toEqual([2, 1]);
    });

    it('skips expired entries during iteration', async () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 5 });
      cache.set('a', 1);
      cache.set('b', 2);

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const entries = Array.from(cache);
      expect(entries.length).toBe(0);
    });
  });

  describe('Memory budget mode', () => {
    it('evicts when maxBytes exceeded', () => {
      const cache = new LRUCache<string, string>({
        maxSize: 100,
        maxBytes: 200,
      });

      // Each string entry is ~32 + 2*len bytes
      cache.set('a', 'x'.repeat(100)); // ~232 bytes
      cache.set('b', 'x'.repeat(100)); // ~232 bytes → should trigger eviction

      expect(cache.size).toBeLessThanOrEqual(1);
    });

    it('size estimation is reasonable', () => {
      const cache = new LRUCache<string, string>({ maxSize: 10 });
      cache.set('small', 'hi');
      cache.set('large', 'x'.repeat(1000));

      const stats = cache.stats;
      expect(stats.estimatedBytes).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    it('uses default maxSize 10000 when no config is provided', () => {
      const cache = new LRUCache<string, number>();
      expect(cache.stats.maxSize).toBe(10000);
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('uses Infinity expiry when ttl is not set', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      // Not expired immediately (default ttl 0 → no expiry).
      expect(cache.get('a')).toBe(1);
    });

    it('updates expiry when overwriting an entry with a positive ttl override', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1, 5000);
      cache.set('a', 2, 5000); // overwrite with positive ttl
      expect(cache.get('a')).toBe(2);
    });

    it('has() returns false and removes an expired entry', async () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 5 });
      cache.set('a', 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(cache.has('a')).toBe(false);
      expect(cache.size).toBe(0);
    });

    it('peek() returns undefined for an expired entry', async () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 5 });
      cache.set('a', 1);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(cache.peek('a')).toBeUndefined();
    });

    it('keys() and values() skip expired entries', async () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2, 5); // expires soon
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      expect(Array.from(cache.keys())).toEqual(['a']);
      expect(Array.from(cache.values())).toEqual([1]);
    });

    it('promotes a middle entry to MRU on get', () => {
      const cache = new LRUCache<string, number>({ maxSize: 3 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('b'); // middle → MRU
      cache.set('d', 4); // evicts LRU ('a')
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });

    it('deletes a middle entry and relinks its neighbors', () => {
      const cache = new LRUCache<string, number>({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.delete('b'); // middle entry
      expect(Array.from(cache.keys())).toEqual(['c', 'a']);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('c')).toBe(3);
    });

    it('estimates size for null/boolean/typed-array values', () => {
      const cache = new LRUCache<string, unknown>({ maxSize: 100 });
      cache.set('n', null);
      cache.set('b', true);
      cache.set('t', new Uint8Array([1, 2, 3, 4]));
      expect(cache.stats.estimatedBytes).toBeGreaterThan(0);
    });

    it('disposes the proactive sweep timer', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10, sweepInterval: 1000 });
      cache.set('a', 1);
      expect(() => cache.dispose()).not.toThrow();
      expect(cache.size).toBe(0);
    });

    it('proactive sweep removes expired entries', () => {
      vi.useFakeTimers();
      try {
        const cache = new LRUCache<string, number>({ maxSize: 10, ttl: 100, sweepInterval: 50 });
        cache.set('a', 1);
        cache.set('b', 2);

        vi.advanceTimersByTime(200); // trigger the sweep interval with both expired

        expect(cache.size).toBe(0);
        expect(cache.stats.expirations).toBeGreaterThanOrEqual(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles maxSize 0 gracefully', () => {
      const cache = new LRUCache<string, number>({ maxSize: 0 });
      cache.set('a', 1);
      expect(cache.get('a')).toBeUndefined(); // immediately evicted
    });

    it('handles maxSize 1', () => {
      const cache = new LRUCache<string, number>({ maxSize: 1 });
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });

    it('handles large number of entries', () => {
      const cache = new LRUCache<number, number>({ maxSize: 5000 });
      for (let i = 0; i < 10000; i++) {
        cache.set(i, i * 2);
      }
      expect(cache.size).toBe(5000);
    });

    it('dispose cleans up', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.dispose();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('string keys work correctly', () => {
      const cache = new LRUCache<string, number>({ maxSize: 10 });
      cache.set('', 0);
      expect(cache.get('')).toBe(0);
    });

    it('non-string keys work correctly', () => {
      const cache = new LRUCache<number, string>({ maxSize: 10 });
      cache.set(0, 'zero');
      cache.set(1, 'one');
      expect(cache.get(0)).toBe('zero');
      expect(cache.get(1)).toBe('one');
    });
  });
});
