// @code-analyzer/analyzer — Parse Cache
// Caches parsed file results keyed by (filePath, fingerprint) to avoid
// re-parsing unchanged files. Uses LRU eviction to bound memory usage.

import { createHash } from 'node:crypto';
import { LRUCache } from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry {
  fingerprint: string;
  captures: UnifiedCapture[];
  timestamp: number;
}

export interface ParseCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
  hitRate: number;
}

// ---------------------------------------------------------------------------
// Fingerprint Computation
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 fingerprint of file content for cache invalidation.
 * Uses only the first 4 bytes of the hash for speed (collision rate is
 * negligible for cache invalidation purposes).
 */
function computeFingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// ParseCache
// ---------------------------------------------------------------------------

/**
 * Thread-safe parse result cache with fingerprint-based invalidation.
 *
 * A file is considered "cached" when both:
 *   1. Its path is present in the cache.
 *   2. The stored fingerprint matches the current file content.
 *
 * Memory is bounded by the LRU capacity (default: 10,000 entries).
 * Stale entries (different fingerprints) are transparently evicted on access.
 */
export class ParseCache {
  private readonly cache: LRUCache<string, CacheEntry>;

  constructor(capacity: number = 10000) {
    this.cache = new LRUCache<string, CacheEntry>(capacity);
  }

  /**
   * Try to retrieve cached parse results for a file.
   * Returns null if not cached or fingerprint mismatch (stale).
   */
  get(filePath: string, content: string): UnifiedCapture[] | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    const fingerprint = computeFingerprint(content);
    if (entry.fingerprint !== fingerprint) {
      // Stale entry — remove it
      this.cache.delete(filePath);
      return null;
    }

    return entry.captures;
  }

  /**
   * Store parse results for a file, keyed by its content fingerprint.
   */
  set(filePath: string, content: string, captures: UnifiedCapture[]): void {
    const entry: CacheEntry = {
      fingerprint: computeFingerprint(content),
      captures,
      timestamp: Date.now(),
    };
    this.cache.set(filePath, entry);
  }

  /**
   * Check if a file is cached with a fresh fingerprint.
   */
  has(filePath: string, content: string): boolean {
    const entry = this.cache.get(filePath);
    if (!entry) return false;
    return entry.fingerprint === computeFingerprint(content);
  }

  /**
   * Invalidate a single file entry.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Invalidate all entries matching a path prefix (e.g., a directory).
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Remove all cached entries. */
  clear(): void {
    this.cache.clear();
  }

  /** Get cache statistics. */
  get stats(): ParseCacheStats {
    const s = this.cache.stats;
    return {
      hits: s.hits,
      misses: s.misses,
      evictions: s.evictions,
      size: s.size,
      capacity: s.capacity,
      hitRate: this.cache.hitRate,
    };
  }

  /** Number of cached entries. */
  get size(): number {
    return this.cache.size;
  }

  /** Maximum cache capacity. */
  get capacity(): number {
    return this.cache.capacity;
  }
}
