// @code-analyzer/infra — Circuit Breaker
// Circuit breaker pattern for resilient operations.

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  resetTimeout?: number;
}

export class CircuitBreaker {
  private failureCount: number;
  private successCount: number;
  private stateInternal: CircuitState;
  private readonly failureThreshold: number;
  private readonly successThreshold: number;
  private readonly resetTimeout: number;
  private openTimer: ReturnType<typeof setTimeout> | null;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureCount = 0;
    this.successCount = 0;
    this.stateInternal = 'closed';
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 3;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.openTimer = null;
  }

  get state(): CircuitState {
    return this.stateInternal;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.stateInternal === 'open') {
      throw new Error('Circuit breaker is OPEN — operation rejected');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.stateInternal === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.transitionTo('closed');
      }
    }
    // In closed state, reset failure count on success
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount++;

    if (
      this.stateInternal === 'closed' &&
      this.failureCount >= this.failureThreshold
    ) {
      this.transitionTo('open');
    }

    if (this.stateInternal === 'half-open') {
      this.transitionTo('open');
    }
  }

  private transitionTo(state: CircuitState): void {
    this.stateInternal = state;
    this.failureCount = 0;
    this.successCount = 0;

    if (state === 'open') {
      if (this.openTimer) clearTimeout(this.openTimer);
      this.openTimer = setTimeout(() => {
        this.transitionTo('half-open');
      }, this.resetTimeout);
    }

    if (state === 'half-open' || state === 'closed') {
      if (this.openTimer) {
        clearTimeout(this.openTimer);
        this.openTimer = null;
      }
    }
  }

  /** Reset the circuit breaker to closed state */
  reset(): void {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    this.failureCount = 0;
    this.successCount = 0;
    this.stateInternal = 'closed';
  }
}
