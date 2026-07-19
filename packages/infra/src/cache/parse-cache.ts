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
  readonly size: number;
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function createParseCache(maxSize: number = 1000): ParseCache {
  const cache = new Map<string, ParsedFile>();
  const accessOrder: string[] = []; // LRU queue

  function evictIfNeeded(): void {
    while (cache.size > maxSize && accessOrder.length > 0) {
      const oldest = accessOrder.shift();
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
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
      const entry = cache.get(hash);
      if (entry) {
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
    },

    get size(): number {
      return cache.size;
    },
  };
}
