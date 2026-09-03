// @code-analyzer/intelligence — Embedding Worker Pool
// Manages a pool of embedding computation workers with task queuing,
// batching support, health tracking, and automatic worker restart.
// Falls back gracefully to main-thread processing when workers are unavailable.

import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { cpus } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingTask {
  /** Unique task ID for correlation */
  taskId: string;
  /** The text/content to embed */
  content: string;
}

export interface EmbeddingResult {
  /** Task ID matching the request */
  taskId: string;
  /** Computed embedding vector */
  embedding: Float32Array;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface EmbeddingError {
  taskId: string;
  error: string;
}

export interface WorkerPoolStats {
  activeWorkers: number;
  totalWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgLatencyMs: number;
  restartedWorkers: number;
  unhealthyWorkers: number;
}

interface WorkerState {
  worker: Worker;
  index: number;
  healthy: boolean;
  taskCount: number;
  errorCount: number;
  lastHeartbeat: number;
}

// ---------------------------------------------------------------------------
// Embedding Worker Pool
// ---------------------------------------------------------------------------

export class EmbeddingWorkerPool {
  private readonly workerScript: string;
  private readonly maxWorkers: number;
  private readonly maxErrorsPerWorker: number;
  private readonly healthCheckIntervalMs: number;

  private workerStates: WorkerState[] = [];
  private taskQueue: Array<{
    task: EmbeddingTask;
    resolve: (result: EmbeddingResult) => void;
    reject: (error: EmbeddingError) => void;
  }> = [];
  private busyWorkers = new Set<number>();
  /** Task IDs currently dispatched to (or awaiting a reply from) a worker. */
  private dispatchedTasks = new Set<string>();
  private completedTasks = 0;
  private failedTasks = 0;
  private restartedWorkers = 0;
  private totalLatencyMs = 0;
  private useFallback = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(workerScript?: string, maxWorkers?: number) {
    this.workerScript = workerScript ?? resolve(__dirname, './embedding-worker.js');
    this.maxWorkers = maxWorkers ?? this.defaultWorkerCount();
    this.maxErrorsPerWorker = 5;
    this.healthCheckIntervalMs = 30000; // 30 seconds

    if (existsSync(this.workerScript)) {
      for (let i = 0; i < this.maxWorkers; i++) {
        this.spawnWorker(i);
      }
      this.startHealthCheck();
    } else {
      this.useFallback = true;
    }
  }

  /**
   * Submit a batch of embedding tasks for parallel processing.
   * Falls back to sequential main-thread processing if workers are unavailable.
   */
  async embedBatch(
    tasks: EmbeddingTask[],
    fallbackFn?: (content: string) => Promise<Float32Array>,
  ): Promise<{ results: EmbeddingResult[]; errors: EmbeddingError[] }> {
    if (this.useFallback && fallbackFn) {
      return this.fallbackEmbed(tasks, fallbackFn);
    }

    if (tasks.length === 0) {
      return { results: [], errors: [] };
    }

    const promises: Promise<EmbeddingResult>[] = [];
    const errors: EmbeddingError[] = [];

    for (const task of tasks) {
      promises.push(
        new Promise<EmbeddingResult>((resolve, reject) => {
          this.taskQueue.push({ task, resolve, reject });
          this.processQueue();
        }),
      );
    }

    const settled = await Promise.allSettled(promises);
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i]!;
      if (s.status === 'fulfilled') {
        results.push(s.value);
      } else {
        // The queue's reject callback is typed `(error: EmbeddingError) => void`,
        // so every rejection carries a string `error` field. The defensive
        // `?.message` / `String(reason)` fallbacks and the `?? 'unknown'`
        // taskId fallback were unreachable and are omitted.
        const reason = s.reason as EmbeddingError;
        errors.push({
          taskId: tasks[i]!.taskId,
          error: reason.error,
        });
      }
    }

