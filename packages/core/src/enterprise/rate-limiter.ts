// @code-analyzer/core — Token Bucket Rate Limiter
// Implements the Token Bucket algorithm for API-level rate limiting.
// Each user/resource gets a bucket that refills at a configurable rate.
// Supports burst capacity, per-user limits, and sliding window tracking.
//
// Algorithm: Tokens are added to the bucket at a constant rate.
// Each request consumes one token. When the bucket is empty, requests
// are rejected until tokens refill. Burst capacity allows short spikes
// above the steady-state rate.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Rate limit configuration for a resource category. */
export interface RateLimitConfig {
  /** Maximum tokens per second (steady-state rate). */
  rate: number;
  /** Maximum burst capacity (bucket size). */
  burst: number;
  /** Window size in seconds for tracking. */
  windowSeconds: number;
}

/** Rate limit state for a single bucket. */
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  config: RateLimitConfig;
}

/** Result of a rate limit check. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Remaining tokens after this request. */
  remaining: number;
  /** Milliseconds until the next token is available (0 if allowed). */
  retryAfterMs: number;
  /** Maximum burst capacity. */
  limit: number;
  /** When the window resets (epoch ms). */
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Predefined Rate Limits
// ---------------------------------------------------------------------------

export const PRESET_LIMITS = {
  /** Default per-user limit. */
  default: { rate: 10, burst: 20, windowSeconds: 1 } satisfies RateLimitConfig,

  /** Per-tool MCP tool invocation limit. */
  tool: { rate: 5, burst: 10, windowSeconds: 1 } satisfies RateLimitConfig,

  /** Indexing operations (more expensive). */
  index: { rate: 1, burst: 3, windowSeconds: 1 } satisfies RateLimitConfig,

  /** Search/query operations. */
  query: { rate: 20, burst: 50, windowSeconds: 1 } satisfies RateLimitConfig,

  /** Admin operations. */
  admin: { rate: 2, burst: 5, windowSeconds: 1 } satisfies RateLimitConfig,

  /** Strict limit for untrusted sources. */
  strict: { rate: 1, burst: 2, windowSeconds: 1 } satisfies RateLimitConfig,
} as const;

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private config: RateLimitConfig;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      rate: config?.rate ?? PRESET_LIMITS.default.rate,
      burst: config?.burst ?? PRESET_LIMITS.default.burst,
      windowSeconds: config?.windowSeconds ?? PRESET_LIMITS.default.windowSeconds,
    };
  }

  /**
   * Check if a request is allowed for a given key.
   * @param key — Unique identifier (e.g., userId or userId:tool)
   * @param cost — Number of tokens to consume (default: 1)
   * @returns Rate limit result
   */
  check(key: string, cost: number = 1): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = {
        tokens: this.config.burst,
        lastRefill: now,
        config: { ...this.config },
      };
      this.buckets.set(key, bucket);
    } else {
      this.refill(bucket, now);
    }

    const resetAt = now + this.config.windowSeconds * 1000;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
        limit: this.config.burst,
        resetAt,
      };
    }

    // Calculate when next token will be available
    const tokenInterval = 1000 / this.config.rate;
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit * tokenInterval);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
      limit: this.config.burst,
      resetAt,
    };
  }

  /**
   * Check with a specific rate limit config for this key.
   */
  checkWithConfig(
    key: string,
    config: RateLimitConfig,
    cost: number = 1,
  ): RateLimitResult {
    // Create or get a bucket with the specific config
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.config.rate !== config.rate || bucket.config.burst !== config.burst) {
      bucket = {
        tokens: config.burst,
        lastRefill: Date.now(),
        config: { ...config },
      };
      this.buckets.set(key, bucket);
    } else {
      this.refill(bucket, Date.now());
    }

    const now = Date.now();
    const resetAt = now + config.windowSeconds * 1000;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        retryAfterMs: 0,
        limit: config.burst,
        resetAt,
      };
    }

    const tokenInterval = 1000 / config.rate;
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil(deficit * tokenInterval);

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
      limit: config.burst,
      resetAt,
    };
  }

  /**
   * Get current bucket state without consuming tokens.
   */
  peek(key: string): { tokens: number; limit: number } | null {
    const bucket = this.buckets.get(key);
    if (!bucket) return null;
    this.refill(bucket, Date.now());
    return { tokens: bucket.tokens, limit: bucket.config.burst };
  }

  /**
   * Reset a specific key's bucket.
   */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /**
   * Reset all buckets.
   */
  resetAll(): void {
    this.buckets.clear();
  }

  /**
   * Get the number of actively tracked buckets.
   */
  get activeBuckets(): number {
    return this.buckets.size;
  }

  /**
   * Clean up stale buckets that haven't been accessed recently.
   * @param maxAgeMs — Maximum age of a bucket before removal
   */
  cleanup(maxAgeMs: number = 60000): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
        removed++;
      }
    }

    return removed;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private refill(bucket: TokenBucket, now: number): void {
    const elapsed = (now - bucket.lastRefill) / 1000;
    const tokensToAdd = elapsed * bucket.config.rate;

    bucket.tokens = Math.min(bucket.tokens + tokensToAdd, bucket.config.burst);
    bucket.lastRefill = now;
  }
}
