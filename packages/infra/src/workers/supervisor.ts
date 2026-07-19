// @code-analyzer/infra — Index Supervisor
// Supervises indexing tasks with timeout, crash recovery, and quarantine.

import type {
  SupervisorResult,
  QuarantinedFile,
  CrashReport,
} from '../storage/types.js';

export interface SupervisorConfig {
  timeout: number;
  maxRetries: number;
  memoryLimit?: number;
}

export interface SupervisorOptions {
  progressCallback?: (file: string) => void;
}

export class IndexSupervisor {
  private config: SupervisorConfig;
  private quarantinedFiles: QuarantinedFile[];
  private crashReports: CrashReport[];

  constructor(config: SupervisorConfig) {
    this.config = {
      ...config,
      memoryLimit: config.memoryLimit ?? 512 * 1024 * 1024, // 512MB default
    };
    this.quarantinedFiles = [];
    this.crashReports = [];
  }

  async supervise(
    task: () => Promise<void>,
    _options?: SupervisorOptions,
  ): Promise<SupervisorResult> {
    const startTime = Date.now();
    let filesProcessed = 0;
    let filesFailed = 0;
    let peakMemory = 0;
    let status: SupervisorResult['status'] = 'complete';
    let taskSucceeded = false;

    const memoryWatcher = setInterval(() => {
      const usage = process.memoryUsage();
      const heapUsed = usage.heapUsed;
      if (heapUsed > peakMemory) {
        peakMemory = heapUsed;
      }
      // Check memory limit
      if (this.config.memoryLimit && heapUsed > this.config.memoryLimit) {
        this.quarantineFile(
          '__memory_watcher__',
          `Memory usage (${Math.round(heapUsed / 1024 / 1024)}MB) exceeded limit (${Math.round(this.config.memoryLimit / 1024 / 1024)}MB)`,
        );
      }
    }, 100);

    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      try {
        const taskPromise = task();

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Indexing task timed out after ${this.config.timeout}ms`));
          }, this.config.timeout);
        });

        await Promise.race([taskPromise, timeoutPromise]);

        // Success
        filesProcessed++;
        taskSucceeded = true;
        break;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        filesFailed++;
        attempt++;

        this.crashReports.push({
          filePath: 'indexing_task',
          error: error.message,
          stackTrace: error.stack,
          attemptNumber: attempt,
        });

        if (error.message.includes('timed out')) {
          status = 'timeout';
          break;
        }

        if (attempt > this.config.maxRetries) {
          status = 'crashed';
          break;
        }

        // Check if process has been running too long
        if (Date.now() - startTime > this.config.timeout * 2) {
          status = 'timeout';
          break;
        }
      }
    }

    clearInterval(memoryWatcher);

    const duration = Date.now() - startTime;

    // Determine final status based on execution outcome
    if (status === 'complete' || status === 'crashed' || status === 'timeout') {
      // Status already set by error handling
    }
    if (taskSucceeded && filesFailed === 0) {
      status = 'complete';
    } else if (taskSucceeded && filesFailed > 0) {
      status = 'complete'; // Task ultimately succeeded with retries
    } else if (!taskSucceeded && status !== 'timeout') {
      status = 'crashed';
    }

    return {
      status,
      filesProcessed,
      filesFailed,
      quarantinedFiles: this.quarantinedFiles,
      crashReports: this.crashReports,
      duration,
      peakMemory,
    };
  }

  getQuarantinedFiles(): QuarantinedFile[] {
    return [...this.quarantinedFiles];
  }

  clearQuarantine(filePath: string): void {
    this.quarantinedFiles = this.quarantinedFiles.filter(
      (f) => f.filePath !== filePath,
    );
  }

  private quarantineFile(filePath: string, error: string): void {
    const existing = this.quarantinedFiles.find((f) => f.filePath === filePath);
    if (!existing) {
      this.quarantinedFiles.push({
        filePath,
        error,
        quarantinedAt: new Date().toISOString(),
      });
    }
  }
}
