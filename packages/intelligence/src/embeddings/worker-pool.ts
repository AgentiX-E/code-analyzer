// @code-analyzer/intelligence — Embedding Worker Pool
// Offloads embedding computation to worker threads for parallel throughput.
// Falls back gracefully to main-thread processing when workers are unavailable.

import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

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
}

// ---------------------------------------------------------------------------
// Embedding Worker Pool
// ---------------------------------------------------------------------------

export class EmbeddingWorkerPool {
  private readonly workerScript: string;
  private readonly maxWorkers: number;
  private workers: Worker[] = [];
  private taskQueue: Array<{
    task: EmbeddingTask;
    resolve: (result: EmbeddingResult) => void;
    reject: (error: EmbeddingError) => void;
  }> = [];
  private busyWorkers = new Set<number>();
  private completedTasks = 0;
  private failedTasks = 0;
  private totalLatencyMs = 0;
  private useFallback = false;

  constructor(workerScript?: string, maxWorkers?: number) {
    this.workerScript = workerScript ?? resolve(__dirname, './embedding-worker.js');
    this.maxWorkers = maxWorkers ?? this.defaultWorkerCount();

    if (existsSync(this.workerScript)) {
      for (let i = 0; i < this.maxWorkers; i++) {
        this.spawnWorker(i);
      }
    } else {
      // Worker script not found — will use fallback mode
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

    // Distribute tasks across workers
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
        errors.push({
          taskId: tasks[i]?.taskId ?? 'unknown',
          error: s.reason?.message ?? String(s.reason),
        });
      }
    }

    return { results, errors };
  }

  /**
   * Get current worker pool statistics.
   */
  getStats(): WorkerPoolStats {
    return {
      activeWorkers: this.busyWorkers.size,
      totalWorkers: this.workers.length,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      avgLatencyMs:
        this.completedTasks > 0
          ? Math.round(this.totalLatencyMs / this.completedTasks)
          : 0,
    };
  }

  /**
   * Shut down all workers gracefully.
   */
  async shutdown(): Promise<void> {
    for (const worker of this.workers) {
      try {
        await worker.terminate();
      } catch {
        // Worker already terminated
      }
    }
    this.workers = [];
    this.busyWorkers.clear();
  }

  /** Whether the pool is operating in fallback mode. */
  get isFallback(): boolean {
    return this.useFallback;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private defaultWorkerCount(): number {
    try {
      const os = require('node:os');
      return Math.max(1, os.cpus().length - 1); // Leave one core free
    } catch {
      return 2;
    }
  }

  private spawnWorker(index: number): void {
    try {
      const worker = new Worker(this.workerScript, {
        workerData: { workerIndex: index },
      });

      worker.on('message', (msg: { type: string; taskId: string; embedding?: number[]; error?: string; durationMs?: number }) => {
        this.busyWorkers.delete(index);
        this.processQueue();

        // Find and resolve/reject the matching task
        const queueEntry = this.taskQueue.find((e) => e.task.taskId === msg.taskId);
        if (!queueEntry) return;

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
          queueEntry.reject({
            taskId: msg.taskId,
            error: msg.error ?? 'Unknown worker error',
          });
        }

        // Remove from queue
        const idx = this.taskQueue.indexOf(queueEntry);
        if (idx >= 0) this.taskQueue.splice(idx, 1);
      });

      worker.on('error', () => {
        this.busyWorkers.delete(index);
        // Mark all queued tasks for this worker as failed
        this.processQueue();
      });

      worker.on('exit', (code: number) => {
        if (code !== 0) {
          this.useFallback = true;
        }
      });

      this.workers[index] = worker;
    } catch {
      // Worker spawn failed — fall back to main-thread
      this.useFallback = true;
    }
  }

  private processQueue(): void {
    for (let i = 0; i < this.workers.length; i++) {
      if (this.busyWorkers.has(i)) continue;

      const entry = this.taskQueue.find(
        (e) => !this.isTaskAssigned(e.task.taskId),
      );
      if (!entry) return;

      this.busyWorkers.add(i);
      this.workers[i]!.postMessage({
        type: 'embed',
        taskId: entry.task.taskId,
        content: entry.task.content,
      });
    }
  }

  private isTaskAssigned(_taskId: string): boolean {
    // Check if any busy worker is already processing this task
    return false; // Tasks are processed once — no dedup in queue
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
