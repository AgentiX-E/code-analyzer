// @code-analyzer/intelligence — Embedding Worker Pool (real worker) Tests
// Exercises the non-fallback worker path against a real worker_thread fixture,
// covering spawnWorker, the message/error/exit handlers, processQueue,
// restartWorker, shutdown, and statistics.

import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmbeddingWorkerPool } from '../embeddings/worker-pool.js';
import type { EmbeddingTask } from '../embeddings/worker-pool.js';

const FIXTURE = resolve(__dirname, 'fixtures', 'embedding-worker.cjs');

function createTasks(count: number, prefix = 'task'): EmbeddingTask[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `${prefix}-${i}`,
    content: `content for ${prefix} ${i}`,
  }));
}

describe('EmbeddingWorkerPool (real worker)', () => {
  let pool: EmbeddingWorkerPool;

  afterEach(async () => {
    try {
      await pool?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  // ── Initialization with a real worker script ──

  it('spawns workers and is not in fallback mode when the script exists', () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    expect(pool.isFallback).toBe(false);
    expect(pool.workerCount).toBe(2);
  });

  it('reports healthy workers after spawn', () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    expect(pool.isWorkerHealthy(0)).toBe(true);
    expect(pool.isWorkerHealthy(1)).toBe(true);
  });

  it('reports initial statistics for a real pool', () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const stats = pool.getStats();
    expect(stats.totalWorkers).toBe(2);
    expect(stats.activeWorkers).toBe(0);
    expect(stats.queuedTasks).toBe(0);
    expect(stats.completedTasks).toBe(0);
    expect(stats.failedTasks).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
    expect(stats.unhealthyWorkers).toBe(0);
  });

  // ── Real embedding through the worker ──

  it('embeds tasks through real workers', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const { results, errors } = await pool.embedBatch(createTasks(3));

    expect(results).toHaveLength(3);
    expect(errors).toHaveLength(0);
    for (const result of results) {
      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.embedding.length).toBe(16);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns empty results for an empty batch (non-fallback)', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const { results, errors } = await pool.embedBatch([]);
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('processes more tasks than workers via the queue', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const { results, errors } = await pool.embedBatch(createTasks(8));
    expect(results).toHaveLength(8);
    expect(errors).toHaveLength(0);
  });

  it('updates statistics after real worker processing', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    await pool.embedBatch(createTasks(4));
    const stats = pool.getStats();
    expect(stats.completedTasks).toBe(4);
    expect(stats.failedTasks).toBe(0);
    expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('embeds a single task via embed()', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const result = await pool.embed({ taskId: 'single', content: 'single content' });
    expect(result.taskId).toBe('single');
    expect(result.embedding).toBeInstanceOf(Float32Array);
  });

  // ── Worker error path (message { type: 'error' }) ──

  it('collects worker errors from the error message path', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    const { results, errors } = await pool.embedBatch([
      { taskId: 'bad', content: '__ERROR__' },
      { taskId: 'good', content: 'fine content' },
    ]);
    expect(results).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe('bad');
    expect(errors[0]!.error).toBe('injected worker error');
  });

  it('marks a worker unhealthy after maxErrorsPerWorker failures', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      taskId: `err-${i}`,
      content: '__ERROR__',
    }));
    const { errors } = await pool.embedBatch(tasks);
    expect(errors).toHaveLength(5);
    // 5 consecutive errors on a single worker trip the unhealthy threshold.
    expect(pool.isWorkerHealthy(0)).toBe(false);
    expect(pool.getStats().unhealthyWorkers).toBe(1);
  });

  it('tracks failed tasks in statistics for worker errors', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    await pool.embedBatch([{ taskId: 'bad', content: '__ERROR__' }]);
    const stats = pool.getStats();
    expect(stats.failedTasks).toBe(1);
    expect(stats.completedTasks).toBe(0);
  });

  // ── Worker restart (non-fallback) ──

  it('restarts a worker in non-fallback mode', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const result = pool.restartWorker(0);
    expect(result).toBe(true);
    expect(pool.getStats().restartedWorkers).toBe(1);
    // The restarted worker should be healthy again and usable.
    expect(pool.isWorkerHealthy(0)).toBe(true);
    const { results } = await pool.embedBatch(createTasks(1));
    expect(results).toHaveLength(1);
  });

  // ── Shutdown with real workers ──

  it('shuts down real workers gracefully', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    await pool.embedBatch(createTasks(2));
    await pool.shutdown();
    expect(pool.workerCount).toBe(0);
    expect(pool.getStats().totalWorkers).toBe(0);
  });

  it('shuts down an idle real pool without error', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    await pool.shutdown();
    await pool.shutdown(); // double shutdown is safe
  });

  // ── Batched embedding through real workers ──

  it('embeds in batches through real workers', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const { results, errors } = await pool.embedBatched(createTasks(7), 3);
    expect(results).toHaveLength(7);
    expect(errors).toHaveLength(0);
  });

  it('handles a single batch through real workers', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const { results } = await pool.embedBatched(createTasks(2), 10);
    expect(results).toHaveLength(2);
  });

  // ── Worker exit / error event handlers ──

  it('falls back when a worker exits with a non-zero code', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    // The fixture calls process.exit(1) without replying, so the pending
    // promise never settles. Fire-and-forget and observe the side effect.
    void pool.embedBatch([{ taskId: 'crash', content: '__EXIT__' }]).catch(() => {});

    await new Promise((r) => setTimeout(r, 250));
    expect(pool.isFallback).toBe(true);
    expect(pool.isWorkerHealthy(0)).toBe(false);
  });

  it('marks a worker unhealthy when it emits an error event', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    void pool.embedBatch([{ taskId: 'throw', content: '__THROW__' }]).catch(() => {});

    await new Promise((r) => setTimeout(r, 250));
    expect(pool.isWorkerHealthy(0)).toBe(false);
  });
});

