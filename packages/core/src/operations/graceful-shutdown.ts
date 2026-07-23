/**
 * Graceful Shutdown — handles process signals and orchestrates ordered shutdown.
 * Supports handler priorities, timeouts, pre/post hooks, and forced exit.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShutdownSignal = 'SIGTERM' | 'SIGINT' | 'SIGQUIT' | 'SIGHUP';

/** A registered shutdown handler with priority and timeout. */
export interface ShutdownHandler {
  name: string;
  priority: number; // higher = runs first
  timeout: number; // ms
  shutdown(): Promise<void>;
}

/** Result of a full shutdown sequence. */
export interface ShutdownResult {
  signal: ShutdownSignal;
  duration: number;
  handlers: {
    name: string;
    success: boolean;
    duration: number;
    error?: string;
  }[];
  success: boolean;
}

/** Options for GracefulShutdown. */
export interface GracefulShutdownOptions {
  /** Overall shutdown timeout in ms (default: 30000). */
  shutdownTimeout?: number;
  /** Time after which process.exit(1) is forced (default: 5000 after shutdownTimeout). */
  forceExitTimeout?: number;
  /** Signal to listen for (default: ['SIGTERM', 'SIGINT']. */
  signals?: ShutdownSignal[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a promise with a timeout. Rejects if not settled in time.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// GracefulShutdown
// ---------------------------------------------------------------------------

/**
 * Manages graceful shutdown with ordered handler execution,
 * timeouts, pre/post hooks, and forced exit.
 */
export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private beforeHooks: Array<() => Promise<void>> = [];
  private afterHooks: Array<(result: ShutdownResult) => void> = [];
  private shutdownTimeout: number;
  private forceExitTimeout: number;
  private signals: ShutdownSignal[];
  private shuttingDown = false;

  constructor(options: GracefulShutdownOptions = {}) {
    this.shutdownTimeout = options.shutdownTimeout ?? 30000;
    this.forceExitTimeout = options.forceExitTimeout ?? 5000;
    this.signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  }

  /**
   * Register a shutdown handler.
   * Handlers execute in descending priority order (highest first).
   */
  register(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Start listening for OS shutdown signals.
   * When a signal is received, the shutdown sequence begins automatically.
   */
  listen(): void {
    for (const sig of this.signals) {
      process.on(sig, () => {
        void this.shutdown(sig);
      });
    }
  }

  /**
   * Add a hook that fires before shutdown begins.
   */
  onBeforeShutdown(callback: () => Promise<void>): void {
    this.beforeHooks.push(callback);
  }

  /**
   * Add a hook that fires after shutdown completes.
   */
  onAfterShutdown(callback: (result: ShutdownResult) => void): void {
    this.afterHooks.push(callback);
  }

  /**
   * Manually trigger the shutdown sequence.
   *
   * @param signal - The signal that triggered shutdown.
   * @param manual - If true, does not force-exit (test mode).
   * @returns The shutdown result.
   */
  async shutdown(signal: ShutdownSignal, manual = false): Promise<ShutdownResult> {
    if (this.shuttingDown) {
      // Return a minimal result to avoid re-entrancy issues
      return {
        signal,
        duration: 0,
        handlers: [],
        success: false,
      };
    }
    this.shuttingDown = true;

    const start = Date.now();
    const handlerResults: ShutdownResult['handlers'] = [];

    // Run before hooks
    for (const hook of this.beforeHooks) {
      try {
        await hook();
      } catch {
        // Hook failures don't prevent shutdown
      }
    }

    // Sort handlers by priority (descending — highest first)
    const ordered = [...this.handlers].sort((a, b) => b.priority - a.priority);

    // Set up forced exit timeout
    let forceExitTimer: ReturnType<typeof setTimeout> | undefined;
    if (!manual) {
      const totalTimeout = this.shutdownTimeout + this.forceExitTimeout;
      forceExitTimer = setTimeout(() => {
        process.exit(1);
      }, totalTimeout);
      forceExitTimer.unref();
    }

    // Execute each handler with its own timeout
    for (const handler of ordered) {
      const handlerStart = Date.now();
      try {
        await withTimeout(
          handler.shutdown(),
          handler.timeout,
          `Shutdown handler "${handler.name}" timed out after ${handler.timeout}ms`
        );
        handlerResults.push({
          name: handler.name,
          success: true,
          duration: Date.now() - handlerStart,
        });
      } catch (err) {
        handlerResults.push({
          name: handler.name,
          success: false,
          duration: Date.now() - handlerStart,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Clear forced exit timer (all handlers completed or timed out)
    if (forceExitTimer) clearTimeout(forceExitTimer);

    const allSucceeded = handlerResults.every((r) => r.success);

    const result: ShutdownResult = {
      signal,
      duration: Date.now() - start,
      handlers: handlerResults,
      success: allSucceeded,
    };

    // Run after hooks
    for (const hook of this.afterHooks) {
      try {
        hook(result);
      } catch {
        // Hook failures are silent
      }
    }

    if (!manual && !allSucceeded) {
      process.exit(1);
    } else if (!manual) {
      process.exit(0);
    }

    return result;
  }
}
