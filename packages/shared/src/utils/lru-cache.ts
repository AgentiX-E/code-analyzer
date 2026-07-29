// @code-analyzer/shared — LRU Cache
// A bounded least-recently-used cache with O(1) get/set operations
// suitable for parse results, embeddings, and query deduplication.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cache entry statistics (optional) */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  capacity: number;
}

// ---------------------------------------------------------------------------
// Doubly-linked list node
// ---------------------------------------------------------------------------

interface ListNode<K, V> {
  key: K;
  value: V;
  prev: ListNode<K, V> | null;
  next: ListNode<K, V> | null;
}

// ---------------------------------------------------------------------------
// LRU Cache Implementation
// ---------------------------------------------------------------------------

/**
 * Generic LRU (Least Recently Used) cache with configurable capacity.
 * Operations are O(1): get, set, has, delete, clear.
 *
 * When capacity is exceeded, the least recently accessed entry is evicted.
 */
export class LRUCache<K = string, V = unknown> {
  private readonly map = new Map<K, ListNode<K, V>>();
  private head: ListNode<K, V> | null = null;
  private tail: ListNode<K, V> | null = null;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;
  private _capacity: number;

  constructor(capacity: number = 1000) {
    if (capacity <= 0) {
      throw new Error('LRU cache capacity must be > 0');
    }
    this._capacity = capacity;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Retrieve a value by key. Returns undefined if not found. */
  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      this._misses++;
      return undefined;
    }
    this._hits++;
    this.moveToHead(node);
    return node.value;
  }

  /** Set a key-value pair. Evicts LRU entry if capacity exceeded. */
  set(key: K, value: V): void {
    const existing = this.map.get(key);
    if (existing) {
      existing.value = value;
      this.moveToHead(existing);
      return;
    }

    const node: ListNode<K, V> = {
      key,
      value,
      prev: null,
      next: null,
    };

    // Evict if at capacity
    if (this.map.size >= this._capacity) {
      this.evictLRU();
    }

    this.addToHead(node);
    this.map.set(key, node);
  }

  /** Check if a key exists in the cache. */
  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Remove a key from the cache. Returns true if the key existed. */
  delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNode(node);
    this.map.delete(key);
    return true;
  }

  /** Remove all entries from the cache. */
  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /** Get or compute a value. Stores the computed result. */
  getOrSet(key: K, factory: () => V): V {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = factory();
    this.set(key, value);
    return value;
  }

  /** Current number of entries in the cache. */
  get size(): number {
    return this.map.size;
  }

  /** Maximum capacity of the cache. */
  get capacity(): number {
    return this._capacity;
  }

  /** Cache access statistics. */
  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.map.size,
      capacity: this._capacity,
    };
  }

  /**
   * Get enhanced cache statistics including hit rate and eviction count.
   * Returns a fresh snapshot each call.
   */
  getStats(): CacheStats & { hitRate: number; evictionCount: number } {
    /* v8 ignore next 2 */ // defensive: total === 0 on fresh cache (both the const assignment and the ternary)
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      evictionCount: this._evictions,
      size: this.map.size,
      capacity: this._capacity,
      hitRate: total === 0 ? 0 : this._hits / total,
    };
  }

  /**
   * Auto-resize: if hit rate drops below the given threshold,
   * double the cache capacity. Returns true if resize occurred.
   */
  autoResize(hitRateThreshold = 0.5): boolean {
    /* v8 ignore start -- @preserve */
    if (this.hitRate < hitRateThreshold && this._capacity > 0) {
      this._capacity *= 2;
      return true;
    }
    return false;
    /* v8 ignore stop -- @preserve */
  }

  /** Hit rate as a fraction (0–1). */
  get hitRate(): number {
    const total = this._hits + this._misses;
    return total === 0 ? 0 : this._hits / total;
  }

  /** Iterate entries from most to least recently used. */
  *[Symbol.iterator](): IterableIterator<[K, V]> {
    let current = this.head;
    while (current) {
      yield [current.key, current.value];
      current = current.next;
    }
  }

  /** Return an array of keys in order (MRU to LRU). */
  keys(): K[] {
    const result: K[] = [];
    let current = this.head;
    while (current) {
      result.push(current.key);
      current = current.next;
    }
    return result;
  }

  /** Return an array of values in order (MRU to LRU). */
  values(): V[] {
    const result: V[] = [];
    let current = this.head;
    while (current) {
      result.push(current.value);
      current = current.next;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Internal: Doubly-linked list operations
  // -------------------------------------------------------------------------

  private moveToHead(node: ListNode<K, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }

  private addToHead(node: ListNode<K, V>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: ListNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private evictLRU(): void {
    if (!this.tail) return;
    const lru = this.tail;
    this.map.delete(lru.key);
    this.removeNode(lru);
    this._evictions++;
  }
}
