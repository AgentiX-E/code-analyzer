// @code-analyzer/analyzer — Parse Cache Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { ParseCache } from '../parser/parse-cache.js';
import type { UnifiedCapture } from '@code-analyzer/shared';

function makeCaptures(count: number): UnifiedCapture[] {
  return Array.from({ length: count }, (_, i) => ({
    nodeType: 'function_definition' as const,
    name: `func${i}`,
    startLine: i * 10,
    endLine: i * 10 + 5,
    children: [],
    text: `function func${i}() {}`,
    syntaxType: `source.ts`,
  }));
}

describe('ParseCache', () => {
  let cache: ParseCache;

  beforeEach(() => {
    cache = new ParseCache(100);
  });

  describe('constructor', () => {
    it('should create a cache with default capacity', () => {
      const defaultCache = new ParseCache();
      expect(defaultCache.capacity).toBe(10000);
    });

    it('should create a cache with custom capacity', () => {
      expect(cache.capacity).toBe(100);
    });
  });

  describe('get/set', () => {
    it('should return null for uncached file', () => {
      expect(cache.get('file.ts', 'content')).toBeNull();
    });

    it('should store and retrieve cached captures', () => {
      const captures = makeCaptures(3);
      cache.set('file.ts', 'content', captures);
      const result = cache.get('file.ts', 'content');
      expect(result).toEqual(captures);
    });

    it('should return null when content changes (fingerprint mismatch)', () => {
      cache.set('file.ts', 'original', makeCaptures(2));
      const result = cache.get('file.ts', 'modified');
      expect(result).toBeNull();
    });

    it('should evict stale entry on mismatch', () => {
      cache.set('file.ts', 'original', makeCaptures(2));
      cache.get('file.ts', 'modified'); // stale, evicts
      expect(cache.size).toBe(0);
    });
  });

  describe('has', () => {
    it('should return false for uncached file', () => {
      expect(cache.has('file.ts', 'content')).toBe(false);
    });

    it('should return true for cached file with matching fingerprint', () => {
      cache.set('file.ts', 'content', makeCaptures(1));
      expect(cache.has('file.ts', 'content')).toBe(true);
    });

    it('should return false when content changed', () => {
      cache.set('file.ts', 'original', makeCaptures(1));
      expect(cache.has('file.ts', 'modified')).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('should remove a single file', () => {
      cache.set('a.ts', 'content', makeCaptures(1));
      cache.set('b.ts', 'content', makeCaptures(1));
      cache.invalidate('a.ts');
      expect(cache.has('a.ts', 'content')).toBe(false);
      expect(cache.has('b.ts', 'content')).toBe(true);
    });

    it('should be a no-op for non-existent file', () => {
      expect(() => cache.invalidate('missing.ts')).not.toThrow();
    });
  });

  describe('invalidateByPrefix', () => {
    it('should invalidate all files under a directory', () => {
      cache.set('src/a.ts', 'content', makeCaptures(1));
      cache.set('src/b.ts', 'content', makeCaptures(1));
      cache.set('test/c.ts', 'content', makeCaptures(1));

      cache.invalidateByPrefix('src/');
      expect(cache.has('src/a.ts', 'content')).toBe(false);
      expect(cache.has('src/b.ts', 'content')).toBe(false);
      expect(cache.has('test/c.ts', 'content')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('a.ts', 'content', makeCaptures(1));
      cache.set('b.ts', 'content', makeCaptures(1));
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('stats', () => {
    it('should track hits and misses', () => {
      cache.get('file.ts', 'content'); // miss
      expect(cache.stats.misses).toBe(1);

      cache.set('file.ts', 'content', makeCaptures(1));
      cache.get('file.ts', 'content'); // hit
      expect(cache.stats.hits).toBe(1);
      expect(cache.stats.misses).toBe(1);
    });

    it('should have 0 hit rate initially', () => {
      expect(cache.stats.hitRate).toBe(0);
    });

    it('should have 100% hit rate with all hits', () => {
      cache.set('f.ts', 'c', makeCaptures(1));
      cache.get('f.ts', 'c');
      expect(cache.stats.hitRate).toBe(1);
    });
  });

  describe('LRU behavior', () => {
    it('should evict least recently used entries', () => {
      const small = new ParseCache(3);
      small.set('a.ts', 'c1', makeCaptures(1));
      small.set('b.ts', 'c2', makeCaptures(1));
      small.set('c.ts', 'c3', makeCaptures(1));
      small.set('d.ts', 'c4', makeCaptures(1)); // evicts a.ts

      expect(small.has('a.ts', 'c1')).toBe(false);
      expect(small.has('d.ts', 'c4')).toBe(true);
      expect(small.size).toBe(3);
    });
  });
});
