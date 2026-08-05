// @code-analyzer/core — High-Performance LRU Cache
// Generic LRU (Least Recently Used) cache with configurable bounds,
// TTL expiration, and eviction callbacks. Designed for hot-path usage
// in parse, graph query, embedding, and LSP resolution pipelines.
//
// Characteristics:
//   - O(1) get/set/delete via double-linked list + hash map
//   - Configurable maxSize (item count or byte budget)
//   - Per-entry TTL with lazy and proactive expiration
//   - Eviction callback for resource cleanup (e.g., closing handles)
//   - Thread-safe statistics (hit rate, miss rate, eviction count)
//   - Memory-budget mode: track approximate entry sizes for cap

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cache entry with metadata. */
interface CacheEntry<K, V> {
  key: K;
  value: V;
  /** Approximate size in bytes (for memory-budget mode). */
  size: number;
  /** Expiration timestamp (ms since epoch), or Infinity for no expiry. */
  expiresAt: number;
  /** Previous entry in the LRU list (more recently used). */
  prev: CacheEntry<K, V> | null;
  /** Next entry in the LRU list (less recently used). */
  next: CacheEntry<K, V> | null;
}

/** LRU cache configuration. */
export interface LRUCacheConfig {
  /** Maximum number of entries (default: 10000). */
  maxSize: number;
  /** Maximum memory budget in bytes (overrides maxSize when set). */
  maxBytes?: number;
  /** TTL in milliseconds for each entry (default: no expiry). */
  ttl?: number;
  /** Interval in ms for proactive expiry sweep (default: no sweep). */
  sweepInterval?: number;
  /** Called when an entry is evicted. */
  onEvict?: (key: unknown, value: unknown) => void;
}

/** LRU cache statistics. */
export interface LRUCacheStats {
  /** Current entry count. */
  size: number;
  /** Maximum allowed entries. */
  maxSize: number;
  /** Estimated memory usage in bytes. */
  estimatedBytes: number;
  /** Cumulative hits. */
  hits: number;
  /** Cumulative misses. */
  misses: number;
  /** Cumulative evictions. */
  evictions: number;
  /** Cumulative expirations (TTL-based). */
  expirations: number;
  /** Hit rate (hits / (hits + misses)). */
  hitRate: number;
}

// ---------------------------------------------------------------------------
// LRU Cache Implementation
// ---------------------------------------------------------------------------

export class LRUCache<K = string, V = unknown> {
  // Double-linked list for LRU order (head = MRU, tail = LRU)
  private head: CacheEntry<K, V> | null = null;
  private tail: CacheEntry<K, V> | null = null;

  // Hash map for O(1) lookup
  private store = new Map<K, CacheEntry<K, V>>();

  // Configuration
  private maxSize: number;
  private maxBytes: number;
  private ttl: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private onEvict: ((key: unknown, value: unknown) => void) | null;

  // Statistics
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _expirations = 0;
  private _currentBytes = 0;

  constructor(config?: Partial<LRUCacheConfig>) {
    this.maxSize = config?.maxSize ?? 10000;
    this.maxBytes = config?.maxBytes ?? 0;
    this.ttl = config?.ttl ?? 0;
    this.onEvict = config?.onEvict ?? null;

    // Proactive sweep
    if (config?.sweepInterval && config.sweepInterval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), config.sweepInterval);
      if (this.sweepTimer && typeof this.sweepTimer === 'object' && 'unref' in this.sweepTimer) {
        (this.sweepTimer as NodeJS.Timeout).unref();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Core Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a value from the cache. Returns undefined if not found or expired.
   * Moves the entry to the head (MRU position).
   */
  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check expiration
    if (this.isExpired(entry)) {
      this.removeEntry(entry);
      this._expirations++;
      this._misses++;
      return undefined;
    }

    // Move to head (MRU)
    this.moveToHead(entry);
    this._hits++;
    return entry.value;
  }

  /**
   * Set a value in the cache. Moves entry to head.
   * @param key — Cache key
   * @param value — Value to store
   * @param ttlOverride — Optional per-entry TTL in ms (overrides global TTL)
   */
  set(key: K, value: V, ttlOverride?: number): void {
    const existing = this.store.get(key);

    if (existing) {
      // Update existing entry
      existing.value = value;
      const ttlMs = ttlOverride ?? this.ttl;
      existing.expiresAt = ttlMs > 0 ? Date.now() + ttlMs : Infinity;
      existing.size = this.estimateSize(value);
      this.moveToHead(existing);
      return;
    }

    // Create new entry
    const ttlMs = ttlOverride ?? this.ttl;
    const entry: CacheEntry<K, V> = {
      key,
      value,
      size: this.estimateSize(value),
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : Infinity,
      prev: null,
      next: null,
    };

    this.store.set(key, entry);
    this.addToHead(entry);
    this._currentBytes += entry.size;

    // Evict if over capacity
    this.evictIfNeeded();
  }