    return { results, errors };
  }

  /**
   * Submit a single embedding task.
   */
  async embed(
    task: EmbeddingTask,
    fallbackFn?: (content: string) => Promise<Float32Array>,
  ): Promise<EmbeddingResult> {
    const { results, errors } = await this.embedBatch([task], fallbackFn);
    if (errors.length > 0) {
      throw new Error(`Embedding failed for task ${task.taskId}: ${errors[0]!.error}`);
    }
    return results[0]!;
  }

  /**
   * Submit tasks in optimized batches for throughput.
   * Groups tasks into batches before dispatching to workers.
   */
  async embedBatched(
    tasks: EmbeddingTask[],
    batchSize: number,
    fallbackFn?: (content: string) => Promise<Float32Array>,
  ): Promise<{ results: EmbeddingResult[]; errors: EmbeddingError[] }> {
    if (tasks.length === 0) {
      return { results: [], errors: [] };
    }

    const allResults: EmbeddingResult[] = [];
    const allErrors: EmbeddingError[] = [];

    // Split into batches
    for (let i = 0; i < tasks.length; i += batchSize) {
      const batch = tasks.slice(i, i + batchSize);
      const { results, errors } = await this.embedBatch(batch, fallbackFn);
      allResults.push(...results);
      allErrors.push(...errors);
    }

    return { results: allResults, errors: allErrors };
  }

  /**
   * Get current worker pool statistics.
   */
  getStats(): WorkerPoolStats {
    const unhealthyCount = this.workerStates.filter((ws) => !ws.healthy).length;

    return {
      activeWorkers: this.busyWorkers.size,
      totalWorkers: this.workerStates.length,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      avgLatencyMs:
        this.completedTasks > 0 ? Math.round(this.totalLatencyMs / this.completedTasks) : 0,
      restartedWorkers: this.restartedWorkers,
      unhealthyWorkers: unhealthyCount,
    };
  }

  /**
   * Check if a specific worker is healthy.
   */
  isWorkerHealthy(workerIndex: number): boolean {
    const state = this.workerStates[workerIndex];
    if (!state) return false;
    return state.healthy;
  }

  /**
   * Restart a failed worker at the given index.
   */
  restartWorker(workerIndex: number): boolean {
    if (this.useFallback) {
      return false; // No workers to restart in fallback mode
    }

    const oldState = this.workerStates[workerIndex];
    if (oldState) {
      try {
        oldState.worker.terminate();
      } catch {
        // Worker may already be dead
      }
      this.busyWorkers.delete(workerIndex);
    }

    this.spawnWorker(workerIndex);
    this.restartedWorkers++;
    return true;
  }

  /**
   * Shut down all workers gracefully.
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Reject all pending tasks
    for (const entry of this.taskQueue) {
      entry.reject({
        taskId: entry.task.taskId,
        error: 'Worker pool shutting down',
      });
    }
    this.taskQueue = [];

    for (const state of this.workerStates) {
      try {
        await state.worker.terminate();
      } catch {
        // Worker already terminated
      }
    }
    this.workerStates = [];
    this.busyWorkers.clear();
  }

  /** Whether the pool is operating in fallback mode. */
  get isFallback(): boolean {
    return this.useFallback;
  }

  /** Get the number of workers. */
  get workerCount(): number {
    return this.workerStates.length;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private defaultWorkerCount(): number {
    // Leave one core free for the main thread; never spawn fewer than one.
    return Math.max(1, cpus().length - 1);
  }

  private spawnWorker(index: number): void {
    // `new Worker` does not throw synchronously for a missing or malformed
    // script on the supported Node runtimes (>=20); those failures surface
    // through the 'error' event handler below. The previous try/catch here was
    // therefore unreachable and is omitted.
    const worker = new Worker(this.workerScript, {
      workerData: { workerIndex: index },
    });

    const state: WorkerState = {
      worker,
      index,
      healthy: true,
      taskCount: 0,
      errorCount: 0,
      lastHeartbeat: Date.now(),
    };

    worker.on(
      'message',
      (msg: {
        type: string;
        taskId: string;
        embedding?: number[];
        error?: string;
        durationMs?: number;
      }) => {
        state.lastHeartbeat = Date.now();
        state.taskCount++;

        this.busyWorkers.delete(index);
        this.processQueue();

        // Find matching task in queue
        const queueIdx = this.taskQueue.findIndex((e) => e.task.taskId === msg.taskId);
        if (queueIdx < 0) return;

        const queueEntry = this.taskQueue[queueIdx]!;
        this.taskQueue.splice(queueIdx, 1);
        this.dispatchedTasks.delete(msg.taskId);

        if (msg.type === 'result' && msg.embedding) {
          this.completedTasks++;
          this.totalLatencyMs += msg.durationMs ?? 0;
          queueEntry.resolve({
            taskId: msg.taskId,
            embedding: new Float32Array(msg.embedding),
            durationMs: msg.durationMs ?? 0,
          });
        } else {
          this.failedTasks++;
          state.errorCount++;
          queueEntry.reject({
            taskId: msg.taskId,
            error: msg.error ?? 'Unknown worker error',
          });

          // Mark unhealthy if too many errors
          if (state.errorCount >= this.maxErrorsPerWorker) {
            state.healthy = false;
          }
        }
      },
    );

    worker.on('error', (_err) => {
      state.healthy = false;
      state.errorCount++;
      this.busyWorkers.delete(index);
      this.processQueue();
    });

    worker.on('exit', (code: number) => {
      state.healthy = false;
      this.busyWorkers.delete(index);

      if (code !== 0 && !this.useFallback) {
        // Auto-restart on unexpected exit
        if (this.workerStates.every((ws) => !ws.healthy)) {
          this.useFallback = true;
        }
      }
    });

    this.workerStates[index] = state;
  }

  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    for (const state of this.workerStates) {
      if (!state.healthy) continue;
      if (this.busyWorkers.has(state.index)) continue;

      // Find a task not yet dispatched to any worker
      const entry = this.taskQueue.find((e) => !this.isTaskAssigned(e.task.taskId));
      if (!entry) break;

      this.busyWorkers.add(state.index);
      this.dispatchedTasks.add(entry.task.taskId);
      state.worker.postMessage({
        type: 'embed',
        taskId: entry.task.taskId,
        content: entry.task.content,
      });
    }
  }

  private isTaskAssigned(taskId: string): boolean {
    return this.dispatchedTasks.has(taskId);
  }

  private async fallbackEmbed(
    tasks: EmbeddingTask[],
    fn: (content: string) => Promise<Float32Array>,
  ): Promise<{ results: EmbeddingResult[]; errors: EmbeddingError[] }> {
    const results: EmbeddingResult[] = [];
    const errors: EmbeddingError[] = [];

    for (const task of tasks) {
      try {
        const start = Date.now();
        const embedding = await fn(task.content);
        results.push({
          taskId: task.taskId,
          embedding,
          durationMs: Date.now() - start,
        });
        this.completedTasks++;
      } catch (err) {
        this.failedTasks++;
        errors.push({
          taskId: task.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { results, errors };
  }

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      const now = Date.now();
      for (const state of this.workerStates) {
        // Check if worker hasn't responded in a while
        if (
          state.healthy &&
          state.lastHeartbeat > 0 &&
          now - state.lastHeartbeat > this.healthCheckIntervalMs * 2
        ) {
          state.healthy = false;
        }
      }
    }, this.healthCheckIntervalMs);
  }
}

// ---------------------------------------------------------------------------
// Singleton helpers
// ---------------------------------------------------------------------------

let defaultPool: EmbeddingWorkerPool | null = null;

/** Get or create the singleton embedding worker pool. */
export function getEmbeddingWorkerPool(
  _fallbackFn?: (content: string) => Promise<Float32Array>,
): EmbeddingWorkerPool {
  if (!defaultPool) {
    defaultPool = new EmbeddingWorkerPool();
  }
  return defaultPool;
}

/** Shut down and release the singleton pool. */
export async function shutdownEmbeddingPool(): Promise<void> {
  if (defaultPool) {
    await defaultPool.shutdown();
    defaultPool = null;
  }
}
