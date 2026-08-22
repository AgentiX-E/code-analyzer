// @code-analyzer/infra — Health Check System
// Composable health check registry for monitoring service dependencies.
// Supports dependency health tracking, aggregate status computation,
// and response time recording.

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheckResult {
  name: string;
  status: HealthStatus;
  message?: string;
  responseTimeMs?: number;
  timestamp: string;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  checks: HealthCheckResult[];
}

export type HealthCheckFn = () => Promise<{ status: HealthStatus; message?: string }>;

// ---------------------------------------------------------------------------
// HealthCheckRegistry
// ---------------------------------------------------------------------------

export class HealthCheckRegistry {
  private checks: Map<string, HealthCheckFn> = new Map();
  private startTime: number;
  private responseTimes: Map<string, number[]> = new Map();

  constructor() {
    this.startTime = Date.now();
  }

  /** Register a health check with a unique name. */
  register(name: string, check: HealthCheckFn): void {
    if (this.checks.has(name)) {
      throw new Error(`Health check "${name}" is already registered`);
    }
    this.checks.set(name, check);
  }

  /** Unregister a health check. */
  unregister(name: string): boolean {
    this.responseTimes.delete(name);
    return this.checks.delete(name);
  }

  /** Run all registered health checks and return a report. */
  async runAll(): Promise<HealthReport> {
    const results: HealthCheckResult[] = [];
    const checkNames = [...this.checks.keys()];

    for (const name of checkNames) {
      const checkFn = this.checks.get(name)!;
      const checkStart = Date.now();

      try {
        const result = await checkFn();
        const responseTimeMs = Date.now() - checkStart;

        // Track response time
        if (!this.responseTimes.has(name)) {
          this.responseTimes.set(name, []);
        }
        this.responseTimes.get(name)!.push(responseTimeMs);

        results.push({
          name,
          status: result.status,
          message: result.message,
          responseTimeMs,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name,
          status: 'unhealthy',
          message: `Check failed: ${message}`,
          responseTimeMs: Date.now() - checkStart,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return {
      status: this.computeAggregateStatus(results),
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      checks: results,
    };
  }

  /** Run a single health check by name. */
  async runOne(name: string): Promise<HealthCheckResult> {
    const checkFn = this.checks.get(name);
    if (!checkFn) {
      throw new Error(`Health check "${name}" not found`);
    }

    const checkStart = Date.now();
    try {
      const result = await checkFn();
      return {
        name,
        status: result.status,
        message: result.message,
        responseTimeMs: Date.now() - checkStart,
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      return {
        name,
        status: 'unhealthy',
        message: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
        responseTimeMs: Date.now() - checkStart,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /** Get average response time for a check. */
  getAverageResponseTime(name: string): number | null {
    const times = this.responseTimes.get(name);
    if (!times || times.length === 0) return null;
    return times.reduce((sum, t) => sum + t, 0) / times.length;
  }

  /** Get the number of registered checks. */
  get size(): number {
    return this.checks.size;
  }

  /** Reset response time history. */
  resetHistory(): void {
    this.responseTimes.clear();
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private computeAggregateStatus(results: HealthCheckResult[]): HealthStatus {
    if (results.length === 0) return 'healthy';

    const hasUnhealthy = results.some((r) => r.status === 'unhealthy');
    const hasDegraded = results.some((r) => r.status === 'degraded');

    if (hasUnhealthy) return 'unhealthy';
    if (hasDegraded) return 'degraded';
    return 'healthy';
  }
}

// ---------------------------------------------------------------------------
// Common Health Check Factories
// ---------------------------------------------------------------------------

/** Create a health check that verifies an object is non-null. */
export function createDependencyCheck(name: string, getDep: () => unknown): HealthCheckFn {
  return async () => {
    try {
      const dep = getDep();
      if (dep === null || dep === undefined) {
        return { status: 'unhealthy', message: `${name} is not initialized` };
      }
      return { status: 'healthy' };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `${name} check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

/** Create a health check that verifies a number is within bounds. */
export function createThresholdCheck(
  name: string,
  getValue: () => number,
  warnThreshold: number,
  criticalThreshold: number,
  unit: string = '',
): HealthCheckFn {
  return async () => {
    try {
      const value = getValue();
      if (value >= criticalThreshold) {
        return {
          status: 'unhealthy',
          message: `${name}: ${value}${unit} >= critical threshold ${criticalThreshold}${unit}`,
        };
      }
      if (value >= warnThreshold) {
        return {
          status: 'degraded',
          message: `${name}: ${value}${unit} >= warning threshold ${warnThreshold}${unit}`,
        };
      }
      return { status: 'healthy', message: `${name}: ${value}${unit}` };
    } catch (error: unknown) {
      return {
        status: 'unhealthy',
        message: `${name} check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}
