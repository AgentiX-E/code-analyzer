// @ts-nocheck
// @code-analyzer/mcp — MCP Middleware
// Auth, rate limiting, tool policies, and request logging.

import type { ToolProfile } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Auth Middleware
// ---------------------------------------------------------------------------

export interface AuthResult {
  allowed: boolean;
  message?: string;
}

export class AuthMiddleware {
  private apiKeys: Set<string>;

  constructor(keys: string[] = []) {
    this.apiKeys = new Set(keys);
  }

  /** Validate an incoming request. Returns allowed status. */
  validate(request: Record<string, unknown>): AuthResult {
    // If no API keys are configured, allow all requests
    if (this.apiKeys.size === 0) {
      return { allowed: true };
    }

    const headers = request.headers as Record<string, string> | undefined;
    const apiKey = headers?.['x-api-key'] ?? headers?.['authorization']?.replace('Bearer ', '');

    if (!apiKey) {
      return { allowed: false, message: 'Missing API key' };
    }

    if (!this.apiKeys.has(apiKey)) {
      return { allowed: false, message: 'Invalid API key' };
    }

    return { allowed: true };
  }

  /** Add an API key to the allowed set. */
  addKey(key: string): void {
    this.apiKeys.add(key);
  }

  /** Remove an API key. */
  removeKey(key: string): void {
    this.apiKeys.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter (Token Bucket)
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  message?: string;
  retryAfterMs?: number;
}

export class RateLimiter {
  private buckets: Map<string, { tokens: number; lastRefill: number }>;
  private capacity: number;
  private refillRate: number; // tokens per millisecond

  constructor(capacity = 100, refillRate = 0.5) {
    this.buckets = new Map();
    this.capacity = capacity;
    this.refillRate = refillRate; // 0.5 tokens/ms = 30 tokens/minute
  }

  /** Check if a tool invocation is allowed under rate limits. */
  check(toolName: string): RateLimitResult {
    const now = Date.now();
    let bucket = this.buckets.get(toolName);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(toolName, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = now - bucket.lastRefill;
    const refill = elapsed * this.refillRate;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }

    const retryAfterMs = Math.ceil((1 - bucket.tokens) / this.refillRate);
    return {
      allowed: false,
      message: `Rate limit exceeded for ${toolName}`,
      retryAfterMs,
    };
  }

  /** Reset all rate limit buckets. */
  reset(): void {
    this.buckets.clear();
  }

  /** Get current token count for a tool. */
  getTokens(toolName: string): number {
    return this.buckets.get(toolName)?.tokens ?? this.capacity;
  }
}

// ---------------------------------------------------------------------------
// Tool Policy Profiles
// ---------------------------------------------------------------------------

export class ToolPolicy {
  private profile: ToolProfile;

  constructor(profile: ToolProfile = 'all') {
    this.profile = profile;
  }

  /** Check if a tool is allowed under the current profile. */
  isAllowed(toolName: string, toolProfile: ToolProfile): boolean {
    if (this.profile === 'all') return true;
    if (toolProfile === 'all') return true;
    return this.profile === toolProfile;
  }

  /** Get the current profile. */
  getProfile(): ToolProfile {
    return this.profile;
  }

  /** Update the profile. */
  setProfile(profile: ToolProfile): void {
    this.profile = profile;
  }
}

// ---------------------------------------------------------------------------
// Request Logger
// ---------------------------------------------------------------------------

export interface LogEntry {
  toolName: string;
  args: Record<string, unknown>;
  duration: number;
  error: boolean;
  timestamp: string;
}

export class RequestLogger {
  private logs: LogEntry[];
  private maxLogs: number;

  constructor(maxLogs = 1000) {
    this.logs = [];
    this.maxLogs = maxLogs;
  }

  /** Log a request. */
  log(entry: Omit<LogEntry, 'timestamp'>): void {
    const logEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.logs.push(logEntry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  /** Get recent logs. */
  getLogs(limit = 100): LogEntry[] {
    return this.logs.slice(-limit);
  }

  /** Clear all logs. */
  clear(): void {
    this.logs = [];
  }

  /** Get log statistics. */
  getStats(): { total: number; errors: number; avgDuration: number } {
    const total = this.logs.length;
    const errors = this.logs.filter((l) => l.error).length;
    const avgDuration = total > 0
      ? this.logs.reduce((sum, l) => sum + l.duration, 0) / total
      : 0;
    return { total, errors, avgDuration };
  }
}
