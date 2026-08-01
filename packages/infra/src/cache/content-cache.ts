// @code-analyzer/infra — Content Cache
// SHA-256 content-addressed file cache with LRU eviction and JSON persistence.
// Thread safety: single-writer, multi-reader pattern. Not safe for concurrent
// writes from multiple threads/workers. Use only from the main thread.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Cache entry: records the file's content hash and when it was last parsed. */
export interface ContentCacheEntry {
  sha256: string;
  parsedAt: number;
}

/** Statistics about the content cache. */
export interface ContentCacheStats {
  entries: number;
  maxEntries: number;
  hitCount: number;
  missCount: number;
  evictionCount: number;
  persistencePath: string | null;
}

/** Serialized form for JSON persistence. */
interface SerializedCache {
  version: 1;
  maxEntries: number;
  entries: Array<[string, ContentCacheEntry]>;
}

const SERIALIZED_VERSION = 1 as const;

/** Compute SHA-256 hex hash of the given content. */
export function computeSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Content-addressed file cache keyed by file path.
 *
 * On `has(path, content)`: if the path exists in the cache AND the stored
 * SHA-256 matches `computeSha256(content)`, returns true (cache hit).
 * On `set(path, content)`: stores the SHA-256 of the content with a timestamp.
 *
 * ### Thread Safety
 *
 * This cache implements a **single-writer, multi-reader** pattern. It is NOT
 * safe for concurrent writes. All modifications (`set`, `invalidate`, `clear`,
 * `save`) must be serialised through a single thread. Concurrent reads via
 * `has`, `get`, and `getStats` from multiple workers are safe because they
 * only access the underlying `Map` without mutation.
 *
 * For multi-worker scenarios, place cache update logic behind a message queue
 * or use a single coordinator thread.
 */
export class ContentCache {
  private readonly cache: Map<string, ContentCacheEntry>;
  private readonly maxEntries: number;
  private readonly lruQueue: string[];
  private persistencePath: string | null;
  private hitCount: number;
  private missCount: number;
  private evictionCount: number;

