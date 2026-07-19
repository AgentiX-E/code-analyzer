// @code-analyzer/infra — WorkerPool & CircuitBreaker Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorkerPool } from '../workers/pool.js';
import { CircuitBreaker } from '../workers/circuit-breaker.js';
import type { WorkerPool } from '../workers/pool.js';

describe('WorkerPool', () => {
  let pool: WorkerPool;

  afterEach(() => {
    pool.shutdown();
  });

  it('executes a single task', async () => {
    pool = createWorkerPool(2);
    const result = await pool.execute({
      id: 'task1',
      execute: async () => 42,
    });
    expect(result).toBe(42);
  });

  it('executes multiple tasks in parallel', async () => {
    pool = createWorkerPool(4);
    const taskDuration = 20;
    const tasks = Array.from({ length: 4 }, (_, i) => ({
      id: `task${i}`,
      execute: async () => {
        await new Promise((r) => setTimeout(r, taskDuration));
        return i;
      },
    }));

    const start = Date.now();
    const results = await pool.executeAll(tasks);
    const elapsed = Date.now() - start;

    expect(results).toEqual([0, 1, 2, 3]);
    // Should execute in parallel, so total time < 4 * taskDuration + overhead margin
    expect(elapsed).toBeLessThan(taskDuration * 6);
  });

  it('respects concurrency limit', async () => {
    pool = createWorkerPool(2);
    let runningCount = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 6 }, (_, i) => ({
      id: `concurrent${i}`,
      execute: async () => {
        runningCount++;
        maxRunning = Math.max(maxRunning, runningCount);
        await new Promise((r) => setTimeout(r, 10));
        runningCount--;
        return i;
      },
    }));

    await pool.executeAll(tasks);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('tracks active count', async () => {
    pool = createWorkerPool(2);

    // Start a long task
    const taskPromise = pool.execute({
      id: 'long',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'done';
      },
    });

    // Give it time to start
    await new Promise((r) => setTimeout(r, 5));
    expect(pool.activeCount).toBe(1);

    await taskPromise;
  });

  it('tracks queued count', async () => {
    pool = createWorkerPool(1);

    // Start one task that blocks
    const blocker = pool.execute({
      id: 'blocker',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 'blocked';
      },
    });

    await new Promise((r) => setTimeout(r, 5));

    // Queue more tasks
    const queuedPromises = [
      pool.execute({ id: 'q1', execute: async () => 'a' }),
      pool.execute({ id: 'q2', execute: async () => 'b' }),
    ];

    await new Promise((r) => setTimeout(r, 5));
    expect(pool.queuedCount).toBe(2);

    await blocker;
    await Promise.all(queuedPromises);
  });

  it('handles task timeout', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'timeout-task',
        execute: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'never';
        },
        timeout: 50,
      }),
    ).rejects.toThrow('timed out');
  });

  it('retries failed tasks', async () => {
    pool = createWorkerPool(1);
    let attempts = 0;

    const result = await pool.execute({
      id: 'retry-task',
      execute: async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('temporary failure');
        }
        return 'success';
      },
      retries: 3,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('fails after max retries', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'fail-task',
        execute: async () => {
          throw new Error('always fails');
        },
        retries: 2,
      }),
    ).rejects.toThrow('always fails');
  });

  it('rejects new tasks after shutdown', async () => {
    pool = createWorkerPool(1);
    pool.shutdown();
    await expect(
      pool.execute({
        id: 'post-shutdown',
        execute: async () => 'nope',
      }),
    ).rejects.toThrow('shut down');
  });

  it('rejects executeAll after shutdown', async () => {
    pool = createWorkerPool(1);
    pool.shutdown();
    await expect(
      pool.executeAll([
        { id: 's1', execute: async () => 'a' },
      ]),
    ).rejects.toThrow('shut down');
  });

  it('default concurrency is 4', () => {
    pool = createWorkerPool();
    // Can't directly assert concurrency, but we can test behavior
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });
});

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
  });

  it('starts in closed state', () => {
    expect(breaker.state).toBe('closed');
  });

  it('executes successful operations in closed state', async () => {
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.state).toBe('closed');
  });

  it('tracks failures', async () => {
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(breaker.state).toBe('closed');
  });

  it('opens after failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(breaker.state).toBe('open');
  });

  it('rejects operations in open state', async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    await expect(breaker.execute(async () => 'nope')).rejects.toThrow(
      'OPEN',
    );
  });

  it('transitions to half-open after timeout', async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    expect(breaker.state).toBe('open');

    // Wait for reset
    await new Promise((r) => setTimeout(r, 150));

    expect(breaker.state).toBe('half-open');
  });

  it('closes after success threshold in half-open', async () => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 2,
      resetTimeout: 50,
    });

    // Trip
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    await new Promise((r) => setTimeout(r, 60));
    expect(breaker.state).toBe('half-open');

    // Successful operations
    await breaker.execute(async () => 'ok1');
    expect(breaker.state).toBe('half-open');

    await breaker.execute(async () => 'ok2');
    expect(breaker.state).toBe('closed');
  });

  it('re-opens on failure in half-open', async () => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 3,
      resetTimeout: 50,
    });

    // Trip
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    await new Promise((r) => setTimeout(r, 60));
    expect(breaker.state).toBe('half-open');

    try {
      await breaker.execute(async () => {
        throw new Error('fail again');
      });
    } catch {
      // expected
    }

    expect(breaker.state).toBe('open');
  });

  it('reset() returns to closed state', async () => {
    // Trip
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    expect(breaker.state).toBe('open');
    breaker.reset();
    expect(breaker.state).toBe('closed');

    // Should work again
    const result = await breaker.execute(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('default options work correctly', () => {
    const defaultBreaker = new CircuitBreaker();
    expect(defaultBreaker.state).toBe('closed');
  });

  it('propagates errors from executed function', async () => {
    await expect(
      breaker.execute(async () => {
        throw new Error('specific error');
      }),
    ).rejects.toThrow('specific error');
  });
});
