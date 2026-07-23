/**
 * Health Check — application health monitoring with built-in and custom checks.
 * Supports readiness probes, liveness probes, and configurable timeouts.
 */

import * as os from 'node:os';
import v8 from 'node:v8';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Overall health status of the application. */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number; // ms
  timestamp: string;
  version: string;
  checks: HealthCheckResult[];
}

/** Result of a single health check. */
export interface HealthCheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  latency?: number;
  details?: Record<string, unknown>;
}

/** A health check function with metadata. */
export interface HealthCheck {
  name: string;
  check(): Promise<HealthCheckResult>;
  timeout?: number;
  critical?: boolean;
}

/** Options for the HealthCheckRegistry. */
export interface HealthCheckRegistryOptions {
  /** Application version string (default: '0.0.0'). */
  version?: string;
  /** Default timeout for checks in ms (default: 5000). */
  defaultTimeout?: number;
  /** Memory usage threshold percentage (0-100, default: 90). */
  memoryThreshold?: number;
  /** Custom store connectivity check function. */
  storeCheck?: () => Promise<boolean>;
  /** Custom worker pool check function. */
  workerPoolCheck?: () => Promise<boolean>;
  /** Custom disk space check function. Returns available bytes. */
  diskCheck?: () => Promise<number>;
  /** Minimum available disk space in bytes (default: 100 * 1024 * 1024, i.e. 100MB). */
  minDiskSpace?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a promise with a timeout.
 * Rejects if the promise doesn't settle in time.
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
// Built-in Health Checks
// ---------------------------------------------------------------------------

/** Check heap memory usage. Returns fail if usage exceeds threshold. */
function createMemoryCheck(thresholdPercent: number): HealthCheck {
  return {
    name: 'memory-usage',
    check: async (): Promise<HealthCheckResult> => {
      const stats = v8.getHeapStatistics();
      const usedPercent =
        (stats.used_heap_size / stats.heap_size_limit) * 100;
      const heapStats = {
        heapUsed: stats.used_heap_size,
        heapTotal: stats.heap_size_limit,
        usedPercent: Math.round(usedPercent * 100) / 100,
        thresholdPercent,
      };

      if (usedPercent >= thresholdPercent) {
        return {
          name: 'memory-usage',
          status: 'fail',
          message: `Heap usage ${usedPercent.toFixed(1)}% exceeds threshold ${thresholdPercent}%`,
          details: heapStats,
        };
      }

      return {
        name: 'memory-usage',
        status: 'pass',
        message: `Heap usage ${usedPercent.toFixed(1)}% within limit`,
        details: heapStats,
      };
    },
    critical: true,
  };
}

/** Check disk space. Returns warn if below threshold. */
function createDiskCheck(
  minSpaceBytes: number,
  diskCheckFn?: () => Promise<number>
): HealthCheck {
  const diskFn =
    diskCheckFn ??
    (async (): Promise<number> => {
      return os.freemem();
    });

  return {
    name: 'disk-space',
    check: async (): Promise<HealthCheckResult> => {
      try {
        const available = await diskFn();
        if (available < minSpaceBytes) {
          return {
            name: 'disk-space',
            status: 'warn',
            message: `Available space (${available} bytes) below minimum (${minSpaceBytes} bytes)`,
            details: { availableBytes: available, minBytes: minSpaceBytes },
          };
        }
        return {
          name: 'disk-space',
          status: 'pass',
          message: `Available space ${available} bytes`,
          details: { availableBytes: available, minBytes: minSpaceBytes },
        };
      } catch {
        return {
          name: 'disk-space',
          status: 'warn',
          message: 'Unable to check disk space',
        };
      }
    },
  };
}

/** Check store connectivity via a custom check function. */
function createStoreCheck(storeCheckFn?: () => Promise<boolean>): HealthCheck {
  return {
    name: 'store-connectivity',
    check: async (): Promise<HealthCheckResult> => {
      const checkFn = storeCheckFn ?? (async () => true);
      try {
        const ok = await checkFn();
        return {
          name: 'store-connectivity',
          status: ok ? 'pass' : 'fail',
          message: ok ? 'Store is reachable' : 'Store is unreachable',
        };
      } catch (err) {
        return {
          name: 'store-connectivity',
          status: 'fail',
          message: `Store check failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
    critical: true,
  };
}

/** Check worker pool health via a custom check function. */
function createWorkerPoolCheck(
  workerCheckFn?: () => Promise<boolean>
): HealthCheck {
  return {
    name: 'worker-pool',
    check: async (): Promise<HealthCheckResult> => {
      const checkFn = workerCheckFn ?? (async () => true);
      try {
        const ok = await checkFn();
        return {
          name: 'worker-pool',
          status: ok ? 'pass' : 'fail',
          message: ok ? 'Worker pool is healthy' : 'Worker pool is degraded',
        };
      } catch (err) {
        return {
          name: 'worker-pool',
          status: 'fail',
          message: `Worker pool check failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// HealthCheckRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for managing and running health checks.
 * Supports startup/shutdown, readiness and liveness probes.
 */
export class HealthCheckRegistry {
  private checks: Map<string, HealthCheck> = new Map();
  private version: string;
  private defaultTimeout: number;
  private startTime: number;

  constructor(options: HealthCheckRegistryOptions = {}) {
    this.version = options.version ?? '0.0.0';
    this.defaultTimeout = options.defaultTimeout ?? 5000;
    this.startTime = Date.now();

    // Register built-in checks
    const memoryCheck = createMemoryCheck(options.memoryThreshold ?? 90);
    const diskCheck = createDiskCheck(
      options.minDiskSpace ?? 100 * 1024 * 1024,
      options.diskCheck
    );
    const storeCheck = createStoreCheck(options.storeCheck);
    const workerCheck = createWorkerPoolCheck(options.workerPoolCheck);

    this.checks.set(memoryCheck.name, memoryCheck);
    this.checks.set(diskCheck.name, diskCheck);
    this.checks.set(storeCheck.name, storeCheck);
    this.checks.set(workerCheck.name, workerCheck);
  }

  /**
   * Register a custom health check. Overwrites any existing check with the same name.
   */
  register(check: HealthCheck): void {
    this.checks.set(check.name, check);
  }

  /**
   * Unregister a health check by name.
   */
  unregister(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Get a registered health check by name.
   */
  getCheck(name: string): HealthCheck | undefined {
    return this.checks.get(name);
  }

  /**
   * Run all registered health checks.
   */
  async runAll(): Promise<HealthStatus> {
    const checkEntries = Array.from(this.checks.values());
    const results: HealthCheckResult[] = [];
    const start = Date.now();

    for (const hc of checkEntries) {
      const timeout = hc.timeout ?? this.defaultTimeout;
      const checkStart = Date.now();
      try {
        const result = await withTimeout(
          hc.check(),
          timeout,
          `Health check "${hc.name}" timed out after ${timeout}ms`
        );
        result.latency = Date.now() - checkStart;
        results.push(result);
      } catch (err) {
        results.push({
          name: hc.name,
          status: 'fail',
          message: err instanceof Error ? err.message : String(err),
          latency: Date.now() - checkStart,
        });
      }
    }

    // Determine overall status
    let hasCriticalFailure = false;
    let hasDegradation = false;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const hc = checkEntries[i];
      if (result.status === 'fail') {
        if (hc.critical) {
          hasCriticalFailure = true;
        } else {
          hasDegradation = true;
        }
      } else if (result.status === 'warn') {
        hasDegradation = true;
      }
    }

    const status = hasCriticalFailure
      ? 'unhealthy'
      : hasDegradation
        ? 'degraded'
        : 'healthy';

    return {
      status,
      uptime: Date.now() - this.startTime,
      timestamp: new Date(start).toISOString(),
      version: this.version,
      checks: results,
    };
  }

  /**
   * Run a single check by name.
   */
  async runOne(name: string): Promise<HealthCheckResult> {
    const hc = this.checks.get(name);
    if (!hc) {
      return {
        name,
        status: 'fail',
        message: `Health check "${name}" not found`,
      };
    }

    const timeout = hc.timeout ?? this.defaultTimeout;
    const checkStart = Date.now();
    try {
      const result = await withTimeout(
        hc.check(),
        timeout,
        `Health check "${name}" timed out after ${timeout}ms`
      );
      result.latency = Date.now() - checkStart;
      return result;
    } catch (err) {
      return {
        name,
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
        latency: Date.now() - checkStart,
      };
    }
  }

  /**
   * Check readiness — is the service ready to accept requests?
   * Returns true when all critical checks pass.
   */
  async readiness(): Promise<boolean> {
    const result = await this.runAll();
    return result.status !== 'unhealthy';
  }

  /**
   * Check liveness — is the service alive?
   * Returns true when at least some checks pass.
   */
  async liveness(): Promise<boolean> {
    const result = await this.runAll();
    // Liveness is more lenient — just need some checks passing
    const failures = result.checks.filter((c) => c.status === 'fail');
    return failures.length < result.checks.length;
  }

  /**
   * Get the number of registered checks.
   */
  get size(): number {
    return this.checks.size;
  }

  /**
   * Create a default HealthCheckRegistry with all built-in checks.
   */
  static createDefault(): HealthCheckRegistry {
    return new HealthCheckRegistry();
  }
}
