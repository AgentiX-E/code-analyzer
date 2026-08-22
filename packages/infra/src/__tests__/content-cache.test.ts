// @code-analyzer/infra — ContentCache Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ContentCache, computeSha256 } from '../cache/content-cache.js';
import type { ContentCacheEntry } from '../cache/content-cache.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createTempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-cache-test-'));
  return path.join(dir, 'cache.json');
}

// ---------------------------------------------------------------------------
// computeSha256
// ---------------------------------------------------------------------------

describe('computeSha256', () => {
  it('computes SHA-256 hash as 64-char hex string', () => {
    const hash = computeSha256('hello world');
    expect(hash).toBeTypeOf('string');
    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('produces consistent hashes for same input', () => {
    expect(computeSha256('same content')).toBe(computeSha256('same content'));
  });

  it('produces different hashes for different input', () => {
    expect(computeSha256('content A')).not.toBe(computeSha256('content B'));
  });

  it('handles empty string', () => {
    const hash = computeSha256('');
    expect(hash).toBeTypeOf('string');
    expect(hash.length).toBe(64);
  });

  it('handles unicode content', () => {
    const hash = computeSha256('你好世界 🌍');
    expect(hash.length).toBe(64);
  });

  it('handles very large content', () => {
    const large = 'x'.repeat(1_000_000);
    const hash = computeSha256(large);
    expect(hash.length).toBe(64);
  });

  it('SHA-256 matches known vector (empty string)', () => {
    // RFC 6234 test vector for empty string
    expect(computeSha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('SHA-256 matches known vector (abc)', () => {
    // RFC 6234 test vector for "abc"
    expect(computeSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('SHA-256 is deterministic across calls', () => {
    for (let i = 0; i < 100; i++) {
      expect(computeSha256(`test-${i}`)).toBe(computeSha256(`test-${i}`));
    }
  });
});

// ---------------------------------------------------------------------------
// ContentCache — basic operations
// ---------------------------------------------------------------------------

describe('ContentCache', () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache(100);
  });

  describe('constructor and defaults', () => {
    it('uses default maxEntries of 50,000', () => {
      const defaultCache = new ContentCache();
      expect(defaultCache.getStats().maxEntries).toBe(50_000);
    });

    it('accepts custom maxEntries', () => {
      const custom = new ContentCache(42);
      expect(custom.getStats().maxEntries).toBe(42);
    });

    it('starts empty', () => {
      expect(cache.size).toBe(0);
      expect(cache.getStats().entries).toBe(0);
    });

    it('starts with zero hit/miss/eviction counts', () => {
      const stats = cache.getStats();
      expect(stats.hitCount).toBe(0);
      expect(stats.missCount).toBe(0);
      expect(stats.evictionCount).toBe(0);
    });

    it('accepts persistence path in constructor', () => {
      const c = new ContentCache(100, '/tmp/test-cache.json');
      expect(c.getStats().persistencePath).toBe('/tmp/test-cache.json');
    });
  });

  describe('set and get', () => {
    it('stores an entry and returns it via get', () => {
      cache.set('src/file.ts', 'console.log("hello");');
      const entry = cache.get('src/file.ts');
      expect(entry).not.toBeNull();
      expect(entry!.sha256).toBe(computeSha256('console.log("hello");'));
      expect(entry!.parsedAt).toBeTypeOf('number');
    });

    it('returns null for missing file path', () => {
      expect(cache.get('nonexistent.ts')).toBeNull();
    });

    it('overwrites existing entry for same path', () => {
      cache.set('src/file.ts', 'v1');
      cache.set('src/file.ts', 'v2');
      expect(cache.size).toBe(1);
      expect(cache.get('src/file.ts')!.sha256).toBe(computeSha256('v2'));
    });

    it('get returns a copy, not reference', () => {
      cache.set('src/file.ts', 'content');
      const entry1 = cache.get('src/file.ts');
      const entry2 = cache.get('src/file.ts');
      expect(entry1).not.toBe(entry2); // Different objects
      expect(entry1).toEqual(entry2);
      // Mutating copy does not affect cache
      entry1!.sha256 = 'modified';
      expect(cache.get('src/file.ts')!.sha256).toBe(computeSha256('content'));
    });
  });

  describe('getHash', () => {
    it('returns raw SHA-256 hash string', () => {
      cache.set('src/file.ts', 'content');
      const hash = cache.getHash('src/file.ts');
      expect(hash).toBe(computeSha256('content'));
    });

    it('returns null for missing path', () => {
      expect(cache.getHash('missing.ts')).toBeNull();
    });
  });

  describe('has', () => {
    it('returns true when content matches cached hash', () => {
      cache.set('src/file.ts', 'hello');
      expect(cache.has('src/file.ts', 'hello')).toBe(true);
    });

    it('returns false when content does not match cached hash', () => {
      cache.set('src/file.ts', 'hello');
      expect(cache.has('src/file.ts', 'world')).toBe(false);
    });

    it('returns false for uncached file', () => {
      expect(cache.has('unknown.ts', 'content')).toBe(false);
    });

    it('increments hit count on match', () => {
      cache.set('src/file.ts', 'data');
      expect(cache.getStats().hitCount).toBe(0);
      cache.has('src/file.ts', 'data');
      expect(cache.getStats().hitCount).toBe(1);
    });

    it('increments miss count on no match', () => {
      cache.set('src/file.ts', 'data');
      const before = cache.getStats().missCount;
      cache.has('src/file.ts', 'wrong');
      expect(cache.getStats().missCount).toBe(before + 1);
    });

    it('increments miss count on uncached file', () => {
      const before = cache.getStats().missCount;
      cache.has('unknown.ts', 'content');
      expect(cache.getStats().missCount).toBe(before + 1);
    });
  });
});

// ---------------------------------------------------------------------------
// ContentCache — LRU eviction
// ---------------------------------------------------------------------------

describe('ContentCache LRU eviction', () => {
  it('evicts oldest entries when exceeding maxEntries', () => {
    const cache = new ContentCache(3);

    for (let i = 0; i < 5; i++) {
      cache.set(`file${i}.ts`, `content${i}`);
    }

    expect(cache.size).toBe(3);
    // Oldest two entries should be evicted
    expect(cache.get('file0.ts')).toBeNull();
    expect(cache.get('file1.ts')).toBeNull();
    expect(cache.get('file2.ts')).not.toBeNull();
    expect(cache.get('file3.ts')).not.toBeNull();
    expect(cache.get('file4.ts')).not.toBeNull();
  });

  it('preserves recently accessed entries', () => {
    const cache = new ContentCache(3);

    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    cache.set('c.ts', 'c');

    // Access 'a' to make it recently used
    cache.get('a.ts');

    // Add new entry, should evict 'b' (oldest) not 'a'
    cache.set('d.ts', 'd');

    expect(cache.get('a.ts')).not.toBeNull();
    expect(cache.get('b.ts')).toBeNull(); // evicted
    expect(cache.get('c.ts')).not.toBeNull();
    expect(cache.get('d.ts')).not.toBeNull();
  });

  it('has() also promotes entry to most recently used', () => {
    const cache = new ContentCache(3);

    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    cache.set('c.ts', 'c');

    // has() with matching content promotes to MRU
    cache.has('a.ts', 'a');

    cache.set('d.ts', 'd');

    expect(cache.get('a.ts')).not.toBeNull();
    expect(cache.get('b.ts')).toBeNull(); // evicted
    expect(cache.get('c.ts')).not.toBeNull();
    expect(cache.get('d.ts')).not.toBeNull();
  });

  it('has() with non-matching content does NOT promote', () => {
    const cache = new ContentCache(3);

    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    cache.set('c.ts', 'c');

    // has() returns false — content mismatch, no promotion
    cache.has('a.ts', 'wrong-content');

    cache.set('d.ts', 'd');

    // 'a' still oldest, should be evicted
    expect(cache.get('a.ts')).toBeNull();
    expect(cache.get('b.ts')).not.toBeNull();
    expect(cache.get('c.ts')).not.toBeNull();
    expect(cache.get('d.ts')).not.toBeNull();
  });

  it('getHash() promotes entry to MRU', () => {
    const cache = new ContentCache(3);

    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    cache.set('c.ts', 'c');

    cache.getHash('a.ts');

    cache.set('d.ts', 'd');

    expect(cache.get('a.ts')).not.toBeNull();
    expect(cache.get('b.ts')).toBeNull();
    expect(cache.get('c.ts')).not.toBeNull();
    expect(cache.get('d.ts')).not.toBeNull();
  });

  it('tracks eviction count', () => {
    const cache = new ContentCache(2);

    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    expect(cache.getStats().evictionCount).toBe(0);

    cache.set('c.ts', 'c');
    expect(cache.getStats().evictionCount).toBe(1);

    cache.set('d.ts', 'd');
    expect(cache.getStats().evictionCount).toBe(2);
  });

  it('handles maxEntries=0 (immediate eviction)', () => {
    const cache = new ContentCache(0);
    cache.set('a.ts', 'content');
    expect(cache.size).toBe(0);
    expect(cache.get('a.ts')).toBeNull();
  });

  it('handles maxEntries=1', () => {
    const cache = new ContentCache(1);

    cache.set('a.ts', 'a');
    expect(cache.size).toBe(1);
    expect(cache.get('a.ts')).not.toBeNull();

    cache.set('b.ts', 'b');
    expect(cache.size).toBe(1);
    expect(cache.get('a.ts')).toBeNull();
    expect(cache.get('b.ts')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ContentCache — invalidation and clear
// ---------------------------------------------------------------------------

describe('ContentCache invalidation', () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache(100);
  });

  it('invalidates a specific file path', () => {
    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    expect(cache.size).toBe(2);

    expect(cache.invalidate('a.ts')).toBe(true);
    expect(cache.get('a.ts')).toBeNull();
    expect(cache.get('b.ts')).not.toBeNull();
    expect(cache.size).toBe(1);
  });

  it('returns false for non-existent file', () => {
    expect(cache.invalidate('nonexistent.ts')).toBe(false);
  });

  it('invalidating does not affect other entries', () => {
    for (let i = 0; i < 10; i++) {
      cache.set(`file${i}.ts`, `content${i}`);
    }

    cache.invalidate('file5.ts');

    expect(cache.get('file5.ts')).toBeNull();
    expect(cache.size).toBe(9);
    for (let i = 0; i < 10; i++) {
      if (i !== 5) {
        expect(cache.get(`file${i}.ts`)).not.toBeNull();
      }
    }
  });

  it('handles double invalidate gracefully', () => {
    cache.set('a.ts', 'a');
    expect(cache.invalidate('a.ts')).toBe(true);
    expect(cache.invalidate('a.ts')).toBe(false);
  });
});

describe('ContentCache clear', () => {
  it('removes all entries', () => {
    const cache = new ContentCache(100);
    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    expect(cache.size).toBe(2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a.ts')).toBeNull();
    expect(cache.get('b.ts')).toBeNull();
  });

  it('handles clear on empty cache', () => {
    const cache = new ContentCache(100);
    expect(() => cache.clear()).not.toThrow();
    expect(cache.size).toBe(0);
  });

  it('clear resets LRU order', () => {
    const cache = new ContentCache(3);
    cache.set('a.ts', 'a');
    cache.set('b.ts', 'b');
    cache.clear();
    cache.set('c.ts', 'c');
    cache.set('d.ts', 'd');
    cache.set('e.ts', 'e');
    expect(cache.size).toBe(3);
    expect(cache.get('c.ts')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ContentCache — persistence
// ---------------------------------------------------------------------------

describe('ContentCache persistence', () => {
  let cache: ContentCache;
  let tempPath: string;

  beforeEach(() => {
    tempPath = createTempFilePath();
    cache = new ContentCache(100, tempPath);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tempPath);
      fs.rmdirSync(path.dirname(tempPath));
    } catch {
      // Cleanup may fail if dir already removed — ignore
    }
  });

  describe('saveSync and loadSync', () => {
    it('persists and reloads cache entries', () => {
      cache.set('a.ts', 'hello');
      cache.set('b.ts', 'world');
      cache.set('c.ts', 'test');

      cache.saveSync();

      const restored = new ContentCache(100, tempPath);
      restored.loadSync();

      expect(restored.size).toBe(3);
      expect(restored.get('a.ts')!.sha256).toBe(computeSha256('hello'));
      expect(restored.get('b.ts')!.sha256).toBe(computeSha256('world'));
      expect(restored.get('c.ts')!.sha256).toBe(computeSha256('test'));
    });

    it('returns false when file does not exist', () => {
      const empty = new ContentCache(100, '/nonexistent/path/cache.json');
      expect(empty.loadSync()).toBe(false);
    });

    it('returns false for unknown version', () => {
      fs.writeFileSync(
        tempPath,
        JSON.stringify({ version: 99, maxEntries: 100, entries: [] }),
        'utf-8',
      );
      expect(cache.loadSync()).toBe(false);
    });

    it('returns false for unknown version via async load', async () => {
      fs.writeFileSync(
        tempPath,
        JSON.stringify({ version: 99, maxEntries: 100, entries: [] }),
        'utf-8',
      );
      expect(await cache.load()).toBe(false);
    });

    it('preserves parsedAt timestamps across reload', () => {
      cache.set('a.ts', 'content');
      const before = cache.get('a.ts')!.parsedAt;

      cache.saveSync();

      const restored = new ContentCache(100, tempPath);
      restored.loadSync();

      expect(restored.get('a.ts')!.parsedAt).toBe(before);
    });

    it('respects maxEntries on reload when config changed', () => {
      // Save 5 entries with large max
      const large = new ContentCache(1000, tempPath);
      for (let i = 0; i < 5; i++) {
        large.set(`file${i}.ts`, `content${i}`);
      }
      large.saveSync();

      // Reload with smaller max
      const small = new ContentCache(3, tempPath);
      small.loadSync();

      // Only 3 most recent should survive (sorted by parsedAt desc)
      expect(small.size).toBe(3);
    });

    it('creates parent directory if needed', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-dir-'));
      const nestedPath = path.join(dir, 'sub', 'nested', 'cache.json');

      const nested = new ContentCache(100, nestedPath);
      nested.set('a.ts', 'data');
      nested.saveSync();

      expect(fs.existsSync(nestedPath)).toBe(true);

      // Cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('creates parent directory if needed via async save', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-dir-async-'));
      const nestedPath = path.join(dir, 'sub', 'nested', 'cache-async.json');

      const nested = new ContentCache(100, nestedPath);
      nested.set('a.ts', 'async data');
      await nested.save();

      expect(fs.existsSync(nestedPath)).toBe(true);

      // Cleanup
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('throws if persistencePath is not set', () => {
      const noPath = new ContentCache(100);
      expect(() => noPath.saveSync()).toThrow('no persistencePath was configured');
      expect(() => noPath.loadSync()).toThrow('no persistencePath was configured');
    });
  });

  describe('save and load (async)', () => {
    it('persists and reloads entries', async () => {
      cache.set('a.ts', 'hello');
      cache.set('b.ts', 'world');

      await cache.save();

      const restored = new ContentCache(100, tempPath);
      await restored.load();

      expect(restored.size).toBe(2);
      expect(restored.get('a.ts')!.sha256).toBe(computeSha256('hello'));
      expect(restored.get('b.ts')!.sha256).toBe(computeSha256('world'));
    });

    it('returns false when file does not exist', async () => {
      const empty = new ContentCache(100, '/nonexistent/async/cache.json');
      expect(await empty.load()).toBe(false);
    });

    it('throws if no persistencePath', async () => {
      const noPath = new ContentCache(100);
      await expect(noPath.save()).rejects.toThrow('no persistencePath was configured');
      await expect(noPath.load()).rejects.toThrow('no persistencePath was configured');
    });
  });

  describe('setPersistencePath', () => {
    it('updates persistence path after construction', () => {
      const c = new ContentCache(100);
      expect(c.getStats().persistencePath).toBeNull();

      c.setPersistencePath('/tmp/new-path.json');
      expect(c.getStats().persistencePath).toBe('/tmp/new-path.json');
    });

    it('allows save after setting path', () => {
      const c = new ContentCache(100);
      c.setPersistencePath(tempPath);
      c.set('a.ts', 'data');
      c.saveSync();

      expect(fs.existsSync(tempPath)).toBe(true);
    });
  });

  describe('persistence with empty cache', () => {
    it('saves and loads empty cache', () => {
      cache.saveSync();

      const restored = new ContentCache(100, tempPath);
      restored.loadSync();

      expect(restored.size).toBe(0);
    });
  });

  describe('persistence roundtrip large batch', () => {
    it('handles 1000 entries', () => {
      // Use a larger cache to fit all entries
      const bigCache = new ContentCache(2000, tempPath);
      for (let i = 0; i < 1000; i++) {
        bigCache.set(`src/file${i}.ts`, `content number ${i}`);
      }

      bigCache.saveSync();

      const restored = new ContentCache(10000, tempPath);
      restored.loadSync();

      expect(restored.size).toBe(1000);
      expect(restored.get('src/file500.ts')!.sha256).toBe(computeSha256('content number 500'));
    });
  });

  describe('persistence malformed JSON', () => {
    it('throws on malformed JSON', () => {
      fs.writeFileSync(tempPath, 'not valid json{{{', 'utf-8');
      expect(() => cache.loadSync()).toThrow();
      // Cache should be empty after failed load
      expect(cache.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// ContentCache — edge cases
// ---------------------------------------------------------------------------

describe('ContentCache edge cases', () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache(100);
  });

  it('handles file paths with special characters', () => {
    const path = 'src/components/[id]/page.tsx';
    cache.set(path, 'React component');
    expect(cache.get(path)).not.toBeNull();
    expect(cache.has(path, 'React component')).toBe(true);
  });

  it('handles file paths with spaces', () => {
    const path = 'my project/src/main file.ts';
    cache.set(path, 'code');
    expect(cache.get(path)!.sha256).toBe(computeSha256('code'));
  });

  it('handles empty content string', () => {
    cache.set('empty.ts', '');
    expect(cache.get('empty.ts')!.sha256).toBe(computeSha256(''));
    expect(cache.has('empty.ts', '')).toBe(true);
  });

  it('handles binary-like content', () => {
    const binary = String.fromCharCode(0, 1, 2, 3, 255);
    cache.set('binary.bin', binary);
    expect(cache.has('binary.bin', binary)).toBe(true);
  });

  it('handles multiple sets for same path in sequence', () => {
    for (let i = 0; i < 100; i++) {
      cache.set('repeated.ts', `version ${i}`);
    }
    expect(cache.size).toBe(1);
    expect(cache.get('repeated.ts')!.sha256).toBe(computeSha256('version 99'));
  });

  it('size property matches getStats().entries', () => {
    for (let i = 0; i < 50; i++) {
      cache.set(`f${i}.ts`, `c${i}`);
    }
    expect(cache.size).toBe(cache.getStats().entries);
    expect(cache.size).toBe(50);
  });

  it('different paths with same content produce different entries', () => {
    cache.set('a.ts', 'same content');
    cache.set('b.ts', 'same content');
    expect(cache.size).toBe(2);
    expect(cache.get('a.ts')!.sha256).toBe(cache.get('b.ts')!.sha256);
  });
});

// ---------------------------------------------------------------------------
// ContentCache — large batch handling
// ---------------------------------------------------------------------------

describe('ContentCache large batch', () => {
  it('handles 10,000 sequential sets efficiently', () => {
    const cache = new ContentCache(20_000);

    for (let i = 0; i < 10_000; i++) {
      cache.set(`file${i}.ts`, `content ${i}`);
    }

    expect(cache.size).toBe(10_000);

    // Spot-check random entries
    expect(cache.get('file0.ts')!.sha256).toBe(computeSha256('content 0'));
    expect(cache.get('file9999.ts')!.sha256).toBe(computeSha256('content 9999'));
    expect(cache.get('file5000.ts')!.sha256).toBe(computeSha256('content 5000'));
  });

  it('handles eviction under load correctly', () => {
    const cache = new ContentCache(500);

    for (let i = 0; i < 1_000; i++) {
      cache.set(`file${i}.ts`, `content ${i}`);
    }

    expect(cache.size).toBe(500);
    // Oldest entries should be evicted
    expect(cache.get('file0.ts')).toBeNull();
    // Newest entries should survive
    expect(cache.get('file999.ts')).not.toBeNull();
  });
});
