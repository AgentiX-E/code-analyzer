// @code-analyzer/infra — Retry Tests

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, isNetworkError, isServerError, isRateLimitError, isTransientError } from '../../resilience/retry.js';
import type { RetryOptions } from '../../resilience/retry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFailingFn(failures: number, finalResult = 'success'): () => Promise<string> {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= failures) {
      throw new Error(`Attempt ${calls} failed`);
    }
    return finalResult;
  };
}

// ---------------------------------------------------------------------------
// withRetry — Basic
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return result on first attempt (no retries needed)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, { maxRetries: 3 });

    // Fast-forward all timers to avoid hanging
    vi.runAllTimers();
    const result = await promise;

    expect(result.result).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    const fn = createFailingFn(2, 'recovered');

    // We need real timers for this one since we actually want retries
    vi.useRealTimers();
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });

    expect(result.result).toBe('recovered');
    expect(result.attempts).toBe(3);
  });

  it('should throw after exhausting retries', async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    vi.useFakeTimers();
  });

  it('should respect maxRetries = 0 (no retries)', async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxRetries: 0 }),
    ).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
  });

  it('should calculate correct delay with exponential backoff', async () => {
    let capturedDelay = 0;
    const fn = createFailingFn(1, 'ok');

    vi.useRealTimers();
    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitter: 0, // disable jitter for predictable testing
      onRetry: (_err, _attempt, delayMs) => {
        capturedDelay = delayMs;
      },
    });

    expect(result.attempts).toBe(2);
    // baseDelay * 2^0 = 10ms
    expect(capturedDelay).toBe(10);
  });

  it('should invoke onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = createFailingFn(2, 'ok');

    vi.useRealTimers();
    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      expect.any(Error),
      1,
      expect.any(Number),
    );
  });

  it('should not retry if error is not retryable', async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockRejectedValue(new Error('not retryable'));

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        retryable: () => false,
      }),
    ).rejects.toThrow('not retryable');

    expect(fn).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
  });

  it('should retry if error matches retryable predicate', async () => {
    const fn = createFailingFn(1, 'ok');

    vi.useRealTimers();
    const result = await withRetry(fn, {
      maxRetries: 2,
      baseDelayMs: 1,
      retryable: () => true,
    });

    expect(result.attempts).toBe(2);
  });

  it('should cap delay at maxDelayMs', async () => {
    let capturedDelays: number[] = [];
    const fn = createFailingFn(3, 'ok');

    vi.useRealTimers();
    await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 50,
      jitter: 0,
      onRetry: (_err, _attempt, delayMs) => {
        capturedDelays.push(delayMs);
      },
    });

    // All delays should be capped at 50ms
    for (const delay of capturedDelays) {
      expect(delay).toBeLessThanOrEqual(50);
    }
  });

  it('should abort when signal is triggered', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Abort immediately
    controller.abort();

    await expect(
      withRetry(fn, { maxRetries: 3, signal: controller.signal }),
    ).rejects.toThrow('Operation aborted');

    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('should record total duration', async () => {
    const fn = vi.fn().mockResolvedValue('fast');
    const result = await withRetry(fn);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Error Predicate Tests
// ---------------------------------------------------------------------------

describe('Error Predicates', () => {
  it('isNetworkError should detect ECONNREFUSED', () => {
    expect(isNetworkError(new Error('connect ECONNREFUSED'))).toBe(true);
  });

  it('isNetworkError should detect ETIMEDOUT', () => {
    expect(isNetworkError(new Error('ETIMEDOUT'))).toBe(true);
  });

  it('isNetworkError should detect ECONNRESET', () => {
    expect(isNetworkError(new Error('ECONNRESET'))).toBe(true);
  });

  it('isNetworkError should detect timeout', () => {
    expect(isNetworkError(new Error('request timeout'))).toBe(true);
  });

  it('isNetworkError should return false for non-network errors', () => {
    expect(isNetworkError(new Error('invalid input'))).toBe(false);
  });

  it('isNetworkError should return false for non-Error', () => {
    expect(isNetworkError('string error')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it('isServerError should detect 500', () => {
    expect(isServerError({ status: 500 })).toBe(true);
  });

  it('isServerError should detect 503', () => {
    expect(isServerError({ status: 503 })).toBe(true);
  });

  it('isServerError should return false for 404', () => {
    expect(isServerError({ status: 404 })).toBe(false);
  });

  it('isRateLimitError should detect 429', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });

  it('isRateLimitError should return false for 200', () => {
    expect(isRateLimitError({ status: 200 })).toBe(false);
  });

  it('isTransientError should detect network errors', () => {
    expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('isTransientError should detect server errors', () => {
    expect(isTransientError({ status: 500 })).toBe(true);
  });

  it('isTransientError should detect rate limits', () => {
    expect(isTransientError({ status: 429 })).toBe(true);
  });

  it('isTransientError should return false for normal errors', () => {
    expect(isTransientError(new Error('validation failed'))).toBe(false);
  });
});
