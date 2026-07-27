// @code-analyzer/shared — LRU Cache Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from '../utils/lru-cache.js';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(5);
  });

  describe('constructor', () => {
    it('should create a cache with given capacity', () => {
      expect(cache.capacity).toBe(5);
      expect(cache.size).toBe(0);
    });

    it('should throw for non-positive capacity', () => {
      expect(() => new LRUCache(0)).toThrow('> 0');
      expect(() => new LRUCache(-1)).toThrow('> 0');
    });

    it('should default to capacity 1000', () => {
      const defaultCache = new LRUCache();
      expect(defaultCache.capacity).toBe(1000);
    });
  });

  describe('get/set', () => {
    it('should return undefined for missing key', () => {
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should store and retrieve a value', () => {
      cache.set('a', 1);
      expect(cache.get('a')).toBe(1);
    });

    it('should update existing value', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      expect(cache.get('a')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should evict least recently used when at capacity', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5); // full
      cache.set('f', 6); // evicts 'a'

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('f')).toBe(6);
      expect(cache.size).toBe(5);
    });

    it('should keep frequently accessed items', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);

      // Access 'a' multiple times
      cache.get('a');
      cache.get('a');

      cache.set('f', 6); // should evict 'b', not 'a'
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return false for missing key', () => {
      expect(cache.has('x')).toBe(false);
    });

    it('should return true for existing key', () => {
      cache.set('x', 42);
      expect(cache.has('x')).toBe(true);
    });

    it('should not affect LRU ordering', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);
      cache.set('e', 5);
      cache.has('a'); // does not promote 'a'
      cache.set('f', 6); // evicts 'a' since has() doesn't promote
      expect(cache.get('a')).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should remove existing key', () => {
      cache.set('a', 1);
      expect(cache.delete('a')).toBe(true);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should return false for missing key', () => {
      expect(cache.delete('missing')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
    });

    it('should reset stats', () => {
      cache.set('a', 1);
      cache.get('a');
      cache.clear();
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(0);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value if present', () => {
      cache.set('a', 1);
      const value = cache.getOrSet('a', () => 99);
      expect(value).toBe(1);
    });

    it('should compute and cache if missing', () => {
      let computeCount = 0;
      const value = cache.getOrSet('a', () => {
        computeCount++;
        return 42;
      });
      expect(value).toBe(42);
      expect(computeCount).toBe(1);

      // Second call should use cache
      const value2 = cache.getOrSet('a', () => 99);
      expect(value2).toBe(42);
      expect(computeCount).toBe(1);
    });
  });

  describe('stats', () => {
    it('should track hits and misses', () => {
      cache.get('a'); // miss
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.hits).toBe(0);

      cache.set('a', 1);
      cache.get('a'); // hit
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.hits).toBe(1);
    });

    it('should track evictions', () => {
      for (let i = 0; i < 10; i++) {
        cache.set(`k${i}`, i);
      }
      expect(cache.stats.evictions).toBe(5);
    });

    it('should compute hit rate', () => {
      expect(cache.hitRate).toBe(0);
      cache.set('a', 1);
      cache.get('a');
      expect(cache.hitRate).toBe(1);
    });
  });

  describe('iteration', () => {
    it('should iterate from most to least recently used', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // move 'a' to MRU

      const entries = [...cache];
      expect(entries).toEqual([
        ['a', 1],
        ['c', 3],
        ['b', 2],
      ]);
    });

    it('keys() should return MRU-to-LRU order', () => {
      cache.set('first', 1);
      cache.set('second', 2);
      cache.set('third', 3);
      cache.get('first');
      expect(cache.keys()).toEqual(['first', 'third', 'second']);
    });

    it('values() should return MRU-to-LRU order', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.values()).toEqual([2, 1]);
    });
  });

  describe('edge cases', () => {
    it('should handle capacity of 1', () => {
      const tiny = new LRUCache<string, string>(1);
      tiny.set('a', 'first');
      expect(tiny.get('a')).toBe('first');
      tiny.set('b', 'second');
      expect(tiny.get('a')).toBeUndefined();
      expect(tiny.get('b')).toBe('second');
    });

    it('should handle many entries efficiently', () => {
      const big = new LRUCache<number, string>(100);
      for (let i = 0; i < 200; i++) {
        big.set(i, `val${i}`);
      }
      expect(big.size).toBe(100);
      // First 100 entries should be evicted
      expect(big.get(0)).toBeUndefined();
      expect(big.get(199)).toBe('val199');
    });

    it('should handle string keys with special characters', () => {
      cache.set('key/with/slashes', 1);
      cache.set('key with spaces', 2);
      cache.set('日本語', 3);
      expect(cache.get('key/with/slashes')).toBe(1);
      expect(cache.get('日本語')).toBe(3);
    });
  });
});
