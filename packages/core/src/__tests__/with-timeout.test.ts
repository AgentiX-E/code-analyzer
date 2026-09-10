// @code-analyzer/core — Promise Timeout Utility Tests

import { describe, it, expect, afterEach, vi } from 'vitest';

import { withTimeout } from '../utils/with-timeout.js';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the promise settles first', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'timed out')).resolves.toBe('ok');
  });

  it('rejects with the timeout message when the promise never settles', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'operation timed out')).rejects.toThrow(
      'operation timed out',
    );
  });

  it('propagates the original rejection when the promise rejects first', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'timed out')).rejects.toThrow(
      'boom',
    );
  });

  it('clears the timeout handle once the promise has settled', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(1), 5_000, 'timed out')).resolves.toBe(1);
    // The finally block must clear the pending timer, otherwise a successful call
    // would keep the process alive for the full timeout.
    expect(vi.getTimerCount()).toBe(0);
  });
});
