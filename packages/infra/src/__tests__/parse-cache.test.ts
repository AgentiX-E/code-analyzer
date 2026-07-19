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
});
