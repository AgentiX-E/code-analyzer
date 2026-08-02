// @code-analyzer/infra — Parse Cache
// LRU-based parse cache with content hashing using SHA-256.

import { createHash } from 'node:crypto';

import type { ParsedFile } from '@code-analyzer/shared';

export interface ParseCache {
  get(hash: string): ParsedFile | null;
  set(hash: string, file: ParsedFile): void;
  has(hash: string): boolean;
  invalidate(filePath: string): void;
  clear(): void;
  /** Pre-warm the cache with frequently accessed file paths and contents.
   *  Computes hashes and stores entries without full parse results —
   *  useful for cache-hit optimization before a full pipeline run. */
  prewarm(entries: Array<{ content: string; filePath: string }>): void;
  readonly size: number;
  /** Current cache hit rate as a fraction (0–1) */
  getHitRate(): number;
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function createParseCache(maxSize: number = 1000): ParseCache {
  const cache = new Map<string, ParsedFile>();
  const accessOrder: string[] = []; // LRU queue
  let totalGets = 0;
  let cacheHits = 0;

  function evictIfNeeded(): void {
    while (cache.size > maxSize && accessOrder.length > 0) {
      // accessOrder.length > 0 is guaranteed by the while condition,
      // so shift() always returns a defined value.
      const oldest = accessOrder.shift()!;
      cache.delete(oldest);
    }
  }

  function touch(hash: string): void {
    const idx = accessOrder.indexOf(hash);
    if (idx >= 0) {
      accessOrder.splice(idx, 1);
    }
    accessOrder.push(hash);
  }

  return {
    get(hash: string): ParsedFile | null {
      totalGets++;
      const entry = cache.get(hash);
      if (entry) {
        cacheHits++;
        touch(hash);
      }
      return entry ?? null;
    },

    set(hash: string, file: ParsedFile): void {
      touch(hash);
      cache.set(hash, file);
      evictIfNeeded();
    },

    has(hash: string): boolean {
      return cache.has(hash);
    },

    invalidate(filePath: string): void {
      for (const [hash, file] of cache) {
        if (file.filePath === filePath) {
          cache.delete(hash);
        }
      }
    },

    clear(): void {
      cache.clear();
      accessOrder.length = 0;
      totalGets = 0;
      cacheHits = 0;
    },

    prewarm(entries: Array<{ content: string; filePath: string }>): void {
      for (const entry of entries) {
        const hash = computeContentHash(entry.content);
        if (!cache.has(hash)) {
          // Store a lightweight placeholder — actual parse results will overwrite
          const placeholder: ParsedFile = {
            filePath: entry.filePath,
            language: '' as never,
            symbols: [],
            references: [],
            scopeTree: { name: entry.filePath, kind: 'File', startLine: 1, endLine: 1, children: [], symbols: [] },
            ast: [],
          };
          this.set(hash, placeholder);
        }
      }
    },

    getHitRate(): number {
      /* v8 ignore next */ // defensive: division by zero
      return totalGets > 0 ? cacheHits / totalGets : 0;
    },

    get size(): number {
      return cache.size;
    },
  };
}
