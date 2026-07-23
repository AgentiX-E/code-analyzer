// @code-analyzer/mcp — MCP Middleware
// Auth, rate limiting, tool policies, request logging, and circuit breaker.

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

    const headers = request['headers'] as Record<string, string> | undefined;
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

  /**
   * Authenticate via OAuth2 token.
   * The validator function receives the token and returns true if valid.
   */
  static async authenticateOAuth2(
    token: string,
    validator: (token: string) => Promise<boolean>,
  ): Promise<AuthResult> {
    if (!token) {
      return { allowed: false, message: 'Missing OAuth2 token' };
    }

    try {
      const valid = await validator(token);
      if (!valid) {
        return { allowed: false, message: 'Invalid or expired OAuth2 token' };
      }
      return { allowed: true };
    } catch {
      return { allowed: false, message: 'OAuth2 token validation failed' };
    }
  }

  /**
   * Authenticate via JWT token.
   * Validates JWT structure and signature (HS256).
   */
  static async authenticateJWT(
    token: string,
    secret: string,
  ): Promise<AuthResult & { payload?: Record<string, unknown> }> {
    if (!token) {
      return { allowed: false, message: 'Missing JWT token' };
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return { allowed: false, message: 'Invalid JWT format' };
    }

    try {
      const [headerB64, payloadB64, signatureB64] = parts;

      // Decode header and payload
      const header = JSON.parse(
        Buffer.from(headerB64!, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;
      const payload = JSON.parse(
        Buffer.from(payloadB64!, 'base64url').toString('utf-8'),
      ) as Record<string, unknown>;

      // Verify algorithm
      if (header['alg'] !== 'HS256') {
        return { allowed: false, message: 'Unsupported JWT algorithm' };
      }

      // Verify signature using HMAC-SHA256
      const crypto = await import('crypto');
      const signingInput = `${headerB64}.${payloadB64}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');

      if (signatureB64 !== expectedSignature) {
        return { allowed: false, message: 'Invalid JWT signature' };
      }

      // Check expiration
      const exp = payload['exp'] as number | undefined;
      if (exp && Date.now() / 1000 > exp) {
        return { allowed: false, message: 'JWT token expired' };
      }

      return { allowed: true, payload };
    } catch {
      return { allowed: false, message: 'JWT token validation failed' };
    }
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
  isAllowed(_toolName: string, toolProfile: ToolProfile): boolean {
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
  correlationId?: string;
  userId?: string;
}

export class RequestLogger {
  private logs: LogEntry[];
  private maxLogs: number;

  constructor(maxLogs = 1000) {
    this.logs = [];
    this.maxLogs = maxLogs;
  }

  /** Log a request with optional correlation ID and user identity. */
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

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenMaxRequests?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private failureThreshold: number;
  private resetTimeoutMs: number;
  private halfOpenMaxRequests: number;
  private lastFailureTime: number = 0;
  private halfOpenRequests = 0;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests ?? 3;
  }

  /** Execute an async function with circuit breaker protection. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenRequests = 0;
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    if (this.state === 'half-open') {
      if (this.halfOpenRequests >= this.halfOpenMaxRequests) {
        throw new Error('Circuit breaker half-open request limit reached');
      }
      this.halfOpenRequests++;
    }

    try {
      const result = await fn();

      // Success resets the breaker
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
      } else {
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.failureThreshold) {
        this.state = 'open';
      }

      throw error;
    }
  }

  /** Get the current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Get the current failure count. */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenRequests = 0;
  }
}
