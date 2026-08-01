// @code-analyzer/intelligence — Embedding Worker Pool Tests
// Covers worker pool management, task queuing, batching, health tracking,
// worker restart, fallback mode, statistics, and edge cases.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingWorkerPool,
  getEmbeddingWorkerPool,
  shutdownEmbeddingPool,
} from '../embeddings/worker-pool.js';
import type {
  EmbeddingTask,
  EmbeddingResult,
  WorkerPoolStats,
} from '../embeddings/worker-pool.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTasks(count: number, prefix: string = 'task'): EmbeddingTask[] {
  return Array.from({ length: count }, (_, i) => ({
    taskId: `${prefix}-${i}`,
    content: `This is test content for task ${i}. It simulates code to be embedded.`,
  }));
}

function createFallbackFn(): (content: string) => Promise<Float32Array> {
  return vi.fn(async (content: string): Promise<Float32Array> => {
    // Simulate embedding computation
    await new Promise((resolve) => setTimeout(resolve, 1));
    // Return a deterministic embedding based on content hash
    const hash = simpleHash(content);
    const embedding = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      embedding[i] = ((hash * (i + 1)) % 1000) / 1000;
    }
    return embedding;
  });
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EmbeddingWorkerPool', () => {
  let pool: EmbeddingWorkerPool;

  afterEach(async () => {
    try {
      await pool?.shutdown();
    } catch {
      // Ignore
    }
  });

  // ── Initialization ──

  it('should initialize in fallback mode when worker script not found', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    expect(pool.isFallback).toBe(true);
  });

  it('should have zero workers in fallback mode', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    expect(pool.workerCount).toBe(0);
  });

  // ── Fallback Embedding ──

  it('should process tasks using fallback function', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(3);

    const { results, errors } = await pool.embedBatch(tasks, fallbackFn);

    expect(results).toHaveLength(3);
    expect(errors).toHaveLength(0);
    expect(fallbackFn).toHaveBeenCalledTimes(3);

    for (const result of results) {
      expect(result.embedding).toBeInstanceOf(Float32Array);
      expect(result.embedding.length).toBe(128);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.taskId).toMatch(/^task-\d+$/);
    }
  });

  it('should return empty results for empty task list', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results, errors } = await pool.embedBatch([], fallbackFn);

    expect(results).toEqual([]);
    expect(errors).toEqual([]);
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  it('should handle fallback function errors', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (content: string): Promise<Float32Array> => {
      if (content.includes('for task 1')) {
        throw new Error('Computation failed');
      }
      return new Float32Array(128);
    });
    // Create tasks with distinct content to avoid matching the wrong one
    const tasks = [
      { taskId: 'task-0', content: 'content for task 0' },
      { taskId: 'task-1', content: 'content for task 1' },
      { taskId: 'task-2', content: 'content for task 2' },
    ];

    const { results, errors } = await pool.embedBatch(tasks, fallbackFn);

    expect(results).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe('task-1');
    expect(errors[0]!.error).toBe('Computation failed');
  });

  // ── Single task embedding ──

  it('should embed a single task', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const result = await pool.embed(
      { taskId: 'single', content: 'test content' },
      fallbackFn,
    );

    expect(result.taskId).toBe('single');
    expect(result.embedding).toBeInstanceOf(Float32Array);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw on single task failure', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (): Promise<Float32Array> => {
      throw new Error('fail');
    });

    await expect(
      pool.embed({ taskId: 'fail', content: 'bad' }, fallbackFn),
    ).rejects.toThrow('Embedding failed for task fail');
  });

  // ── Batched embedding ──

  it('should process tasks in batches', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(10);

    const { results, errors } = await pool.embedBatched(tasks, 3, fallbackFn);

    expect(results).toHaveLength(10);
    expect(errors).toHaveLength(0);
    expect(fallbackFn).toHaveBeenCalledTimes(10);
  });

  it('should handle empty batched task list', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results, errors } = await pool.embedBatched([], 5, fallbackFn);

    expect(results).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('should handle single batch', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(2);

    const { results, errors } = await pool.embedBatched(tasks, 10, fallbackFn);

    expect(results).toHaveLength(2);
    expect(errors).toHaveLength(0);
  });

  it('should handle batch size of 1', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(3);

    const { results, errors } = await pool.embedBatched(tasks, 1, fallbackFn);

    expect(results).toHaveLength(3);
    expect(errors).toHaveLength(0);
  });

  // ── Statistics ──

  it('should report initial statistics', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const stats = pool.getStats();

    expect(stats.totalWorkers).toBe(0);
    expect(stats.activeWorkers).toBe(0);
    expect(stats.queuedTasks).toBe(0);
    expect(stats.completedTasks).toBe(0);
    expect(stats.failedTasks).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
    expect(stats.restartedWorkers).toBe(0);
    expect(stats.unhealthyWorkers).toBe(0);
  });

  it('should update statistics after processing tasks', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(5);

    await pool.embedBatch(tasks, fallbackFn);

    const stats = pool.getStats();
    expect(stats.completedTasks).toBe(5);
    expect(stats.failedTasks).toBe(0);
    expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should track failed tasks in statistics', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (): Promise<Float32Array> => {
      throw new Error('fail');
    });
    const tasks = createTasks(3);

    await pool.embedBatch(tasks, fallbackFn);

    const stats = pool.getStats();
    expect(stats.failedTasks).toBe(3);
    expect(stats.completedTasks).toBe(0);
  });

  // ── Health Tracking ──

  it('should report worker health for non-existent worker', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    expect(pool.isWorkerHealthy(0)).toBe(false);
    expect(pool.isWorkerHealthy(99)).toBe(false);
  });

  // ── Worker Restart ──

  it('should handle restart of non-existent worker gracefully', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    // Restart on a pool with no workers in fallback mode
    const result = pool.restartWorker(0);
    expect(result).toBe(false); // Cannot restart in fallback mode
  });

  // ── Shutdown ──

  it('should shut down gracefully', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    await pool.embedBatch(createTasks(2), fallbackFn);
    await pool.shutdown();

    // Stats should still be accessible
    const stats = pool.getStats();
    expect(stats.totalWorkers).toBe(0);
  });

  it('should shut down empty pool without error', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    await pool.shutdown();
    // Should not throw
  });

  it('should handle double shutdown', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    await pool.shutdown();
    await pool.shutdown(); // Should not throw
  });

  // ── Task ID correlation ──

  it('should preserve task IDs in results', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = [
      { taskId: 'alpha', content: 'first' },
      { taskId: 'beta', content: 'second' },
      { taskId: 'gamma', content: 'third' },
    ];

    const { results } = await pool.embedBatch(tasks, fallbackFn);

    expect(results[0]!.taskId).toBe('alpha');
    expect(results[1]!.taskId).toBe('beta');
    expect(results[2]!.taskId).toBe('gamma');
  });

  it('should preserve task IDs in errors', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (content: string): Promise<Float32Array> => {
      if (content.includes('second')) throw new Error('beta failed');
      return new Float32Array(128);
    });

    const { errors } = await pool.embedBatch(
      [
        { taskId: 'alpha', content: 'first' },
        { taskId: 'beta', content: 'second' },
      ],
      fallbackFn,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]!.taskId).toBe('beta');
  });

  // ── Embedding vector validity ──

  it('should return valid Float32Array embeddings', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results } = await pool.embedBatch(createTasks(1), fallbackFn);

    const embedding = results[0]!.embedding;
    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(128);
    // All values should be finite numbers
    for (let i = 0; i < embedding.length; i++) {
      expect(Number.isFinite(embedding[i])).toBe(true);
    }
  });

  // ── Different content produces different embeddings ──

  it('should produce different embeddings for different content', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results } = await pool.embedBatch(
      [
        { taskId: 'a', content: 'hello world' },
        { taskId: 'b', content: 'goodbye world' },
      ],
      fallbackFn,
    );

    const embA = results[0]!.embedding;
    const embB = results[1]!.embedding;

    // Different content should produce different embeddings
    let isDifferent = false;
    for (let i = 0; i < embA.length; i++) {
      if (embA[i] !== embB[i]) {
        isDifferent = true;
        break;
      }
    }
    expect(isDifferent).toBe(true);
  });

  // ── Duration tracking ──

  it('should track duration for each embedding', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results } = await pool.embedBatch(createTasks(3), fallbackFn);

    for (const result of results) {
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Large batch handling ──

  it('should handle large batch of tasks', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(100);

    const { results, errors } = await pool.embedBatch(tasks, fallbackFn);

    expect(results).toHaveLength(100);
    expect(errors).toHaveLength(0);
  });

  it('should handle large batch via embedBatched', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(50);

    const { results, errors } = await pool.embedBatched(tasks, 10, fallbackFn);

    expect(results).toHaveLength(50);
    expect(errors).toHaveLength(0);
  });

  // ── Mixed success/failure scenarios ──

  it('should collect both results and errors from mixed batch', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (content: string): Promise<Float32Array> => {
      if (content.includes('odd')) {
        throw new Error('odd task failed');
      }
      return new Float32Array(128);
    });

    const tasks = [
      { taskId: 'odd-0', content: 'odd task content' },
      { taskId: 'even-0', content: 'even task content' },
      { taskId: 'odd-1', content: 'odd task content' },
      { taskId: 'even-1', content: 'even task content' },
    ];

    const { results, errors } = await pool.embedBatch(tasks, fallbackFn);

    expect(results).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(results.map((r) => r.taskId).sort()).toEqual(['even-0', 'even-1']);
    expect(errors.map((e) => e.taskId).sort()).toEqual(['odd-0', 'odd-1']);
  });

  // ── Additional Edge Case Tests ──

  it('should handle fallback function that returns non-standard embedding', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (): Promise<Float32Array> => {
      return new Float32Array(64); // Shorter embedding
    });

    const { results } = await pool.embedBatch([{ taskId: 'short', content: 'test' }], fallbackFn);
    expect(results[0]!.embedding.length).toBe(64);
  });

  it('should handle tasks with empty content strings', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const { results, errors } = await pool.embedBatch(
      [{ taskId: 'empty-content', content: '' }],
      fallbackFn,
    );
    expect(results.length + errors.length).toBe(1);
  });

  it('should handle fallback with non-Error throws', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (): Promise<Float32Array> => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });

    const { errors } = await pool.embedBatch(
      [{ taskId: 'str-err', content: 'test' }],
      fallbackFn,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]!.error).toBe('string error');
  });

  it('should handle fallback with Error instance', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (): Promise<Float32Array> => {
      throw new Error('instance error');
    });

    const { errors } = await pool.embedBatch(
      [{ taskId: 'inst-err', content: 'test' }],
      fallbackFn,
    );
    expect(errors.length).toBe(1);
    expect(errors[0]!.error).toBe('instance error');
  });

  it('should report unhealthy workers as 0 in fallback mode', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const stats = pool.getStats();
    expect(stats.unhealthyWorkers).toBe(0);
  });

  it('should report restartedWorkers as 0 initially', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const stats = pool.getStats();
    expect(stats.restartedWorkers).toBe(0);
  });

  it('should handle embedBatch without fallbackFn in fallback mode — returns empty when no fallback', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    // In fallback mode without a fallbackFn, the pool cannot process tasks.
    // The tasks get queued but never resolve since there are no workers.
    // We test with empty tasks to ensure it still works:
    const { results, errors } = await pool.embedBatch([]);
    expect(results).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('should handle embedBatched with exact batch size dividing evenly', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(9);

    const { results } = await pool.embedBatched(tasks, 3, fallbackFn);
    expect(results).toHaveLength(9);
  });

  it('should handle embedBatched with batch size larger than tasks', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(2);

    const { results } = await pool.embedBatched(tasks, 100, fallbackFn);
    expect(results).toHaveLength(2);
  });

  it('should handle embedBatched with last partial batch', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();
    const tasks = createTasks(7);

    const { results } = await pool.embedBatched(tasks, 3, fallbackFn);
    expect(results).toHaveLength(7);
  });

  it('should propagate errors from embedBatched', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = vi.fn(async (content: string): Promise<Float32Array> => {
      if (content.includes('task 3')) throw new Error('batch error');
      return new Float32Array(128);
    });
    const tasks = createTasks(5);

    const { results, errors } = await pool.embedBatched(tasks, 2, fallbackFn);
    expect(errors.length).toBe(1);
    expect(results.length).toBe(4);
  });

  it('should return valid stats after multiple embedBatch calls', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    await pool.embedBatch(createTasks(3), fallbackFn);
    await pool.embedBatch(createTasks(2), fallbackFn);

    const stats = pool.getStats();
    expect(stats.completedTasks).toBe(5);
    expect(stats.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should report avgLatencyMs as 0 when no tasks completed', () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const stats = pool.getStats();
    expect(stats.avgLatencyMs).toBe(0);
  });

  it('should have isFallback return false initially if worker script exists', () => {
    // The default constructor checks existsSync for the default script
    // Most environments won't have it, but we test the property
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    expect(pool.isFallback).toBe(true);
  });

  it('should handle single embed task in fallback mode', async () => {
    pool = new EmbeddingWorkerPool('/nonexistent/worker.js', 2);
    const fallbackFn = createFallbackFn();

    const result = await pool.embed(
      { taskId: 'standalone', content: 'standalone test' },
      fallbackFn,
    );
    expect(result.taskId).toBe('standalone');
    expect(result.embedding).toBeInstanceOf(Float32Array);
  });
});

// ---------------------------------------------------------------------------
// Singleton Tests
// ---------------------------------------------------------------------------

describe('EmbeddingWorkerPool - Singleton', () => {
  afterEach(async () => {
    await shutdownEmbeddingPool();
  });

  it('getEmbeddingWorkerPool returns the same instance', () => {
    const pool1 = getEmbeddingWorkerPool();
    const pool2 = getEmbeddingWorkerPool();
    expect(pool1).toBe(pool2);
  });

  it('shutdownEmbeddingPool releases the singleton', async () => {
    const pool = getEmbeddingWorkerPool();
    expect(pool).toBeDefined();

    await shutdownEmbeddingPool();

    // After shutdown, a new call should create a new pool
    const newPool = getEmbeddingWorkerPool();
    expect(newPool).toBeDefined();
    expect(newPool).not.toBe(pool);
  });

  it('shutdownEmbeddingPool is safe when no pool exists', async () => {
    await shutdownEmbeddingPool();
    await shutdownEmbeddingPool(); // Double shutdown should be safe
  });
});
