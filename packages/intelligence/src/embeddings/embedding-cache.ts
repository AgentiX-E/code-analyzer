// @code-analyzer/intelligence — Embedding Cache
// LRU-based caching layer for vector embeddings with content-hash-based
// invalidation. Dramatically reduces re-embedding cost for repeated queries
// and incremental reindexing.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedEmbedding {
  /** The embedding vector as Float32Array for efficient storage and computation. */
  vector: Float32Array;
  /** Content hash (SHA-256) of the source text that produced this embedding. */
  contentHash: string;
  /** Timestamp when this embedding was cached (epoch ms). */
  cachedAt: number;
  /** Number of times this cached embedding has been accessed. */
  accessCount: number;
  /** The source text length (for statistics). */
  sourceLength: number;
}

export interface EmbeddingCacheStats {
  /** Total number of cached entries. */
  size: number;
  /** Maximum cache capacity. */
  capacity: number;
  /** Number of cache hits since creation. */
  hits: number;
  /** Number of cache misses since creation. */
  misses: number;
  /** Hit rate as a fraction (0-1). */
  hitRate: number;
  /** Total number of evictions since creation. */
  evictions: number;
  /** Total estimated memory usage in bytes. */
  estimatedMemoryBytes: number;
}

export interface EmbeddingCacheOptions {
  /** Maximum number of entries in the cache (default: 10000). */
  maxEntries: number;
  /** Time-to-live in milliseconds (0 = no expiry, default: 0). */
  ttl: number;
  /** Whether to track access counts (default: true). */
  trackAccessCounts: boolean;
}

// ---------------------------------------------------------------------------
// LRU Node
// ---------------------------------------------------------------------------

interface LRUNode {
  key: string;
  embedding: CachedEmbedding;
  prev: LRUNode | null;
  next: LRUNode | null;
}

// ---------------------------------------------------------------------------
// EmbeddingCache
// ---------------------------------------------------------------------------

export class EmbeddingCache {
  private readonly maxEntries: number;
  private readonly ttl: number;
  private readonly trackAccess: boolean;
  private readonly map = new Map<string, LRUNode>();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options: Partial<EmbeddingCacheOptions> = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.ttl = options.ttl ?? 0;
    this.trackAccess = options.trackAccessCounts ?? true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get a cached embedding by key.
   * Returns undefined on cache miss or expired entry.
   * Moves the entry to the front of the LRU list on hit.
   */
  get(key: string, expectedHash?: string): CachedEmbedding | undefined {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }

    // Check TTL expiry
    if (this.ttl > 0) {
      const age = Date.now() - node.embedding.cachedAt;
      if (age > this.ttl) {
        this.removeNode(node);
        this.evictions++;
        this.misses++;
        return undefined;
      }
    }

    // Check content hash match if provided
    if (expectedHash && node.embedding.contentHash !== expectedHash) {
      this.removeNode(node);
      this.evictions++;
      this.misses++;
      return undefined;
    }

    // Move to front (most recently used)
    this.moveToFront(node);
    this.hits++;

    if (this.trackAccess) {
      node.embedding.accessCount++;
    }

    return node.embedding;
  }

  /**
   * Store an embedding in the cache.
   * Evicts the least recently used entry if the cache is full.
   *
   * @param key — unique key for this embedding (e.g., node ID)
   * @param vector — the embedding vector
   * @param contentHash — SHA-256 hash of the source content
   * @param sourceLength — length of the source text (for stats)
   */
  set(key: string, vector: Float32Array, contentHash: string, sourceLength = 0): void {
    // If key already exists, update it
    const existing = this.map.get(key);
    if (existing) {
      existing.embedding = {
        vector,
        contentHash,
        cachedAt: Date.now(),
        accessCount: existing.embedding.accessCount,
        sourceLength,
      };
      this.moveToFront(existing);
      return;
    }

    // Evict LRU if at capacity
    if (this.map.size >= this.maxEntries) {
      this.evictLRU();
    }

    // Create new entry
    const node: LRUNode = {
      key,
      embedding: {
        vector,
        contentHash,
        cachedAt: Date.now(),
        accessCount: 0,
        sourceLength,
      },
      prev: null,
      next: null,
    };

    this.map.set(key, node);
    this.addToFront(node);
  }

  /**
   * Check if a key exists in the cache with an up-to-date hash.
   */
  has(key: string, expectedHash?: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    if (this.ttl > 0) {
      const age = Date.now() - node.embedding.cachedAt;
      if (age > this.ttl) return false;
    }

    if (expectedHash && node.embedding.contentHash !== expectedHash) {
      return false;
    }

    return true;
  }

  /**
   * Remove a specific entry from the cache.
   */
  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    return true;
  }

  /**
   * Invalidate all cache entries whose key contains the given substring.
   * Useful for invalidating all embeddings for a specific file.
   */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const [key] of this.map) {
      if (key.startsWith(prefix)) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Invalidate all cache entries whose content hash matches.
   * Useful for invalidating stale embeddings after source changes.
   */
  invalidateByHash(contentHash: string): number {
    let count = 0;
    for (const [key, node] of this.map) {
      if (node.embedding.contentHash === contentHash) {
        this.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Remove all entries from the cache.
   */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Clear only the statistics counters, keeping cached data.
   */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /**
   * Get the current cache size.
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Get the maximum cache capacity.
   */
  get capacity(): number {
    return this.maxEntries;
  }

  /**
   * Get comprehensive cache statistics.
   */
  getStats(): EmbeddingCacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    let estimatedMemoryBytes = 0;
    for (const node of this.map.values()) {
      estimatedMemoryBytes +=
        node.embedding.vector.byteLength + node.embedding.contentHash.length + 100;
    }

    return {
      size: this.map.size,
      capacity: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: Math.round(hitRate * 1000) / 1000,
      evictions: this.evictions,
      estimatedMemoryBytes,
    };
  }

  /**
   * Get all keys currently in the cache.
   */
  keys(): string[] {
    return [...this.map.keys()];
  }

  /**
   * Iterate over all cached entries (oldest to newest).
   */
  *[Symbol.iterator](): IterableIterator<[string, CachedEmbedding]> {
    let current = this.tail;
    while (current) {
      yield [current.key, current.embedding];
      current = current.prev;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private addToFront(node: LRUNode): void {
    if (!this.head) {
      this.head = node;
      this.tail = node;
      return;
    }
    node.next = this.head;
    this.head.prev = node;
    this.head = node;
  }

  private moveToFront(node: LRUNode): void {
    if (node === this.head) return;

    // Remove from current position
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    // Add to front
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;

    if (!this.tail) this.tail = node;
  }

  private removeNode(node: LRUNode): void {
    this.map.delete(node.key);

    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  private evictLRU(): void {
    if (this.tail) {
      this.removeNode(this.tail);
      this.evictions++;
    }
  }
}
