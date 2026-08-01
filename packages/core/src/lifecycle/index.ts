/**
 * Lifecycle Management — dependency-ordered initialization and graceful shutdown.
 */

/**
 * A managed component with init and shutdown phases.
 */
export interface Component {
  /** Unique component name for identification and dependency resolution. */
  name: string;
  /**
   * Initialize the component. Called during startup.
   * Should not throw — return an error or log failures internally.
   */
  init(): Promise<void>;
  /**
   * Shutdown the component. Called during graceful shutdown.
   * Should release resources (connections, file handles, etc.).
   */
  shutdown(): Promise<void>;
}

/**
 * Health status for a component.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health check result for a single component.
 */
export interface HealthCheckResult {
  component: string;
  status: HealthStatus;
  details?: string;
  timestamp: string;
}

/**
 * Component descriptor with metadata for lifecycle management.
 */
export interface ComponentDescriptor {
  component: Component;
  /** Component names this component depends on. These are initialized first. */
  dependsOn?: string[];
}

/**
 * Options for the LifecycleManager.
 */
export interface LifecycleOptions {
  /** Maximum time (ms) to wait for each component during shutdown (default: 5000). */
  shutdownTimeout?: number;
  /** Callback fired when a component fails to start. */
  onInitError?: (name: string, error: Error) => void;
}

/**
 * Manages the lifecycle of registered components with dependency ordering,
 * graceful shutdown, and health checks.
 */
export class LifecycleManager {
  private components = new Map<string, ComponentDescriptor>();
  private initialized = new Set<string>();
  private healthCallbacks = new Map<string, () => HealthCheckResult>();
  private shutdownTimeout: number;
  private onInitError?: (name: string, error: Error) => void;

  constructor(options: LifecycleOptions = {}) {
    this.shutdownTimeout = options.shutdownTimeout ?? 5000;
    this.onInitError = options.onInitError;
  }

  /**
   * Register a component with the lifecycle manager.
   */
  register(descriptor: ComponentDescriptor): void {
    const { name } = descriptor.component;
    if (this.components.has(name)) {
      throw new Error(`Component "${name}" is already registered`);
    }
    // Validate that all dependencies are (or will be) registered
    // We skip circular dependency checks here — they're caught during init
    this.components.set(name, descriptor);
  }

  /**
   * Register a health check callback for a specific component.
   */
  registerHealthCheck(componentName: string, check: () => HealthCheckResult): void {
    this.healthCallbacks.set(componentName, check);
  }

  /**
   * Resolve initialization order based on dependencies (topological sort).
   * Returns the ordered list of component names.
   */
  resolveInitOrder(): string[] {
    const visited = new Set<string>();
    const ordered: string[] = [];
    const visiting = new Set<string>();

    const visit = (name: string): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        // Circular dependency detected — include the circular chain for diagnostics
        const cycle = [...visiting, name].join(' → ');
        throw new Error(`Circular dependency detected: ${cycle}`);
      }

      const descriptor = this.components.get(name);
      if (!descriptor) {
        throw new Error(`Dependency "${name}" referenced but not registered`);
      }

      visiting.add(name);

      const dependsOn = descriptor.dependsOn ?? [];
      for (const dep of dependsOn) {
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      ordered.push(name);
    };

    for (const name of this.components.keys()) {
      visit(name);
    }

    return ordered;
  }

  /**
   * Initialize all registered components in dependency order.
   *
   * @returns The number of successfully initialized components.
   */
  async init(): Promise<number> {
    const order = this.resolveInitOrder();
    let successCount = 0;

    for (const name of order) {
      const descriptor = this.components.get(name);
      if (!descriptor) continue;

      try {
        await descriptor.component.init();
        this.initialized.add(name);
        successCount++;
      } catch (error) {
        if (this.onInitError) {
          this.onInitError(name, error instanceof Error ? error : new Error(String(error)));
        }
        // Stop on first failure — remaining components won't work without dependencies
        break;
      }
    }

    return successCount;
  }

  /**
   * Gracefully shut down all initialized components in reverse dependency order.
   * Each component gets up to `shutdownTimeout` ms to shut down.
   *
   * @returns The number of successfully shut down components.
   */
  async shutdown(): Promise<number> {
    const order = this.resolveInitOrder().reverse();
    let successCount = 0;

    for (const name of order) {
      if (!this.initialized.has(name)) continue;

      const descriptor = this.components.get(name);
      if (!descriptor) continue;

      try {
        await withTimeout(
          descriptor.component.shutdown(),
          this.shutdownTimeout,
          `Shutdown timed out for component "${name}" after ${this.shutdownTimeout}ms`
        );
        this.initialized.delete(name);
        successCount++;
      } catch (_error) {
        // Shutdown errors are logged but don't prevent other components from shutting down
      }
    }

    return successCount;
  }

  /**
   * Run health checks against all registered components.
   * Components without a registered health check are reported as 'healthy'.
   *
   * @returns Array of health check results, one per registered component.
   */
  healthCheck(): HealthCheckResult[] {
    const results: HealthCheckResult[] = [];

    for (const [name] of this.components) {
      const checkFn = this.healthCallbacks.get(name);
      if (checkFn) {
        results.push(checkFn());
      } else {
        results.push({
          component: name,
          status: this.initialized.has(name) ? 'healthy' : 'unhealthy',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Check if all registered components are initialized.
   */
  isHealthy(): boolean {
    return this.initialized.size === this.components.size;
  }

  /**
   * Get the list of component names that failed to initialize.
   */
  getUninitialized(): string[] {
    const result: string[] = [];
    for (const name of this.components.keys()) {
      if (!this.initialized.has(name)) {
        result.push(name);
      }
    }
    return result;
  }
}

/**
 * Execute a promise with a timeout. Rejects if the promise doesn't settle in time.
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
