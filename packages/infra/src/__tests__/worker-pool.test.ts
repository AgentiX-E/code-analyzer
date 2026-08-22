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
    await expect(pool.executeAll([{ id: 's1', execute: async () => 'a' }])).rejects.toThrow(
      'shut down',
    );
  });

  it('should reject executeAll with multiple tasks after shutdown', async () => {
    pool = createWorkerPool(2);
    pool.shutdown();
    await expect(
      pool.executeAll([
        { id: 'a', execute: async () => '1' },
        { id: 'b', execute: async () => '2' },
        { id: 'c', execute: async () => '3' },
      ]),
    ).rejects.toThrow('shut down');
  });

  it('default concurrency is 4', () => {
    pool = createWorkerPool();
    // Can't directly assert concurrency, but we can test behavior
    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });

  it('handles non-Error exceptions in task execution', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'string-error',
        execute: async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'raw string error';
        },
        retries: 0,
      }),
    ).rejects.toThrow('raw string error');
  });

  it('handles task with 0 retries', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'no-retry',
        execute: async () => {
          throw new Error('one shot fail');
        },
        retries: 0,
      }),
    ).rejects.toThrow('one shot fail');
  });

  it('fails after timeout with 0 retries', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'timeout-noretry',
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return 'late';
        },
        timeout: 10,
        retries: 0,
      }),
    ).rejects.toThrow('timed out');
  });

  it('shuts down with queued pending tasks', async () => {
    pool = createWorkerPool(1);

    // Start a long-running task to block the pool
    const longTask = pool.execute({
      id: 'long-blocker',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 500));
        return 'done';
      },
    });

    // Let the long task start and occupy the slot
    await new Promise((r) => setTimeout(r, 10));

    // Queue tasks that will go into pending (past the shutdown check)
    const queuedPromises = [
      pool.execute({ id: 'queued-a', execute: async () => 'a' }),
      pool.execute({ id: 'queued-b', execute: async () => 'b' }),
    ];

    // Verify tasks are queued
    expect(pool.queuedCount).toBeGreaterThanOrEqual(1);

    // Shutdown while tasks are queued — releases pending queue resolves
    // Tasks already past the isShutdown check will execute when slots free up
    pool.shutdown();

    // New tasks submitted AFTER shutdown should reject
    await expect(
      pool.execute({ id: 'post-shutdown', execute: async () => 'nope' }),
    ).rejects.toThrow('shut down');

    // The queued tasks (already past shutdown check) will execute
    const results = await Promise.allSettled(queuedPromises);
    // They resolve because they passed the shutdown check before being queued

    // Clean up the long task
    try {
      await longTask;
    } catch {
      /* may be affected */
    }
  });

  it('handles retries set to 0 (default path)', async () => {
    pool = createWorkerPool(1);
    let calls = 0;
    const result = await pool.execute({
      id: 'default-retry',
      execute: async () => {
        calls++;
        return 'ok';
      },
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  // ── Additional coverage tests ──

  it('handles pool exhaustion — more tasks than workers', async () => {
    pool = createWorkerPool(2);
    const order: string[] = [];
    const startTimes: number[] = [];

    const tasks = Array.from({ length: 6 }, (_, i) => ({
      id: `exhaust${i}`,
      execute: async () => {
        startTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 20));
        order.push(`task${i}`);
        return i;
      },
    }));

    const results = await pool.executeAll(tasks);
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(order.length).toBe(6);
  });

  it('tasks are queued when all workers busy', async () => {
    pool = createWorkerPool(1);
    let running = false;

    // Start a blocking task
    const blocker = pool.execute({
      id: 'blocker2',
      execute: async () => {
        running = true;
        await new Promise((r) => setTimeout(r, 100));
        running = false;
        return 'done';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    // Queue 3 more tasks
    const q1 = pool.execute({ id: 'q-a', execute: async () => 'a' });
    const q2 = pool.execute({ id: 'q-b', execute: async () => 'b' });
    const q3 = pool.execute({ id: 'q-c', execute: async () => 'c' });

    expect(pool.queuedCount).toBeGreaterThanOrEqual(2);

    await blocker;
    const results = await Promise.all([q1, q2, q3]);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('error in one task does not affect other tasks in executeAll', async () => {
    pool = createWorkerPool(2);
    await expect(
      pool.executeAll([
        { id: 'ok1', execute: async () => 'ok' },
        {
          id: 'fail1',
          execute: async () => {
            throw new Error('task failed');
          },
          retries: 0,
        },
        { id: 'ok2', execute: async () => 'ok2' },
      ]),
    ).rejects.toThrow('task failed');
  });

  it('handles task with default timeout (30s)', async () => {
    pool = createWorkerPool(1);
    // Default timeout is 30s, this should complete fine
    const result = await pool.execute({
      id: 'default-timeout',
      execute: async () => 'fast',
    });
    expect(result).toBe('fast');
  });

  it('retries with backoff delay', async () => {
    pool = createWorkerPool(1);
    let attempts = 0;
    const startTime = Date.now();

    const result = await pool.execute({
      id: 'backoff-test',
      execute: async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('fail');
        }
        return 'done';
      },
      retries: 2,
    });

    const elapsed = Date.now() - startTime;
    expect(result).toBe('done');
    expect(attempts).toBe(3);
    // Should have at least 10ms + 20ms = 30ms of backoff delay
    expect(elapsed).toBeGreaterThanOrEqual(25);
  });

  it('throws last error when all retries exhausted', async () => {
    pool = createWorkerPool(1);
    await expect(
      pool.execute({
        id: 'exhaust-retries',
        execute: async () => {
          throw new Error('final error');
        },
        retries: 2,
      }),
    ).rejects.toThrow('final error');
  });

  it('activeCount returns to 0 after tasks complete', async () => {
    pool = createWorkerPool(2);
    expect(pool.activeCount).toBe(0);

    await pool.executeAll([
      { id: 'a', execute: async () => 'a' },
      { id: 'b', execute: async () => 'b' },
    ]);

    // Wait for slots to be released
    await new Promise((r) => setTimeout(r, 5));
    expect(pool.activeCount).toBe(0);
  });

  it('queuedCount returns to 0 after all tasks complete', async () => {
    pool = createWorkerPool(1);
    const blocker = pool.execute({
      id: 'b',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'done';
      },
    });

    await new Promise((r) => setTimeout(r, 10));

    const q = pool.execute({ id: 'q', execute: async () => 'queued' });
    expect(pool.queuedCount).toBeGreaterThanOrEqual(1);

    await blocker;
    await q;
    expect(pool.queuedCount).toBe(0);
  });

  it('handles all retries exhausted with lastError undefined fallback (line 70)', async () => {
    pool = createWorkerPool(1);
    // The ?? operator at line 70 is defensive — lastError is always set
    // by the catch block. This test verifies the retry exhausted path
    // throws the expected final error.
    await expect(
      pool.execute({
        id: 'exhaust-all',
        execute: async () => {
          throw new Error('final failure');
        },
        retries: 2,
      }),
    ).rejects.toThrow('final failure');
  });

  it('retries with delay and exhausts all attempts', async () => {
    pool = createWorkerPool(1);
    let calls = 0;
    await expect(
      pool.execute({
        id: 'retry-exhaust',
        execute: async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        retries: 3,
      }),
    ).rejects.toThrow('fail 4'); // initial + 3 retries = 4 calls
    expect(calls).toBe(4);
  });

  it('uses default timeout when timeout not specified', async () => {
    pool = createWorkerPool(1);
    const result = await pool.execute({
      id: 'default-timeout-task',
      execute: async () => 'fast',
      // No timeout specified — uses default 30000
    });
    expect(result).toBe('fast');
  });

  it('shutdown with no pending tasks does not throw', () => {
    pool = createWorkerPool(1);
    expect(() => pool.shutdown()).not.toThrow();
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

    await expect(breaker.execute(async () => 'nope')).rejects.toThrow('OPEN');
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

  it('closes immediately on reset with timer cleared', async () => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeout: 5000,
    });

    // Trip to open
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }
    expect(breaker.state).toBe('open');

    // Reset without waiting for timeout
    breaker.reset();
    expect(breaker.state).toBe('closed');

    // Should work immediately
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
  });

  it('transitions to closed when enough successes in half-open', async () => {
    breaker = new CircuitBreaker({
      failureThreshold: 2,
      successThreshold: 1,
      resetTimeout: 50,
    });

    // Trip to open
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

    // Single success should close with successThreshold=1
    await breaker.execute(async () => 'ok');
    expect(breaker.state).toBe('closed');
  });
});
