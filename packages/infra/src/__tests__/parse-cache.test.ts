// @code-analyzer/infra — ParseCache Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { createParseCache, computeContentHash } from '../cache/parse-cache.js';
import type { ParseCache } from '../cache/parse-cache.js';
import type { ParsedFile, SupportedLanguage } from '@code-analyzer/shared';

function createMockParsedFile(filePath: string): ParsedFile {
  return {
    filePath,
    language: 'typescript' as SupportedLanguage,
    symbols: [],
    references: [],
    scopeTree: {
      name: 'root',
      kind: 'File',
      startLine: 1,
      endLine: 10,
      children: [],
      symbols: [],
    },
    ast: {},
  };
}

describe('computeContentHash', () => {
  it('computes SHA-256 hash', () => {
    const hash = computeContentHash('hello world');
    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64); // SHA-256 hex is 64 chars
  });

  it('produces consistent hashes for same input', () => {
    const h1 = computeContentHash('same content');
    const h2 = computeContentHash('same content');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different input', () => {
    const h1 = computeContentHash('content A');
    const h2 = computeContentHash('content B');
    expect(h1).not.toBe(h2);
  });

  it('handles empty string', () => {
    const hash = computeContentHash('');
    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64);
  });

  it('handles large content', () => {
    const large = 'x'.repeat(10000);
    const hash = computeContentHash(large);
    expect(hash.length).toBe(64);
  });
});

