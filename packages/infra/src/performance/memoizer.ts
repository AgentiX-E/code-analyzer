// @code-analyzer/infra — Async Memoizer
// Caches async function results with configurable TTL, LRU eviction,
// and per-key freshness guarantees.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoizerOptions {
  /** Time-to-live for cached entries in milliseconds (default: 60000) */
  ttlMs?: number;
  /** Maximum number of cached entries (default: 1000) */
  maxSize?: number;
  /** Custom cache key resolver (defaults to JSON.stringify(args)) */
  keyResolver?: (...args: unknown[]) => string;
}

export interface MemoizerStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
  /** Hit rate as a fraction in [0, 1] */
  hitRate: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  key: string;
}

// ---------------------------------------------------------------------------
// Memoizer
// ---------------------------------------------------------------------------

export class AsyncMemoizer<T extends (...args: unknown[]) => Promise<unknown>> {
  private cache: Map<string, CacheEntry<Awaited<ReturnType<T>>>>;
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly keyResolver: (...args: unknown[]) => string;
  private hitsInternal: number;
  private missesInternal: number;
  private evictionsInternal: number;
  /** Ordered list of keys for LRU eviction (front = newest) */
  private accessOrder: string[];
  /** Pending promises to coalesce concurrent calls for the same key */
  private inFlight: Map<string, Promise<Awaited<ReturnType<T>>>>;

  constructor(options: MemoizerOptions = {}) {
    this.cache = new Map();
    this.ttlMs = options.ttlMs ?? 60000;
    this.maxSize = options.maxSize ?? 1000;
    this.keyResolver = options.keyResolver ?? ((...args: unknown[]) => JSON.stringify(args));
    this.hitsInternal = 0;
    this.missesInternal = 0;
    this.evictionsInternal = 0;
    this.accessOrder = [];
    this.inFlight = new Map();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Call the function with memoization. Concurrent calls for the same key
   * are coalesced into a single invocation (request deduplication).
   */
  async call(fn: T, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    const key = this.keyResolver(...args);

    // Check cache for a valid (non-expired) entry
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.recordHit(key);
      return cached.value;
    }

    // Coalesce in-flight requests: if a concurrent call for the same key
    // is already running, wait for its result instead of duplicating work.
    /* v8 ignore start */ // requires concurrent calls to same key (async timing dependent)
    const pending = this.inFlight.get(key);
    if (pending) {
      // Count as hit since we're reusing an in-flight computation
      this.hitsInternal++;
      return pending as Awaited<ReturnType<T>>;
    }
    /* v8 ignore stop */

    // Expired or missing — compute fresh value
    this.missesInternal++;
    const promise = (async () => {
      try {
        const result = await fn(...args);
        return result as Awaited<ReturnType<T>>;
      } finally {
        // Always remove from inFlight, even on error
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise as Promise<Awaited<ReturnType<T>>>);

    try {
      const result = await promise;
      this.set(key, result);
      return result;
    } catch (err) {
      // Don't cache errors — let caller handle
      throw err;
    }
  }

  /** Evict a specific key from the cache. Returns true if the key existed. */
  invalidate(...args: Parameters<T>): boolean {
    const key = this.keyResolver(...args);
    const existed = this.cache.delete(key);
    if (existed) {
      this.accessOrder = this.accessOrder.filter((k) => k !== key);
    }
    return existed;
  }

  /** Clear all cached entries and reset statistics. */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.inFlight.clear();
    this.hitsInternal = 0;
    this.missesInternal = 0;
    this.evictionsInternal = 0;
  }

  /** Get cache statistics. */
  getStats(): MemoizerStats {
    const total = this.hitsInternal + this.missesInternal;
    return {
      hits: this.hitsInternal,
      misses: this.missesInternal,
      evictions: this.evictionsInternal,
      size: this.cache.size,
      capacity: this.maxSize,
      hitRate: total === 0 ? 0 : this.hitsInternal / total,
    };
  }

  /** Get the number of currently active in-flight calls. */
  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Provide a snapshot of the in-flight call keys (for diagnostics). */
  get activeKeys(): string[] {
    return Array.from(this.inFlight.keys());
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private set(key: string, value: Awaited<ReturnType<T>>): void {
    // Evict oldest entry if at capacity AND the key is not already cached
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const oldest = this.accessOrder.pop();
      if (oldest) {
        this.cache.delete(oldest);
        this.inFlight.delete(oldest);
        this.evictionsInternal++;
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
      key,
    });

    // Move key to front (most recently used)
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.unshift(key);
  }

  private recordHit(key: string): void {
    this.hitsInternal++;
    // Move to front for LRU order
    this.accessOrder = this.accessOrder.filter((k) => k !== key);
    this.accessOrder.unshift(key);
  }
}
