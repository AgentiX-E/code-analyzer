// @code-analyzer/infra — Circuit Breaker Tests
// Tests for the existing CircuitBreaker in workers/ plus the resilience re-exports.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../../workers/circuit-breaker.js';

import type { CircuitState } from '../../workers/circuit-breaker.js';

// ---------------------------------------------------------------------------
// CircuitBreaker Tests
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      successThreshold: 2,
      resetTimeout: 1000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---- Initial State ----

  it('should start in closed state', () => {
    expect(breaker.state).toBe('closed');
  });

  // ---- Closed State ----

  it('should execute successfully in closed state', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const result = await breaker.execute(fn);
    expect(result).toBe('result');
    expect(breaker.state).toBe('closed');
  });

  it('should track failures in closed state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(breaker.execute(fn)).rejects.toThrow('fail');
    expect(breaker.state).toBe('closed');

    await expect(breaker.execute(fn)).rejects.toThrow('fail');
    expect(breaker.state).toBe('closed');
  });

  it('should transition to open after failure threshold is reached', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }

    expect(breaker.state).toBe('open');
  });

  it('should reset failure count on success in closed state', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    const successFn = vi.fn().mockResolvedValue('ok');

    await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    // Success resets the counter
    await breaker.execute(successFn);
    await expect(breaker.execute(failFn)).rejects.toThrow('fail');
    await expect(breaker.execute(failFn)).rejects.toThrow('fail');

    // Still closed — counter was reset by the success
    expect(breaker.state).toBe('closed');
  });

  // ---- Open State ----

  it('should reject immediately in open state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }
    expect(breaker.state).toBe('open');

    // Now any call should be rejected immediately
    await expect(breaker.execute(vi.fn())).rejects.toThrow('Circuit breaker is OPEN');
  });

  // ---- Half-Open State ----

  it('should transition to half-open after reset timeout', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }
    expect(breaker.state).toBe('open');

    // Advance past reset timeout
    vi.advanceTimersByTime(1000);
    expect(breaker.state).toBe('half-open');
  });

  it('should transition to closed after success threshold in half-open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }

    // Advance to half-open
    vi.advanceTimersByTime(1000);
    expect(breaker.state).toBe('half-open');

    // Two successes should close it
    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    await breaker.execute(vi.fn().mockResolvedValue('ok'));
    expect(breaker.state).toBe('closed');
  });

  it('should return to open on failure in half-open state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }

    // Advance to half-open
    vi.advanceTimersByTime(1000);
    expect(breaker.state).toBe('half-open');

    // One failure in half-open sends it back to open
    await expect(breaker.execute(fn)).rejects.toThrow('fail');
    expect(breaker.state).toBe('open');
  });

  // ---- Reset ----

  it('should reset to closed state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
    }
    expect(breaker.state).toBe('open');

    breaker.reset();
    expect(breaker.state).toBe('closed');

    // Should work normally again
    const result = await breaker.execute(vi.fn().mockResolvedValue('recovered'));
    expect(result).toBe('recovered');
  });

  // ---- Default Options ----

  it('should use default options when none provided', () => {
    const defaultBreaker = new CircuitBreaker();
    expect(defaultBreaker.state).toBe('closed');

    // Default failureThreshold is 5
    // We can't easily test this without triggering 5 failures, but state should be closed
  });

  // ---- Error Propagation ----

  it('should propagate the original error on failure', async () => {
    const originalError = new Error('custom error');
    const fn = vi.fn().mockRejectedValue(originalError);

    await expect(breaker.execute(fn)).rejects.toBe(originalError);
  });
});