describe('ParseCache', () => {
  let cache: ParseCache;
  let file1: ParsedFile;
  let file2: ParsedFile;
  let hash1: string;
  let hash2: string;

  beforeEach(() => {
    cache = createParseCache(10);
    file1 = createMockParsedFile('src/file1.ts');
    file2 = createMockParsedFile('src/file2.ts');
    hash1 = computeContentHash('file1 content');
    hash2 = computeContentHash('file2 content');
  });

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(cache.size).toBe(0);
    });

    it('stores and retrieves a value', () => {
      cache.set(hash1, file1);
      expect(cache.size).toBe(1);
      expect(cache.get(hash1)).toEqual(file1);
    });

    it('returns null for missing key', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('checks existence with has()', () => {
      expect(cache.has(hash1)).toBe(false);
      cache.set(hash1, file1);
      expect(cache.has(hash1)).toBe(true);
    });

    it('overwrites existing entry', () => {
      cache.set(hash1, file1);
      cache.set(hash1, file2);
      expect(cache.get(hash1)).toEqual(file2);
      expect(cache.size).toBe(1);
    });
  });

  describe('eviction', () => {
    it('evicts oldest entries when exceeding maxSize', () => {
      const smallCache = createParseCache(3);

      for (let i = 0; i < 5; i++) {
        const hash = computeContentHash(`content${i}`);
        const file = createMockParsedFile(`file${i}.ts`);
        smallCache.set(hash, file);
      }

      expect(smallCache.size).toBe(3);
      // Oldest entries should be evicted
      const oldestHash = computeContentHash('content0');
      expect(smallCache.has(oldestHash)).toBe(false);
    });

    it('keeps recently accessed entries', () => {
      const smallCache = createParseCache(3);

      const h0 = computeContentHash('content0');
      const h1 = computeContentHash('content1');
      const h2 = computeContentHash('content2');
      const h3 = computeContentHash('content3');

      smallCache.set(h0, createMockParsedFile('f0.ts'));
      smallCache.set(h1, createMockParsedFile('f1.ts'));
      smallCache.set(h2, createMockParsedFile('f2.ts'));

      // Access h0 to make it most recently used
      smallCache.get(h0);

      // Add new entry, h1 should be evicted (oldest) instead of h0
      smallCache.set(h3, createMockParsedFile('f3.ts'));

      expect(smallCache.has(h0)).toBe(true); // accessed, so kept
      expect(smallCache.has(h1)).toBe(false); // oldest, evicted
      expect(smallCache.has(h2)).toBe(true);
      expect(smallCache.has(h3)).toBe(true);
    });
  });

  describe('invalidation', () => {
    it('invalidates by file path', () => {
      cache.set(hash1, file1);
      cache.set(hash2, file2);

      cache.invalidate('src/file1.ts');
      expect(cache.has(hash1)).toBe(false);
      expect(cache.has(hash2)).toBe(true);
      expect(cache.size).toBe(1);
    });

    it('handles non-existent file path gracefully', () => {
      cache.set(hash1, file1);
      cache.invalidate('nonexistent.ts');
      expect(cache.size).toBe(1);
    });

    it('invalidates all entries matching file path', () => {
      // Same file path, different hashes (different content versions)
      const hash_v1 = computeContentHash('v1');
      const hash_v2 = computeContentHash('v2');
      cache.set(hash_v1, createMockParsedFile('shared.ts'));
      cache.set(hash_v2, createMockParsedFile('shared.ts'));
      cache.set(hash1, file1);

      cache.invalidate('shared.ts');
      expect(cache.has(hash_v1)).toBe(false);
      expect(cache.has(hash_v2)).toBe(false);
      expect(cache.has(hash1)).toBe(true);
      expect(cache.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set(hash1, file1);
      cache.set(hash2, file2);
      expect(cache.size).toBe(2);

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.get(hash1)).toBeNull();
      expect(cache.get(hash2)).toBeNull();
    });

    it('handles clear on empty cache', () => {
      expect(() => cache.clear()).not.toThrow();
    });
  });

  describe('default size', () => {
    it('uses default maxSize of 1000', () => {
      const defaultCache = createParseCache();
      for (let i = 0; i < 100; i++) {
        defaultCache.set(
          computeContentHash(`def${i}`),
          createMockParsedFile(`f${i}.ts`),
        );
      }
      expect(defaultCache.size).toBe(100);
    });
  });

  // ── Additional coverage tests ──

  describe('maxSize edge cases', () => {
    it('handles maxSize=0 (immediate eviction)', () => {
      const zeroCache = createParseCache(0);
      zeroCache.set(hash1, file1);
      // maxSize=0 means cache.size > 0 immediately triggers eviction
      expect(zeroCache.size).toBe(0);
      expect(zeroCache.get(hash1)).toBeNull();
    });

    it('handles maxSize=1 (evicts previous entry)', () => {
      const singleCache = createParseCache(1);
      const h1 = computeContentHash('first');
      const h2 = computeContentHash('second');

      singleCache.set(h1, file1);
      expect(singleCache.size).toBe(1);
      expect(singleCache.has(h1)).toBe(true);

      singleCache.set(h2, file2);
      expect(singleCache.size).toBe(1);
      expect(singleCache.has(h1)).toBe(false); // evicted
      expect(singleCache.has(h2)).toBe(true);
    });

    it('handles maxSize=Infinity (no eviction)', () => {
      const infiniteCache = createParseCache(Infinity);
      for (let i = 0; i < 100; i++) {
        infiniteCache.set(
          computeContentHash(`inf${i}`),
          createMockParsedFile(`inf${i}.ts`),
        );
      }
      expect(infiniteCache.size).toBe(100);
    });
  });

  describe('unicode content hashes', () => {
    it('computes hash for unicode content', () => {
      const hash = computeContentHash('你好世界 🌍');
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('computes hash for emoji-only content', () => {
      const hash = computeContentHash('🎉🎊🚀💯');
      expect(hash).toBeTruthy();
      expect(hash.length).toBe(64);
    });

    it('different unicode content produces different hashes', () => {
      const h1 = computeContentHash('你好');
      const h2 = computeContentHash('世界');
      expect(h1).not.toBe(h2);
    });
  });

  describe('LRU behavior with maxSize=2', () => {
    it('evicts least recently used entry', () => {
      const cache = createParseCache(2);
      const h1 = computeContentHash('a');
      const h2 = computeContentHash('b');
      const h3 = computeContentHash('c');

      cache.set(h1, file1); // oldest
      cache.set(h2, file2); // middle
      // Access h1 to make it recently used
      cache.get(h1);
      // Now h2 is LRU
      cache.set(h3, createMockParsedFile('f3.ts'));

      expect(cache.has(h1)).toBe(true); // was accessed
      expect(cache.has(h2)).toBe(false); // LRU, evicted
      expect(cache.has(h3)).toBe(true); // new
      expect(cache.size).toBe(2);
    });

    it('re-setting same key does not change eviction order unfairly', () => {
      const cache = createParseCache(2);
      const h1 = computeContentHash('x');
      const h2 = computeContentHash('y');

      cache.set(h1, file1);
      cache.set(h2, file2);
      // Re-set h1 — it becomes MRU
      cache.set(h1, createMockParsedFile('updated.ts'));

      const h3 = computeContentHash('z');
      cache.set(h3, createMockParsedFile('z.ts'));

      expect(cache.has(h1)).toBe(true);
      expect(cache.has(h2)).toBe(false); // evicted (was LRU)
      expect(cache.has(h3)).toBe(true);
    });
  });

  describe('touch behavior', () => {
    it('get on non-existent key does not corrupt order', () => {
      const cache = createParseCache(3);
      cache.set(hash1, file1);
      cache.get('nonexistent'); // should not affect order
      cache.set(hash2, file2);
      expect(cache.size).toBe(2);
    });

    it('get moves entry to MRU position', () => {
      const cache = createParseCache(3);
      const h1 = computeContentHash('c1');
      const h2 = computeContentHash('c2');
      const h3 = computeContentHash('c3');
      const h4 = computeContentHash('c4');

      cache.set(h1, file1);
      cache.set(h2, file2);
      cache.set(h3, createMockParsedFile('f3.ts'));

      // Access h1 (oldest) — makes it MRU
      cache.get(h1);

      // Add h4, should evict h2 (now oldest)
      cache.set(h4, createMockParsedFile('f4.ts'));

      expect(cache.has(h1)).toBe(true);
      expect(cache.has(h2)).toBe(false);
      expect(cache.has(h3)).toBe(true);
      expect(cache.has(h4)).toBe(true);
    });
  });

  describe('invalidation with empty cache', () => {
    it('invalidate on empty cache does not throw', () => {
      const cache = createParseCache(10);
      expect(() => cache.invalidate('nonexistent.ts')).not.toThrow();
    });
  });

  describe('prewarm', () => {
    it('should insert lightweight placeholders', () => {
      const cache = createParseCache(100);
      cache.prewarm([{ content: 'const x = 1;', filePath: '/src/test.ts' }]);

      const hash = computeContentHash('const x = 1;');
      expect(cache.has(hash)).toBe(true);
      const entry = cache.get(hash);
      expect(entry).toBeDefined();
      expect(entry!.filePath).toBe('/src/test.ts');
    });

    it('should handle empty entries array', () => {
      const cache = createParseCache(100);
      expect(() => cache.prewarm([])).not.toThrow();
      expect(cache.getHitRate()).toBe(0);
    });

    it('should not duplicate entries with same hash', () => {
      const cache = createParseCache(100);
      cache.prewarm([
        { content: 'const x = 1;', filePath: '/src/a.ts' },
        { content: 'const x = 1;', filePath: '/src/b.ts' }, // same content = same hash
      ]);
      const hash = computeContentHash('const x = 1;');
      expect(cache.has(hash)).toBe(true);
    });

    it('should insert multiple unique entries', () => {
      const cache = createParseCache(100);
      cache.prewarm([
        { content: 'const a = 1;', filePath: '/src/a.ts' },
        { content: 'const b = 2;', filePath: '/src/b.ts' },
      ]);
      expect(cache.has(computeContentHash('const a = 1;'))).toBe(true);
      expect(cache.has(computeContentHash('const b = 2;'))).toBe(true);
    });

    it('should allow entries to be overwritten by subsequent set', () => {
      const cache = createParseCache(100);
      cache.prewarm([{ content: 'const x = 1;', filePath: '/src/placeholder.ts' }]);

      const hash = computeContentHash('const x = 1;');
      const realFile = createMockParsedFile('/src/real.ts');
      cache.set(hash, realFile);

      const retrieved = cache.get(hash);
      expect(retrieved!.filePath).toBe('/src/real.ts');
    });

    it('should trigger eviction when prewarming exceeds maxSize', () => {
      const cache = createParseCache(3);
      cache.prewarm([
        { content: 'a', filePath: '/a.ts' },
        { content: 'b', filePath: '/b.ts' },
        { content: 'c', filePath: '/c.ts' },
        { content: 'd', filePath: '/d.ts' },
      ]);
      // Should evict the oldest entry ('a')
      expect(cache.has(computeContentHash('a'))).toBe(false);
      expect(cache.has(computeContentHash('d'))).toBe(true);
    });

    it('should skip existing hash during prewarm', () => {
      const cache = createParseCache(100);
      const hash = computeContentHash('same');
      const file = createMockParsedFile('/existing.ts');
      cache.set(hash, file);

      // Prewarm with same content — should skip
      cache.prewarm([{ content: 'same', filePath: '/should-not-overwrite.ts' }]);
      const entry = cache.get(hash);
      expect(entry!.filePath).toBe('/existing.ts'); // Not overwritten
    });

    it('should not set entry when hash already exists (prewarm skip branch)', () => {
      const cache = createParseCache(100);
      const hash = computeContentHash('skip-me');
      cache.set(hash, createMockParsedFile('/original.ts'));

      // Prewarm with same content - should hit the `if (!cache.has(hash))` false branch
      cache.prewarm([{ content: 'skip-me', filePath: '/should-be-skipped.ts' }]);
      const entry = cache.get(hash);
      expect(entry!.filePath).toBe('/original.ts');
      expect(cache.size).toBe(1);
    });
  });

  describe('getHitRate', () => {
    it('should return 0 when no gets have occurred', () => {
      const cache = createParseCache({ maxSize: 100 });
      expect(cache.getHitRate()).toBe(0);
    });

    it('should return 1.0 when all gets hit', () => {
      const cache = createParseCache(100);
      const file = createMockParsedFile('/src/test.ts');
      const hash = computeContentHash('test');
      cache.set(hash, file);
      cache.get(hash);
      cache.get(hash);
      expect(cache.getHitRate()).toBe(1);
    });

    it('should return 0 when all gets miss', () => {
      const cache = createParseCache(100);
      cache.get('nonexistent-hash-1');
      cache.get('nonexistent-hash-2');
      expect(cache.getHitRate()).toBe(0);
    });

    it('should return correct fraction for mixed hits and misses', () => {
      const cache = createParseCache(100);
      const file = createMockParsedFile('/src/test.ts');
      const hash = computeContentHash('test');
      cache.set(hash, file);
      cache.get(hash); // hit
      cache.get('missing-1'); // miss
      cache.get(hash); // hit
      cache.get('missing-2'); // miss
      // 2 hits out of 4 gets = 0.5
      expect(cache.getHitRate()).toBe(0.5);
    });

    it('should reflect cache clear reset', () => {
      const cache = createParseCache(100);
      const hash = computeContentHash('test');
      cache.set(hash, createMockParsedFile('/src/test.ts'));
      cache.get(hash); // hit
      expect(cache.getHitRate()).toBe(1);

      cache.clear();
      expect(cache.getHitRate()).toBe(0);
    });
  });

  describe('eviction edge case — single entry at maxSize', () => {
    it('should not evict when exactly at maxSize', () => {
      const cache = createParseCache(1);
      const hash = computeContentHash('single');
      cache.set(hash, createMockParsedFile('/single.ts'));
      expect(cache.size).toBe(1);
      expect(cache.has(hash)).toBe(true);
    });

    it('should evict the single entry when adding second entry at maxSize=1', () => {
      const cache = createParseCache(1);
      const h1 = computeContentHash('first');
      const h2 = computeContentHash('second');
      cache.set(h1, createMockParsedFile('/first.ts'));
      cache.set(h2, createMockParsedFile('/second.ts'));
      expect(cache.size).toBe(1);
      expect(cache.has(h1)).toBe(false);
      expect(cache.has(h2)).toBe(true);
    });
  });

  describe('get with null return', () => {
    it('should return null for non-existent hash (?? null branch)', () => {
      const cache = createParseCache(10);
      const result = cache.get('nonexistent-hash-that-is-not-cached');
      expect(result).toBeNull();
    });

    it('should return null after invalidation', () => {
      const cache = createParseCache(10);
      const hash = computeContentHash('temp');
      cache.set(hash, createMockParsedFile('/temp.ts'));
      cache.invalidate('/temp.ts');
      expect(cache.get(hash)).toBeNull();
    });
  });
});
