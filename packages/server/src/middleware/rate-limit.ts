// @code-analyzer/server — Rate Limiting Middleware
// Sliding-window rate limiter with configurable window size and max requests.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitConfig {
  /** Whether rate limiting is enabled (default: false). */
  enabled: boolean;
  /** Time window in ms (default: 60000 = 1 minute). */
  windowMs: number;
  /** Maximum requests per window (default: 100). */
  maxRequests: number;
  /** Whether to include rate limit headers in responses (default: true). */
  addHeaders: boolean;
  /** Custom key generator (default: req.ip). */
  keyGenerator?: (req: FastifyRequest) => string;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  enabled: false,
  windowMs: 60_000,
  maxRequests: 100,
  addHeaders: true,
};

// ---------------------------------------------------------------------------
// Sliding Window Store
// ---------------------------------------------------------------------------

interface WindowEntry {
  timestamp: number;
}

/**
 * Simple in-memory sliding window store.
 * Tracks request timestamps per key, evicts entries outside the window.
 */
class SlidingWindowStore {
  private store = new Map<string, WindowEntry[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic cleanup of stale entries.
   */
  startCleanup(intervalMs: number): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
  }

  /**
   * Stop cleanup timer.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Record a request and return the count within the window.
   *
   * @param key - Client identifier (e.g. IP).
   * @param windowMs - Window size in ms.
   * @returns Number of requests in the window AFTER recording this one.
   */
  hit(key: string, windowMs: number): number {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entries = this.store.get(key);
    if (!entries) {
      entries = [];
      this.store.set(key, entries);
    }

    // Evict stale entries
    const active = entries.filter((e) => e.timestamp > windowStart);
    active.push({ timestamp: now });
    this.store.set(key, active);

    return active.length;
  }

  /**
   * Get the reset time for a key (when the oldest entry expires).
   */
  getResetTime(key: string, windowMs: number): number {
    const entries = this.store.get(key);
    if (!entries || entries.length === 0) return Date.now() + windowMs;
    // Reset time = oldest entry timestamp + window
    const oldest = entries.reduce((min, e) => Math.min(min, e.timestamp), Infinity);
    return oldest + windowMs;
  }

  /**
   * Remove stale entries across all keys.
   */
  private cleanup(): void {
    const now = Date.now();
    // Use a generous 5-minute default; entries will be evicted on next hit anyway
    const cutoff = now - 300_000;
    for (const [key, entries] of this.store) {
      const filtered = entries.filter((e) => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, filtered);
      }
    }
  }

  /**
   * Get the current number of tracked keys.
   */
  get size(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Register rate limiting middleware on a Fastify instance.
 *
 * Uses a sliding window algorithm per client IP (or custom key).
 * Returns 429 Too Many Requests when limit is exceeded, with
 * Retry-After and X-RateLimit-* headers.
 */
export function registerRateLimit(app: FastifyInstance, config: RateLimitConfig): void {
  if (!config.enabled) return;

  const store = new SlidingWindowStore();
  store.startCleanup(config.windowMs * 2);

  const keyGenerator = config.keyGenerator ?? ((req: FastifyRequest) => req.ip);

  // Clean up store when server closes
  app.addHook('onClose', () => {
    store.stopCleanup();
  });

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip health and OPTIONS
    const url = request.url;
    if (url.startsWith('/health') || request.method === 'OPTIONS') {
      return;
    }

    const key = keyGenerator(request);
    const count = store.hit(key, config.windowMs);
    const resetTime = store.getResetTime(key, config.windowMs);
    const remaining = Math.max(0, config.maxRequests - count);

    // Add rate limit headers
    if (config.addHeaders) {
      void reply.header('X-RateLimit-Limit', config.maxRequests);
      void reply.header('X-RateLimit-Remaining', remaining);
      void reply.header('X-RateLimit-Reset', Math.ceil(resetTime / 1000));
    }

    // Check if limit exceeded
    if (count > config.maxRequests) {
      const retryAfterSec = Math.ceil((resetTime - Date.now()) / 1000);
      void reply.header('Retry-After', retryAfterSec);
      return reply.status(429).send({
        error: 'TOO_MANY_REQUESTS',
        message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        statusCode: 429,
        retryAfter: retryAfterSec,
      });
    }
  });
}

/** Exported for testing */
export { SlidingWindowStore };
