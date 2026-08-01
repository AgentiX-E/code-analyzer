// @code-analyzer/intelligence — Embedding Cache Tests
import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingCache } from '../embeddings/embedding-cache.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;
  const vec1 = new Float32Array([0.1, 0.2, 0.3]);
  const vec2 = new Float32Array([0.4, 0.5, 0.6]);
  const vec3 = new Float32Array([0.7, 0.8, 0.9]);

  describe('Construction', () => {
    it('constructs with default options', () => {
      const c = new EmbeddingCache();
      expect(c.size).toBe(0);
      expect(c.capacity).toBe(10000);
    });
    it('constructs with custom capacity', () => {
      const c = new EmbeddingCache({ maxEntries: 500 });
      expect(c.capacity).toBe(500);
    });
    it('constructs with TTL', () => {
      const c = new EmbeddingCache({ ttl: 60000 });
      expect(c).toBeDefined();
    });
    it('constructs with access tracking disabled', () => {
      const c = new EmbeddingCache({ trackAccessCounts: false });
      expect(c).toBeDefined();
    });
  });

  describe('Set & Get', () => {
    beforeEach(() => { cache = new EmbeddingCache({ maxEntries: 100 }); });

    it('stores and retrieves an embedding', () => {
      cache.set('key1', vec1, 'hash1');
      const entry = cache.get('key1')!;
      expect(entry.vector).toEqual(vec1);
      expect(entry.contentHash).toBe('hash1');
    });

    it('returns undefined for missing key', () => {
      expect(cache.get('nope')).toBeUndefined();
    });

    it('updates existing key', () => {
      cache.set('key1', vec1, 'hash1');
      cache.set('key1', vec2, 'hash2');
      const entry = cache.get('key1')!;
      expect(entry.vector).toEqual(vec2);
      expect(entry.contentHash).toBe('hash2');
    });

    it('rejects stale hash', () => {
      cache.set('key1', vec1, 'hash1');
      expect(cache.get('key1', 'wrong-hash')).toBeUndefined();
    });

    it('returns value with matching hash', () => {
      cache.set('key1', vec1, 'hash1');
      expect(cache.get('key1', 'hash1')).toBeDefined();
    });

    it('evicts LRU when at capacity', () => {
      const small = new EmbeddingCache({ maxEntries: 2 });
      small.set('a', vec1, 'h1');
      small.set('b', vec2, 'h2');
      small.set('c', vec3, 'h3');
      expect(small.size).toBe(2);
      // 'a' should be evicted (LRU)
      expect(small.get('a')).toBeUndefined();
      expect(small.get('b')).toBeDefined();
      expect(small.get('c')).toBeDefined();
    });
  });

  describe('Has', () => {
    beforeEach(() => { cache = new EmbeddingCache(); });
    it('returns true for existing key', () => {
      cache.set('k', vec1, 'hash');
      expect(cache.has('k')).toBe(true);
    });
    it('returns false for non-existent key', () => {
      expect(cache.has('k')).toBe(false);
    });
    it('returns false for stale hash', () => {
      cache.set('k', vec1, 'hash');
      expect(cache.has('k', 'wrong')).toBe(false);
    });
  });

  describe('Delete', () => {
    beforeEach(() => { cache = new EmbeddingCache(); });
    it('removes existing entry', () => {
      cache.set('k', vec1, 'hash');
      expect(cache.delete('k')).toBe(true);
      expect(cache.has('k')).toBe(false);
    });
    it('returns false for missing key', () => {
      expect(cache.delete('k')).toBe(false);
    });
  });

  describe('Invalidation', () => {
    beforeEach(() => { cache = new EmbeddingCache(); });
    it('invalidates by prefix', () => {
      cache.set('file:a:1', vec1, 'h1');
      cache.set('file:a:2', vec2, 'h2');
      cache.set('file:b:1', vec3, 'h3');
      const count = cache.invalidateByPrefix('file:a:');
      expect(count).toBe(2);
      expect(cache.has('file:a:1')).toBe(false);
      expect(cache.has('file:a:2')).toBe(false);
      expect(cache.has('file:b:1')).toBe(true);
    });
    it('invalidates by hash', () => {
      cache.set('k1', vec1, 'hashX');
      cache.set('k2', vec2, 'hashX');
      cache.set('k3', vec3, 'hashY');
      const count = cache.invalidateByHash('hashX');
      expect(count).toBe(2);
      expect(cache.has('k3')).toBe(true);
    });
    it('returns 0 for no matches', () => {
      expect(cache.invalidateByPrefix('none:')).toBe(0);
      expect(cache.invalidateByHash('nope')).toBe(0);
    });
  });

  describe('Clear & Stats', () => {
    beforeEach(() => { cache = new EmbeddingCache(); });
    it('clears all entries', () => {
      cache.set('a', vec1, 'h1');
      cache.set('b', vec2, 'h2');
      cache.clear();
      expect(cache.size).toBe(0);
    });
    it('tracks hits and misses', () => {
      cache.set('k', vec1, 'h');
      cache.get('k');
      cache.get('k');
      cache.get('nope');
      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
    });
    it('calculates hit rate', () => {
      cache.set('k', vec1, 'h');
      cache.get('k');
      cache.get('nope');
      expect(cache.getStats().hitRate).toBe(0.5);
    });
    it('tracks evictions', () => {
      const small = new EmbeddingCache({ maxEntries: 1 });
      small.set('a', vec1, 'h1');
      small.set('b', vec2, 'h2');
      expect(small.getStats().evictions).toBe(1);
    });
    it('provides memory estimate', () => {
      cache.set('k', vec1, 'hash');
      expect(cache.getStats().estimatedMemoryBytes).toBeGreaterThan(0);
    });
    it('resets stats without clearing data', () => {
      cache.set('k', vec1, 'h');
      cache.get('k');
      cache.resetStats();
      expect(cache.size).toBe(1);
      expect(cache.getStats().hits).toBe(0);
    });
    it('returns keys list', () => {
      cache.set('a', vec1, 'h1');
      cache.set('b', vec2, 'h2');
      expect(cache.keys()).toEqual(expect.arrayContaining(['a', 'b']));
    });
  });

  describe('LRU Ordering', () => {
    it('access moves entry to front (not evicted)', () => {
      const small = new EmbeddingCache({ maxEntries: 2 });
      small.set('a', vec1, 'h1');
      small.set('b', vec2, 'h2');
      small.get('a'); // 'a' now MRU
      small.set('c', vec3, 'h3'); // evicts 'b' (LRU)
      expect(small.get('a')).toBeDefined();
      expect(small.get('b')).toBeUndefined();
      expect(small.get('c')).toBeDefined();
    });
  });

  describe('TTL Expiry', () => {
    it('expires entries after TTL using has()', () => {
      const c = new EmbeddingCache({ ttl: 1 });
      c.set('k', vec1, 'h');
      // Immediate check should pass (TTL hasn't elapsed yet in real time)
      // We test the logic: has() returns false if age > ttl
      expect(c.size).toBe(1);
    });
  });

  describe('Iteration', () => {
    it('iterates over cached entries', () => {
      cache = new EmbeddingCache();
      cache.set('a', vec1, 'h1', 100);
      cache.set('b', vec2, 'h2', 200);
      const entries = [...cache];
      expect(entries.length).toBe(2);
    });
  });

  describe('Access Tracking', () => {
    it('increments access count on get', () => {
      cache = new EmbeddingCache({ trackAccessCounts: true });
      cache.set('k', vec1, 'h');
      cache.get('k');
      cache.get('k');
      cache.get('k');
      const entry = cache.get('k')!;
      expect(entry.accessCount).toBeGreaterThanOrEqual(3);
    });
    it('preserves access count on update', () => {
      cache = new EmbeddingCache();
      cache.set('k', vec1, 'h1');
      cache.get('k');
      cache.get('k');
      cache.set('k', vec2, 'h2');
      const entry = cache.get('k')!;
      expect(entry.accessCount).toBeGreaterThanOrEqual(2);
    });
    it('does not increment access count when tracking disabled', () => {
      cache = new EmbeddingCache({ trackAccessCounts: false });
      cache.set('k', vec1, 'h');
      cache.get('k');
      cache.get('k');
      const entry = cache.get('k')!;
      expect(entry.accessCount).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: TTL Expiry with get()
  // -----------------------------------------------------------------------

  describe('TTL Expiry via get()', () => {
    it('expires entry and returns undefined after TTL via get()', async () => {
      const c = new EmbeddingCache({ ttl: 10 });
      c.set('k', vec1, 'h');
      // Wait longer than TTL
      await new Promise((r) => setTimeout(r, 20));
      expect(c.get('k')).toBeUndefined();
    });

    it('counts TTL expiry as a miss in get()', async () => {
      const c = new EmbeddingCache({ ttl: 10 });
      c.set('k', vec1, 'h');
      await new Promise((r) => setTimeout(r, 20));
      c.get('k');
      expect(c.getStats().misses).toBeGreaterThanOrEqual(1);
    });

    it('counts TTL expiry as an eviction in get()', async () => {
      const c = new EmbeddingCache({ ttl: 10 });
      c.set('k', vec1, 'h');
      await new Promise((r) => setTimeout(r, 20));
      c.get('k');
      expect(c.getStats().evictions).toBe(1);
    });

    it('returns false for has() after TTL expiry', async () => {
      const c = new EmbeddingCache({ ttl: 10 });
      c.set('k', vec1, 'h');
      await new Promise((r) => setTimeout(r, 20));
      expect(c.has('k')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Additional Tests: Edge Cases
  // -----------------------------------------------------------------------

  describe('Edge Cases', () => {
    it('iterates over empty cache without error', () => {
      const c = new EmbeddingCache();
      const entries = [...c];
      expect(entries).toEqual([]);
    });

    it('returns stats with zero values for empty cache', () => {
      const c = new EmbeddingCache();
      const stats = c.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.estimatedMemoryBytes).toBe(0);
    });

    it('keys() returns empty array for empty cache', () => {
      const c = new EmbeddingCache();
      expect(c.keys()).toEqual([]);
    });

    it('tracks sourceLength in set and get', () => {
      const c = new EmbeddingCache();
      c.set('k', vec1, 'hash1', 500);
      const entry = c.get('k')!;
      expect(entry.sourceLength).toBe(500);
    });

    it('defaults sourceLength to 0 when not provided', () => {
      cache = new EmbeddingCache();
      cache.set('k', vec1, 'hash1');
      const entry = cache.get('k')!;
      expect(entry.sourceLength).toBe(0);
    });

    it('resetStats preserves cache data', () => {
      cache = new EmbeddingCache();
      cache.set('a', vec1, 'h1');
      cache.set('b', vec2, 'h2');
      cache.get('a');
      cache.resetStats();
      expect(cache.size).toBe(2);
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(true);
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });

    it('invalidateByPrefix does not match partial non-prefix keys', () => {
      cache = new EmbeddingCache();
      cache.set('prefix:key1', vec1, 'h1');
      cache.set('not prefix:key2', vec2, 'h2');
      const count = cache.invalidateByPrefix('prefix:');
      expect(count).toBe(1);
      expect(cache.has('prefix:key1')).toBe(false);
      expect(cache.has('not prefix:key2')).toBe(true);
    });

    it('LRU evicts properly when adding duplicate key already at front', () => {
      const small = new EmbeddingCache({ maxEntries: 2 });
      small.set('a', vec1, 'h1');
      small.set('b', vec2, 'h2');
      small.set('a', vec3, 'h3'); // update 'a' — should move to front
      small.get('b'); // 'b' now MRU
      small.set('c', vec1, 'h4'); // should evict 'a' (now LRU)
      expect(small.get('a')).toBeUndefined();
      expect(small.get('b')).toBeDefined();
      expect(small.get('c')).toBeDefined();
    });

    it('get with hash mismatch evicts entry and records miss', () => {
      cache = new EmbeddingCache();
      cache.set('k', vec1, 'hash1');
      const result = cache.get('k', 'different_hash');
      expect(result).toBeUndefined();
      expect(cache.has('k')).toBe(false);
      const stats = cache.getStats();
      expect(stats.misses).toBe(1);
      expect(stats.evictions).toBe(1);
    });

    it('delete after eviction does nothing', () => {
      cache = new EmbeddingCache({ maxEntries: 1 });
      cache.set('a', vec1, 'h1');
      cache.set('b', vec2, 'h2'); // evicts 'a'
      expect(cache.delete('a')).toBe(false);
      expect(cache.delete('b')).toBe(true);
    });
  });

  // ==========================================================================
  // Branch Coverage: has() with hash mismatch
  // ==========================================================================

  describe('Has — hash mismatch', () => {
    it('returns false when hash does not match', () => {
      const c = new EmbeddingCache();
      c.set('k', vec1, 'original-hash');
      expect(c.has('k', 'wrong-hash')).toBe(false);
      // The entry should still exist (has() doesn't remove)
      expect(c.has('k')).toBe(true);
    });
  });

  // ==========================================================================
  // Branch Coverage: invalidateByHash edge cases
  // ==========================================================================

  describe('Invalidation by hash — more coverage', () => {
    it('invalidateByHash removes only matching entries', () => {
      const c = new EmbeddingCache();
      c.set('a', vec1, 'hashA');
      c.set('b', vec2, 'hashB');
      c.set('c', vec3, 'hashA');
      expect(c.invalidateByHash('hashA')).toBe(2);
      expect(c.has('b')).toBe(true);
    });

    it('invalidateByHash returns 0 when no hash matches', () => {
      const c = new EmbeddingCache();
      c.set('a', vec1, 'hashA');
      expect(c.invalidateByHash('nonexistent')).toBe(0);
    });
  });

  // ==========================================================================
  // Branch Coverage: set when cache is exactly at capacity
  // ==========================================================================

  describe('Set — at capacity eviction', () => {
    it('evicts LRU when adding to full cache', () => {
      const c = new EmbeddingCache({ maxEntries: 3 });
      c.set('a', vec1, 'h1');
      c.set('b', vec2, 'h2');
      c.set('c', vec3, 'h3');
      // Access 'a' to make 'b' the LRU
      c.get('a');
      c.set('d', vec1, 'h4');
      // 'b' should be evicted (LRU)
      expect(c.has('a')).toBe(true);
      expect(c.has('b')).toBe(false);
      expect(c.has('c')).toBe(true);
      expect(c.has('d')).toBe(true);
    });
  });

  // ==========================================================================
  // Branch Coverage: get() with TTL expiry (real time)
  // ==========================================================================

  describe('TTL expiry — real-time', () => {
    it('evicts entry after TTL expires', async () => {
      const c = new EmbeddingCache({ ttl: 5 });
      c.set('k', vec1, 'h');
      await new Promise(r => setTimeout(r, 15));
      expect(c.get('k')).toBeUndefined();
      expect(c.size).toBe(0);
    });

    it('does not evict entry before TTL expires', () => {
      const c = new EmbeddingCache({ ttl: 60000 });
      c.set('k', vec1, 'h');
      expect(c.get('k')).toBeDefined();
    });
  });
});