  /**
   * Create a new ContentCache.
   * @param maxEntries - Maximum entries before LRU eviction (default 50,000).
   * @param persistencePath - Optional file path for save/load persistence.
   */
  constructor(maxEntries: number = 50_000, persistencePath?: string) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.lruQueue = [];
    this.persistencePath = persistencePath ?? null;
    this.hitCount = 0;
    this.missCount = 0;
    this.evictionCount = 0;
  }

  /**
   * Check whether the cache has a fresh entry for a file path.
   * Returns true only if the path is cached AND the stored SHA-256 matches
   * the SHA-256 of the given content. Increments hit/miss counters.
   */
  has(filePath: string, content: string): boolean {
    const entry = this.cache.get(filePath);
    if (!entry) {
      this.missCount++;
      return false;
    }

    const hash = computeSha256(content);
    if (entry.sha256 !== hash) {
      // Content changed — old entry is stale but we don't auto-invalidate
      // to let the caller decide what to do.
      this.missCount++;
      return false;
    }

    this.touch(filePath);
    this.hitCount++;
    return true;
  }

  /**
   * Store content hash for a file path. Overwrites any existing entry for
   * the same path. Evicts LRU entries if the cache exceeds maxEntries.
   */
  set(filePath: string, content: string): void {
    const sha256 = computeSha256(content);
    const entry: ContentCacheEntry = {
      sha256,
      parsedAt: Date.now(),
    };

    // Remove old LRU position if already exists
    this.removeFromLRU(filePath);
    this.lruQueue.push(filePath);
    this.cache.set(filePath, entry);

    this.evictIfNeeded();
  }

  /**
   * Get the cache entry for a file path, or null if not cached.
   * Does NOT check content freshness — only returns the stored entry.
   * Use `has(filePath, content)` to verify content matches.
   */
  get(filePath: string): ContentCacheEntry | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;
    this.touch(filePath);
    return { ...entry };
  }

  /**
   * Remove a specific file path from the cache.
   */
  invalidate(filePath: string): boolean {
    if (!this.cache.has(filePath)) return false;
    this.cache.delete(filePath);
    this.removeFromLRU(filePath);
    return true;
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
    this.lruQueue.length = 0;
  }

  /**
   * Get the raw SHA-256 hash stored for a file path, or null.
   * Same as get() but returns only the hash string.
   */
  getHash(filePath: string): string | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;
    this.touch(filePath);
    return entry.sha256;
  }

  /**
   * Get statistics about the cache state.
   */
  getStats(): ContentCacheStats {
    return {
      entries: this.cache.size,
      maxEntries: this.maxEntries,
      hitCount: this.hitCount,
      missCount: this.missCount,
      evictionCount: this.evictionCount,
      persistencePath: this.persistencePath,
    };
  }

  /**
   * The number of entries currently in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /**
   * Serialize the cache to a JSON file for persistence across runs.
   * Throws if no persistencePath was set in the constructor.
   */
  async save(): Promise<void> {
    if (!this.persistencePath) {
      throw new Error('ContentCache.save() called but no persistencePath was configured');
    }

    const serialized: SerializedCache = {
      version: SERIALIZED_VERSION,
      maxEntries: this.maxEntries,
      entries: Array.from(this.cache.entries()),
    };

    const dir = path.dirname(this.persistencePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(serialized);
    fs.writeFileSync(this.persistencePath, json, 'utf-8');
  }

  /**
   * Load the cache from a JSON file previously created with save().
   * Returns true if the file was loaded, false if it didn't exist.
   * Throws if no persistencePath was set.
   */
  async load(): Promise<boolean> {
    if (!this.persistencePath) {
      throw new Error('ContentCache.load() called but no persistencePath was configured');
    }

    if (!fs.existsSync(this.persistencePath)) {
      return false;
    }

    const json = fs.readFileSync(this.persistencePath, 'utf-8');
    const serialized: SerializedCache = JSON.parse(json);

    if (serialized.version !== SERIALIZED_VERSION) {
      // Unknown version — start fresh
      return false;
    }

    this.clear();

    // Load entries, respecting maxEntries (in case config changed)
    const sorted = serialized.entries.sort((a, b) => b[1].parsedAt - a[1].parsedAt);
    for (const [filePath, entry] of sorted) {
      /* v8 ignore next */ // defensive: break when cache reaches max capacity
      if (this.cache.size >= this.maxEntries) break;
      this.cache.set(filePath, entry);
      this.lruQueue.push(filePath);
    }

    return true;
  }

  /**
   * Persist the cache synchronously (non-blocking for small/medium caches).
   * Throws if no persistencePath was configured.
   */
  saveSync(): void {
    if (!this.persistencePath) {
      throw new Error('ContentCache.saveSync() called but no persistencePath was configured');
    }

    const serialized: SerializedCache = {
      version: SERIALIZED_VERSION,
      maxEntries: this.maxEntries,
      entries: Array.from(this.cache.entries()),
    };

    const dir = path.dirname(this.persistencePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.persistencePath, JSON.stringify(serialized), 'utf-8');
  }

  /**
   * Synchronous version of load().
   */
  loadSync(): boolean {
    if (!this.persistencePath) {
      throw new Error('ContentCache.loadSync() called but no persistencePath was configured');
    }

    if (!fs.existsSync(this.persistencePath)) {
      return false;
    }

    const json = fs.readFileSync(this.persistencePath, 'utf-8');
    const serialized: SerializedCache = JSON.parse(json);

    if (serialized.version !== SERIALIZED_VERSION) {
      return false;
    }

    this.clear();

    const sorted = serialized.entries.sort((a, b) => b[1].parsedAt - a[1].parsedAt);
    for (const [filePath, entry] of sorted) {
      if (this.cache.size >= this.maxEntries) break;
      this.cache.set(filePath, entry);
      this.lruQueue.push(filePath);
    }

    return true;
  }

  /**
   * Set the persistence path (useful after construction).
   */
  setPersistencePath(filePath: string): void {
    this.persistencePath = filePath;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private touch(filePath: string): void {
    this.removeFromLRU(filePath);
    this.lruQueue.push(filePath);
  }

  private removeFromLRU(filePath: string): void {
    const idx = this.lruQueue.indexOf(filePath);
    if (idx >= 0) {
      this.lruQueue.splice(idx, 1);
    }
  }

  private evictIfNeeded(): void {
    while (this.cache.size > this.maxEntries && this.lruQueue.length > 0) {
      const oldest = this.lruQueue.shift();
      if (oldest !== undefined && this.cache.has(oldest)) {
        this.cache.delete(oldest);
        this.evictionCount++;
      }
    }
  }
}
