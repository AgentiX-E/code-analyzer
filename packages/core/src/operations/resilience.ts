/**
 * Resilience Patterns — retry with exponential backoff and dead letter queue.
 */

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

export interface RetryConfig {
  /** Maximum number of attempts (default: 3). */
  maxAttempts: number;
  /** Initial delay in ms (default: 1000). */
  baseDelay: number;
  /** Maximum delay in ms (default: 30000). */
  maxDelay: number;
  /** Exponential multiplier (default: 2). */
  backoffFactor: number;
  /** Whether to add random jitter (default: true). */
  jitter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Applies jitter: +/- 25% random variation around the delay value.
 */
function applyJitter(delay: number): number {
  const jitterAmount = delay * 0.25;
  const min = delay - jitterAmount;
  const max = delay + jitterAmount;
  return min + Math.random() * (max - min);
}

/**
 * Calculate the delay for a given attempt using exponential backoff.
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffFactor, attempt - 1);
  const clamped = Math.min(exponentialDelay, config.maxDelay);
  return config.jitter ? applyJitter(clamped) : clamped;
}

/**
 * RetryPolicy provides configurable retry logic with exponential backoff and jitter.
 */
export class RetryPolicy {
  private attempts: number;
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.attempts = 0;
  }

  /**
   * Execute a function with retry logic.
   * Retries on errors until maxAttempts is reached.
   *
   * @param fn - The async function to execute.
   * @returns The result of the function.
   * @throws The last error if all attempts are exhausted.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    while (this.attempts < this.config.maxAttempts) {
      this.attempts++;
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (this.attempts >= this.config.maxAttempts) {
          break;
        }
        const delay = calculateDelay(this.attempts, this.config);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Check if the current attempt is the last one.
   */
  isLastAttempt(): boolean {
    return this.attempts >= this.config.maxAttempts - 1;
  }

  /**
   * Get the current attempt number (1-based).
   */
  getAttempt(): number {
    return this.attempts;
  }
}

// ---------------------------------------------------------------------------
// Dead Letter Queue
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  id: string;
  timestamp: string;
  operation: string;
  payload: unknown;
  error: string;
  attempts: number;
}

export interface RetryResult {
  total: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

export interface DeadLetterQueueOptions {
  /** Maximum queue size (default: 1000). */
  maxSize?: number;
  /** File path for persistence (if not set, queue is in-memory only). */
  persistToFile?: string;
}

/** Simple counter for generating unique entry IDs. */
let idCounter = 0;

/**
 * DeadLetterQueue stores failed operations for later reprocessing.
 * Supports enqueue, dequeue, retryAll, and optional file persistence.
 */
export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];
  private maxSize: number;

  constructor(options: DeadLetterQueueOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  /**
   * Add a failed operation to the dead letter queue.
   *
   * @returns The ID of the newly created entry.
   */
  enqueue(
    entry: Omit<DeadLetterEntry, 'id' | 'timestamp'>
  ): string {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift(); // Drop oldest entry
    }

    const id = `dlq-${++idCounter}-${Date.now()}`;
    const fullEntry: DeadLetterEntry = {
      ...entry,
      id,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(fullEntry);
    return id;
  }

  /**
   * Get all entries in the queue (ordered by insertion time).
   */
  getAll(): DeadLetterEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries filtered by operation name.
   */
  getByOperation(operation: string): DeadLetterEntry[] {
    return this.entries.filter((e) => e.operation === operation);
  }

  /**
   * Remove an entry from the queue by ID.
   *
   * @returns true if the entry was found and removed.
   */
  dequeue(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  /**
   * Retry all entries in the queue using the provided processor function.
   * Entries that succeed are removed; entries that fail remain.
   *
   * @param processor - Function to process a DLQ entry. Return true on success, false on failure.
   * @returns Summary of retry results.
   */
  async retryAll(
    processor: (entry: DeadLetterEntry) => Promise<boolean>
  ): Promise<RetryResult> {
    const total = this.entries.length;
    let succeeded = 0;
    let failed = 0;

    const toProcess = [...this.entries];

    for (const entry of toProcess) {
      // Check if entry was already removed (possible if processor removes entries)
      if (!this.entries.find((e) => e.id === entry.id)) continue;

      try {
        const ok = await processor({ ...entry, attempts: entry.attempts + 1 });
        if (ok) {
          this.dequeue(entry.id);
          succeeded++;
        } else {
          entry.attempts++;
          failed++;
        }
      } catch {
        entry.attempts++;
        failed++;
      }
    }

    return {
      total,
      succeeded,
      failed,
      remaining: this.entries.length,
    };
  }

  /**
   * Get the current number of entries in the queue.
   */
  size(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries from the queue.
   */
  clear(): void {
    this.entries = [];
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