describe('EmbeddingWorkerPool (real worker) - health check', () => {
  let pool: EmbeddingWorkerPool;

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await pool?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('marks an idle worker unhealthy after the heartbeat timeout', () => {
    vi.useFakeTimers();
    pool = new EmbeddingWorkerPool(FIXTURE, 1);

    // The health check runs every 30s and flags a worker whose heartbeat is
    // older than 2x the interval (60s). Advancing 90s trips the threshold.
    vi.advanceTimersByTime(90_000);

    expect(pool.isWorkerHealthy(0)).toBe(false);
    expect(pool.getStats().unhealthyWorkers).toBe(1);
  });
});

// ── Defensive branch coverage: orphan replies, missing fields, restart ──

describe('EmbeddingWorkerPool (real worker) - defensive branches', () => {
  let pool: EmbeddingWorkerPool;

  afterEach(async () => {
    try {
      await pool?.shutdown();
    } catch {
      // Ignore teardown errors
    }
  });

  it('ignores a stray reply for an unknown taskId', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    const { results, errors } = await pool.embedBatch([{ taskId: 'stray', content: '__STRAY__' }]);
    // The real task resolves; the orphan 'ghost-task-id' reply is ignored.
    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe('stray');
    expect(errors).toHaveLength(0);
    // Flush the worker's second (orphan) message so the orphan guard runs.
    await new Promise((r) => setTimeout(r, 50));
  });

  it('defaults a missing durationMs to 0 on a result reply', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    const { results, errors } = await pool.embedBatch([
      { taskId: 'nodur', content: '__NO_DURATION__' },
    ]);
    expect(errors).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]!.durationMs).toBe(0);
  });

  it('defaults a missing error message to "Unknown worker error"', async () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 1);
    const { results, errors } = await pool.embedBatch([
      { taskId: 'noerr', content: '__NO_ERROR__' },
    ]);
    expect(results).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe('noerr');
    expect(errors[0]!.error).toBe('Unknown worker error');
  });

  it('restarts a worker at an out-of-range index', () => {
    pool = new EmbeddingWorkerPool(FIXTURE, 2);
    const result = pool.restartWorker(99);
    expect(result).toBe(true);
    expect(pool.getStats().restartedWorkers).toBe(1);
  });
});
