// @code-analyzer/infra — CircuitBreaker Tests

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CircuitBreaker } from '../workers/circuit-breaker.js';
import type { CircuitBreakerOptions } from '../workers/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  describe('constructor and defaults', () => {
    it('uses default options', () => {
      const cb = new CircuitBreaker();
      expect(cb.state).toBe('closed');
    });

    it('accepts partial options', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      expect(cb.state).toBe('closed');
    });

    it('accepts all options', () => {
      const cb = new CircuitBreaker({
        failureThreshold: 10,
        successThreshold: 5,
        resetTimeout: 60000,
      });
      expect(cb.state).toBe('closed');
    });

    it('accepts empty options object', () => {
      const cb = new CircuitBreaker({});
      expect(cb.state).toBe('closed');
    });
  });

  describe('closed state', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 3 });
    });

    it('executes successful operations', async () => {
      const result = await breaker.execute(async () => 42);
      expect(result).toBe(42);
      expect(breaker.state).toBe('closed');
    });

    it('executes async operations', async () => {
      const result = await breaker.execute(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 'async';
      });
      expect(result).toBe('async');
    });

    it('propagates errors from failed operations', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('custom error');
        }),
      ).rejects.toThrow('custom error');
    });

    it('stays closed when failures are below threshold', async () => {
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('closed');
    });

    it('resets failure count on success', async () => {
      // Fail twice
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      // Succeed once - resets failure count
      await breaker.execute(async () => 'ok');
      // Fail twice more - still below threshold of 3
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('closed');
    });
  });

  describe('open state', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 5000 });
    });

    it('opens after reaching failure threshold', async () => {
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('open');
    });

    it('rejects operations immediately in open state', async () => {
      // Trip
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('open');

      // Should reject immediately
      await expect(breaker.execute(async () => 'nope')).rejects.toThrow(
        'Circuit breaker is OPEN',
      );
    });

    it('opens on first failure in half-open state', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 3,
        resetTimeout: 50,
      });

      // Trip to open
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }

      // Wait for half-open
      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');

      // One failure in half-open should open
      try {
        await breaker.execute(async () => {
          throw new Error('fail in half-open');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('open');
    });

    it('opens exactly at threshold (not below)', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 3 });
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('closed');
    });
  });

  describe('half-open state', () => {
    it('transitions to half-open after reset timeout', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 50,
      });

      // Trip
      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('open');

      // Wait for timeout
      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');
    });

    it('transitions to closed after success threshold in half-open', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 3,
        resetTimeout: 50,
      });

      // Trip
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }

      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');

      // 3 successes should close
      await breaker.execute(async () => 'ok1');
      expect(breaker.state).toBe('half-open');
      await breaker.execute(async () => 'ok2');
      expect(breaker.state).toBe('half-open');
      await breaker.execute(async () => 'ok3');
      expect(breaker.state).toBe('closed');
    });

    it('success count resets when half-open transitions to closed', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 2,
        successThreshold: 1,
        resetTimeout: 50,
      });

      // Trip
      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }

      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');

      // Success should close
      await breaker.execute(async () => 'ok');
      expect(breaker.state).toBe('closed');

      // Can fail again without immediately opening (counter was reset)
      try {
        await breaker.execute(async () => {
          throw new Error('new fail');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('closed'); // only 1 failure
    });

    it('half-open failure immediately opens', async () => {
      breaker = new CircuitBreaker({
        failureThreshold: 3,
        successThreshold: 3,
        resetTimeout: 50,
      });

      // Trip
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }

      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');

      // Fail in half-open - should immediately open
      try {
        await breaker.execute(async () => {
          throw new Error('fail in half-open');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('open');
    });
  });

  describe('reset', () => {
    it('resets from open to closed', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 5000 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('open');

      breaker.reset();
      expect(breaker.state).toBe('closed');
    });

    it('resets from half-open to closed', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }

      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('half-open');

      breaker.reset();
      expect(breaker.state).toBe('closed');
    });

    it('clears the open timer on reset', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
      expect(breaker.state).toBe('open');

      // Reset immediately
      breaker.reset();
      expect(breaker.state).toBe('closed');

      // Wait for the original timer (should have been cleared)
      await new Promise((r) => setTimeout(r, 60));
      expect(breaker.state).toBe('closed'); // should NOT be half-open
    });

    it('allows operations after reset', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 1 });

      try {
        await breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }

      breaker.reset();
      const result = await breaker.execute(async () => 42);
      expect(result).toBe(42);
    });
  });

  describe('error propagation', () => {
    beforeEach(() => {
      breaker = new CircuitBreaker({ failureThreshold: 5 });
    });

    it('propagates Error instances', async () => {
      await expect(
        breaker.execute(async () => {
          throw new Error('specific message');
        }),
      ).rejects.toThrow('specific message');
    });

    it('propagates non-Error exceptions', async () => {
      await expect(
        breaker.execute(async () => {
          // eslint-disable-next-line no-throw-literal
          throw 'string error';
        }),
      ).rejects.toThrow(); // The error is re-thrown as-is
    });

    it('propagates null exceptions', async () => {
      await expect(
        breaker.execute(async () => {
          // eslint-disable-next-line no-throw-literal
          throw null;
        }),
      ).rejects.toThrow();
    });

    it('propagates undefined exceptions', async () => {
      await expect(
        breaker.execute(async () => {
          // eslint-disable-next-line no-throw-literal
          throw undefined;
        }),
      ).rejects.toThrow();
    });
  });

  describe('state getter', () => {
    it('returns correct state value', () => {
      const cb = new CircuitBreaker();
      expect(cb.state).toBe('closed');
      expect(typeof cb.state).toBe('string');
    });
  });

  describe('edge cases', () => {
    it('handles rapid successive failures', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 10 });
      for (let i = 0; i < 9; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error(`fail ${i}`);
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('closed');
    });

    it('handles failure at exact threshold', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 3 });
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }
      expect(breaker.state).toBe('open');
    });

    it('handles success after threshold - already in open', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 2 });

      for (let i = 0; i < 2; i++) {
        try {
          await breaker.execute(async () => {
            throw new Error('fail');
          });
        } catch {
          // expected
        }
      }

      // In open state, success is rejected
      await expect(breaker.execute(async () => 'success')).rejects.toThrow('OPEN');
    });

    it('handles multiple concurrent operations in closed state', async () => {
      breaker = new CircuitBreaker({ failureThreshold: 100 });

      const ops = Array.from({ length: 10 }, (_, i) =>
        breaker.execute(async () => i),
      );
      const results = await Promise.all(ops);
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(breaker.state).toBe('closed');
    });
  });
});
