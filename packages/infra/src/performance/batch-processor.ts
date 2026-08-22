// @code-analyzer/infra — Batch Processor
// Processes items in configurable batches with progress tracking,
// error collection, and concurrent execution control.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchProcessorOptions {
  /** Maximum number of items per batch (default: 50) */
  batchSize?: number;
  /** Maximum number of concurrent batch executions (default: 3) */
  concurrency?: number;
  /** Continue processing remaining batches when a batch fails */
  continueOnError?: boolean;
  /** Called after each batch completes */
  onProgress?: (progress: BatchProgress) => void;
}

export interface BatchProgress {
  /** Total number of items across all batches */
  totalItems: number;
  /** Number of items processed so far */
  processedItems: number;
  /** Number of completed batches */
  completedBatches: number;
  /** Total number of batches */
  totalBatches: number;
  /** Percentage completion (0–100) */
  percentComplete: number;
}

export interface BatchResult<T> {
  /** All successful results, in order */
  results: T[];
  /** Errors collected (keyed by batch index) */
  errors: Map<number, Error[]>;
  /** Total items processed */
  totalProcessed: number;
  /** Count of failed items */
  failedCount: number;
  /** Whether all batches succeeded */
  success: boolean;
}

// ---------------------------------------------------------------------------
// BatchProcessor
// ---------------------------------------------------------------------------

export class BatchProcessor<T> {
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly continueOnError: boolean;
  private readonly onProgress?: (progress: BatchProgress) => void;
  private aborted: boolean;

  constructor(options: BatchProcessorOptions = {}) {
    this.batchSize = options.batchSize ?? 50;
    this.concurrency = options.concurrency ?? 3;
    this.continueOnError = options.continueOnError ?? true;
    this.onProgress = options.onProgress;
    this.aborted = false;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Process items in batches using the provided handler function.
   * Each item is passed to the handler, and results are collected.
   */
  async process(
    items: T[],
    handler: (item: T, index: number) => Promise<T>,
  ): Promise<BatchResult<T>> {
    if (items.length === 0) {
      return {
        results: [],
        errors: new Map(),
        totalProcessed: 0,
        failedCount: 0,
        success: true,
      };
    }

    const batches = this.createBatches(items);
    const totalBatches = batches.length;
    let processedItems = 0;
    const allResults: T[] = [];
    const batchErrors = new Map<number, Error[]>();

    // Process batches with concurrency control
    for (let i = 0; i < batches.length; i += this.concurrency) {
      if (this.aborted) break;

      const chunk = batches.slice(i, i + this.concurrency);
      const batchPromises = chunk.map((batch, chunkIdx) => {
        const batchIndex = i + chunkIdx;
        return this.processBatch(batch, handler, batchIndex);
      });

      const results = await Promise.allSettled(batchPromises);

      for (let j = 0; j < results.length; j++) {
        const batchIndex = i + j;
        const result = results[j]!;
        const batch = batches[batchIndex]!;

        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
          processedItems += batch.length;
        } else {
          // Batch-level failure
          const errors =
            result.reason instanceof Error ? [result.reason] : [new Error(String(result.reason))];
          batchErrors.set(batchIndex, errors);
          if (!this.continueOnError) break;
        }

        // Report progress
        if (this.onProgress) {
          this.onProgress({
            totalItems: items.length,
            processedItems,
            completedBatches: batchIndex + 1,
            totalBatches,
            percentComplete: Math.round((processedItems / items.length) * 100),
          });
        }
      }
    }

    return {
      results: allResults,
      errors: batchErrors,
      totalProcessed: allResults.length,
      failedCount: Array.from(batchErrors.values()).reduce((sum, errs) => sum + errs.length, 0),
      success: batchErrors.size === 0,
    };
  }

  /**
   * Process items and transform results. Each item is passed to the handler,
   * and the handler returns a transformed value.
   */
  async processMap<I, O>(
    items: I[],
    handler: (item: I, index: number) => Promise<O>,
  ): Promise<BatchResult<O>> {
    if (items.length === 0) {
      return {
        results: [],
        errors: new Map(),
        totalProcessed: 0,
        failedCount: 0,
        success: true,
      };
    }

    const allResults: O[] = [];
    const batchErrors = new Map<number, Error[]>();
    let processedItems = 0;

    const batches = this.createBatchesGeneric(items);
    const totalBatches = batches.length;

    for (let i = 0; i < batches.length; i += this.concurrency) {
      if (this.aborted) break;

      const concurrentBatches = batches.slice(i, i + this.concurrency);
      const batchPromises = concurrentBatches.map((batch, batchIndex) =>
        this.processMapBatch(batch, handler, i + batchIndex),
      );

      const results = await Promise.allSettled(batchPromises);

      for (let j = 0; j < results.length; j++) {
        const batchIndex = i + j;
        const result = results[j]!;
        const batch = batches[batchIndex]!;

        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
          processedItems += batch.length;
        } else {
          const errors =
            result.reason instanceof Error ? [result.reason] : [new Error(String(result.reason))];
          batchErrors.set(batchIndex, errors);
          if (!this.continueOnError) break;
        }

        if (this.onProgress) {
          this.onProgress({
            totalItems: items.length,
            processedItems,
            completedBatches: batchIndex + 1,
            totalBatches,
            percentComplete: Math.round((processedItems / items.length) * 100),
          });
        }
      }
    }

    return {
      results: allResults,
      errors: batchErrors,
      totalProcessed: allResults.length,
      failedCount: Array.from(batchErrors.values()).reduce((sum, errs) => sum + errs.length, 0),
      success: batchErrors.size === 0,
    };
  }

  private async processMapBatch<I, O>(
    batch: I[],
    handler: (item: I, index: number) => Promise<O>,
    batchIndex: number,
  ): Promise<O[]> {
    const results: O[] = [];
    for (let i = 0; i < batch.length; i++) {
      const globalIndex = batchIndex * this.batchSize + i;
      results.push(await handler(batch[i]!, globalIndex));
    }
    return results;
  }

  /**
   * Abort processing. Already-running batches will complete, but no new
   * batches will be started.
   */
  abort(): void {
    this.aborted = true;
  }

  /** Reset the aborted flag so processing can resume. */
  reset(): void {
    this.aborted = false;
  }

  /** Whether processing has been aborted. */
  get isAborted(): boolean {
    return this.aborted;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private createBatches(items: T[]): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      batches.push(items.slice(i, i + this.batchSize));
    }
    return batches;
  }

  private createBatchesGeneric<U>(items: U[]): U[][] {
    const batches: U[][] = [];
    for (let i = 0; i < items.length; i += this.batchSize) {
      batches.push(items.slice(i, i + this.batchSize));
    }
    return batches;
  }

  private async processBatch(
    batch: T[],
    handler: (item: T, index: number) => Promise<T>,
    batchIndex: number,
  ): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < batch.length; i++) {
      const result = await handler(batch[i]!, i + batchIndex * this.batchSize);
      results.push(result);
    }
    return results;
  }
}