  /**
   * Delete a key from the cache.
   * @returns true if the key was found and deleted
   */
  delete(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.removeEntry(entry);
    return true;
  }

  /**
   * Check if a key exists in the cache and is not expired.
   */
  has(key: K): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.removeEntry(entry);
      this._expirations++;
      return false;
    }
    return true;
  }

  /**
   * Get a value without updating LRU order (peek).
   */
  peek(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) return undefined;
    return entry.value;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    let entry = this.head;
    while (entry) {
      if (this.onEvict) this.onEvict(entry.key, entry.value);
      entry = entry.next;
    }
    this.store.clear();
    this.head = null;
    this.tail = null;
    this._currentBytes = 0;
  }

  /**
   * Get an existing entry's value or compute+store it if missing.
   */
  getOrSet(key: K, factory: () => V, ttlOverride?: number): V {
    const existing = this.get(key);
    if (existing !== undefined) return existing;

    const value = factory();
    this.set(key, value, ttlOverride);
    return value;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  get stats(): LRUCacheStats {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      estimatedBytes: this._currentBytes,
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      expirations: this._expirations,
      hitRate: this._hits + this._misses > 0
        ? this._hits / (this._hits + this._misses)
        : 0,
    };
  }

  get size(): number {
    return this.store.size;
  }

  /** Reset statistics counters (not entries). */
  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
    this._expirations = 0;
  }

  // ---------------------------------------------------------------------------
  // Iteration
  // ---------------------------------------------------------------------------

  /** Iterate over all non-expired entries in insertion order. */
  *[Symbol.iterator](): IterableIterator<[K, V]> {
    let entry = this.head;
    while (entry) {
      if (!this.isExpired(entry)) {
        yield [entry.key, entry.value];
      }
      entry = entry.next;
    }
  }

  /** Iterate keys. */
  keys(): IterableIterator<K> {
    const self = this;
    return (function* () {
      let entry = self.head;
      while (entry) {
        if (!self.isExpired(entry)) yield entry.key;
        entry = entry.next;
      }
    })();
  }

  /** Iterate values. */
  values(): IterableIterator<V> {
    const self = this;
    return (function* () {
      let entry = self.head;
      while (entry) {
        if (!self.isExpired(entry)) yield entry.value;
        entry = entry.next;
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------

  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.clear();
  }

  // ---------------------------------------------------------------------------
  // Private: LRU Operations
  // ---------------------------------------------------------------------------

  private addToHead(entry: CacheEntry<K, V>): void {
    entry.prev = null;
    entry.next = this.head;

    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;

    if (!this.tail) {
      this.tail = entry;
    }
  }

  private moveToHead(entry: CacheEntry<K, V>): void {
    if (entry === this.head) return;

    // Remove from current position
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (entry === this.tail) this.tail = entry.prev;

    // Add to head
    entry.prev = null;
    entry.next = this.head;
    if (this.head) this.head.prev = entry;
    this.head = entry;

    if (!this.tail) this.tail = entry;
  }

  private removeEntry(entry: CacheEntry<K, V>): void {
    // Remove from linked list
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (entry === this.head) this.head = entry.next;
    if (entry === this.tail) this.tail = entry.prev;

    // Remove from store
    this.store.delete(entry.key);

    // Track memory
    this._currentBytes -= entry.size;
    if (this._currentBytes < 0) this._currentBytes = 0;

    // Eviction callback
    if (this.onEvict) this.onEvict(entry.key, entry.value);
  }

  private evictIfNeeded(): void {
    const now = Date.now();

    // First, remove expired entries from the tail
    while (this.tail && this.tail.expiresAt <= now) {
      const entry = this.tail;
      this.removeEntry(entry);
      this._expirations++;
    }

    // Then, evict LRU entries until within limits
    while (this.shouldEvict()) {
      if (!this.tail) break; // safety
      const entry = this.tail;
      this.removeEntry(entry);
      this._evictions++;
    }
  }

  private shouldEvict(): boolean {
    if (this.maxBytes > 0 && this._currentBytes > this.maxBytes) return true;
    if (this.store.size > this.maxSize) return true;
    return false;
  }

  private isExpired(entry: CacheEntry<K, V>): boolean {
    return entry.expiresAt <= Date.now();
  }

  /** Proactive sweep: remove all expired entries. */
  private sweep(): void {
    let entry = this.tail;
    while (entry) {
      const prev = entry.prev;
      if (this.isExpired(entry)) {
        this.removeEntry(entry);
        this._expirations++;
      }
      entry = prev;
    }
  }

  /** Rough estimate of a value's memory footprint in bytes. */
  private estimateSize(value: V): number {
    if (value === null || value === undefined) return 8;
    if (typeof value === 'string') return value.length * 2 + 32;
    if (typeof value === 'number' || typeof value === 'boolean') return 8;
    if (ArrayBuffer.isView(value)) return (value as ArrayBufferView).byteLength + 32;
    // Conservative estimate for objects
    return 64;
  }
}
