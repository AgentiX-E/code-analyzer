// @code-analyzer/infra — Retry with Exponential Backoff
// Configurable retry with exponential backoff, jitter, and abort support.

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds before first retry (default: 100). */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000). */
  maxDelayMs?: number;
  /** Jitter factor (0-1). 0 = no jitter, 0.5 = ±50% (default: 0.1). */
  jitter?: number;
  /** Optional predicate to determine if an error is retryable. */
  retryable?: (error: unknown) => boolean;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Callback invoked before each retry attempt. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export interface RetryResult<T> {
  result: T;
  attempts: number;
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Retry Implementation
// ---------------------------------------------------------------------------

/**
 * Execute an async function with retry and exponential backoff.
 *
 * The delay between retries follows: min(baseDelay * 2^attempt + jitter, maxDelay)
 *
 * @example
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, baseDelayMs: 100 },
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 100,
    maxDelayMs = 10000,
    jitter = 0.1,
    retryable,
    signal,
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check abort signal
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      const result = await fn();
      return {
        result,
        attempts: attempt + 1,
        totalDurationMs: Date.now() - startTime,
      };
    } catch (error: unknown) {
      lastError = error;

      // Check if error is retryable
      if (retryable && !retryable(error)) {
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt >= maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitterAmount = exponentialDelay * jitter * (Math.random() * 2 - 1);
      const delayMs = Math.min(exponentialDelay + jitterAmount, maxDelayMs);

      // Notify
      if (onRetry) {
        onRetry(error, attempt + 1, Math.round(delayMs));
      }

      // Wait
      await sleep(Math.round(delayMs), signal);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Operation aborted'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new Error('Operation aborted'));
        },
        { once: true },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Common Retryable Error Predicates
// ---------------------------------------------------------------------------

/** Predicate: retry on network errors and 5xx HTTP responses. */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('socket') ||
      msg.includes('timeout')
    ) {
      return true;
    }
  }
  return false;
}

/** Predicate: retry on server errors (HTTP 5xx). */
export function isServerError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    return status >= 500 && status < 600;
  }
  return false;
}

/** Predicate: retry on rate limiting (HTTP 429). */
export function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    return (error as { status: number }).status === 429;
  }
  return false;
}

/** Predicate: retry on transient errors (network + server + rate limit). */
export function isTransientError(error: unknown): boolean {
  return isNetworkError(error) || isServerError(error) || isRateLimitError(error);
}
