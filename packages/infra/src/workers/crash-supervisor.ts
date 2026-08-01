// @code-analyzer/infra — Crash Supervisor
// Wraps worker execution with timeout, crash handling, and file quarantine.
// Pattern: executeWithSupervision wraps async tasks, catches errors,
// quarantines problematic files after repeated failures.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrashStats {
  totalCrashes: number;
  quarantinedFiles: string[];
  recentFailures: Array<{ filePath: string; error: string; timestamp: string }>;
}

// ---------------------------------------------------------------------------
// CrashSupervisor
// ---------------------------------------------------------------------------

export class CrashSupervisor {
  /** Files that consistently cause crashes — indexed by path */
  private readonly quarantinedFiles = new Map<string, number>();
  /** Failure count per file (reset after quarantine) */
  private readonly failureCounts = new Map<string, number>();
  /** Total crash count across all files */
  private totalCrashes = 0;
  /** Recent failures for debugging */
  private recentFailures: Array<{ filePath: string; error: string; timestamp: string }> = [];
  /** Maximum recent failures to track */
  private readonly maxRecentFailures: number;
  /** Number of consecutive failures before quarantine */
  private readonly quarantineThreshold: number;
  /** Default timeout in ms for supervised tasks */
  readonly defaultTimeout: number;

  constructor(options?: {
    quarantineThreshold?: number;
    defaultTimeout?: number;
    maxRecentFailures?: number;
  }) {
    this.quarantineThreshold = options?.quarantineThreshold ?? 3;
    this.defaultTimeout = options?.defaultTimeout ?? 30000;
    this.maxRecentFailures = options?.maxRecentFailures ?? 100;
  }

  /**
   * Execute a task with crash supervision.
   * If the task throws or times out, the file may be quarantined.
   *
   * @param task — Async function to execute
   * @param filePath — File being processed (for quarantine tracking)
   * @param timeout — Timeout in ms (default: this.defaultTimeout)
   * @returns Task result
   * @throws Error if task fails or times out
   */
  async executeWithSupervision<T>(
    task: () => Promise<T>,
    filePath: string,
    timeout?: number,
  ): Promise<T> {
    // Check if file is already quarantined
    if (this.isQuarantined(filePath)) {
      throw new Error(`SKIP_QUARANTINED: File "${filePath}" is quarantined after repeated crashes`);
    }

    const effectiveTimeout = timeout ?? this.defaultTimeout;

    try {
      const result = await Promise.race([
        task(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`TIMEOUT: Task for "${filePath}" exceeded ${effectiveTimeout}ms`)), effectiveTimeout),
        ),
      ]);

      // Success — reset failure count
      this.failureCounts.delete(filePath);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.totalCrashes++;

      // Track recent failure
      this.recentFailures.push({
        filePath,
        error: message,
        timestamp: new Date().toISOString(),
      });
      if (this.recentFailures.length > this.maxRecentFailures) {
        this.recentFailures = this.recentFailures.slice(-this.maxRecentFailures);
      }

      // Increment failure count
      const count = (this.failureCounts.get(filePath) ?? 0) + 1;
      this.failureCounts.set(filePath, count);

      // Quarantine after threshold
      if (count >= this.quarantineThreshold) {
        this.quarantineFile(filePath);
      }

      throw err;
    }
  }

  /**
   * Quarantine a file: mark it as problematic so future calls skip it.
   */
  quarantineFile(filePath: string): void {
    this.quarantinedFiles.set(filePath, Date.now());
  }

  /**
   * Check if a file is quarantined.
   */
  isQuarantined(filePath: string): boolean {
    return this.quarantinedFiles.has(filePath);
  }

  /**
   * Clear quarantine for a file (after fixing the issue).
   */
  clearQuarantine(filePath: string): void {
    this.quarantinedFiles.delete(filePath);
    this.failureCounts.delete(filePath);
  }

  /**
   * Clear all quarantined files.
   */
  clearAllQuarantines(): void {
    this.quarantinedFiles.clear();
    this.failureCounts.clear();
  }

  /**
   * Get crash statistics.
   */
  getCrashStats(): CrashStats {
    return {
      totalCrashes: this.totalCrashes,
      quarantinedFiles: Array.from(this.quarantinedFiles.keys()),
      recentFailures: [...this.recentFailures],
    };
  }

  /**
   * Reset all crash tracking data.
   */
  reset(): void {
    this.quarantinedFiles.clear();
    this.failureCounts.clear();
    this.totalCrashes = 0;
    this.recentFailures = [];
  }
}
