// @code-analyzer/infra — Worker Pool
// Lightweight worker pool for parallel task execution.

export interface WorkerTask<T> {
  id: string;
  execute(): Promise<T>;
  timeout?: number;
  retries?: number;
}

export interface WorkerPool {
  execute<T>(task: WorkerTask<T>): Promise<T>;
  executeAll<T>(tasks: WorkerTask<T>[]): Promise<T[]>;
  shutdown(): void;
  readonly activeCount: number;
  readonly queuedCount: number;
}

export function createWorkerPool(concurrency: number = 4): WorkerPool {
  let activeCount = 0;
  const pendingTasks: Array<() => void> = [];
  let isShutdown = false;

  async function acquireSlot(): Promise<void> {
    if (activeCount < concurrency) {
      activeCount++;
      return;
    }
    return new Promise<void>((resolve) => {
      pendingTasks.push(resolve);
    });
  }

  function releaseSlot(): void {
    activeCount--;
    const next = pendingTasks.shift();
    if (next) {
      activeCount++;
      next();
    }
  }

  async function executeTask<T>(task: WorkerTask<T>): Promise<T> {
    const maxRetries = task.retries ?? 0;
    const timeout = task.timeout ?? 30000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await Promise.race([
          task.execute(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Task "${task.id}" timed out after ${timeout}ms`)),
              timeout,
            ),
          ),
        ]);
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          // Small delay before retry
          await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error(`Task "${task.id}" failed after ${maxRetries + 1} attempts`);
  }

  return {
    get activeCount(): number {
      return activeCount;
    },

    get queuedCount(): number {
      return pendingTasks.length;
    },

    async execute<T>(task: WorkerTask<T>): Promise<T> {
      if (isShutdown) {
        throw new Error('WorkerPool has been shut down');
      }

      await acquireSlot();
      try {
        return await executeTask(task);
      } finally {
        releaseSlot();
      }
    },

    async executeAll<T>(tasks: WorkerTask<T>[]): Promise<T[]> {
      if (isShutdown) {
        throw new Error('WorkerPool has been shut down');
      }

      // Execute all tasks with concurrency limit
      const results = await Promise.all(
        tasks.map((task) => this.execute(task)),
      );
      return results;
    },

    shutdown(): void {
      isShutdown = true;
      // Reject all pending tasks
      for (const resolve of pendingTasks) {
        resolve(); // Let them fail naturally with shutdown check
      }
      pendingTasks.length = 0;
    },
  };
}
