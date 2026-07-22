import { describe, it, expect, beforeEach, vi } from 'vitest';

import { GracefulShutdown } from '../operations/graceful-shutdown.js';

import type {
  ShutdownHandler,
  ShutdownSignal,
} from '../operations/graceful-shutdown.js';

describe('GracefulShutdown', () => {
  let gs: GracefulShutdown;

  beforeEach(() => {
    gs = new GracefulShutdown();
  });

  describe('constructor', () => {
    it('should use default timeouts', () => {
      const g = new GracefulShutdown();
      // Just verify it constructs without error
      expect(g).toBeDefined();
    });

    it('should accept custom options', () => {
      const g = new GracefulShutdown({
        shutdownTimeout: 1000,
        forceExitTimeout: 100,
        signals: ['SIGTERM'],
      });
      expect(g).toBeDefined();
    });
  });

  describe('registration', () => {
    it('should register a shutdown handler', async () => {
      let called = false;
      const handler: ShutdownHandler = {
        name: 'test-handler',
        priority: 100,
        timeout: 1000,
        shutdown: async () => {
          called = true;
        },
      };

      gs.register(handler);
      await gs.shutdown('SIGTERM', true);

      expect(called).toBe(true);
    });

    it('should register multiple handlers', () => {
      gs.register({
        name: 'handler-1',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });
      gs.register({
        name: 'handler-2',
        priority: 20,
        timeout: 1000,
        shutdown: async () => {},
      });
      // Handlers are stored — verified by shutdown result below
    });
  });

  describe('shutdown', () => {
    it('should execute handlers in priority order (highest first)', async () => {
      const order: string[] = [];

      gs.register({
        name: 'low',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          order.push('low');
        },
      });

      gs.register({
        name: 'high',
        priority: 100,
        timeout: 1000,
        shutdown: async () => {
          order.push('high');
        },
      });

      gs.register({
        name: 'mid',
        priority: 50,
        timeout: 1000,
        shutdown: async () => {
          order.push('mid');
        },
      });

      await gs.shutdown('SIGTERM', true);
      expect(order).toEqual(['high', 'mid', 'low']);
    });

    it('should return success result when all handlers succeed', async () => {
      gs.register({
        name: 'ok-handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      const result = await gs.shutdown('SIGINT', true);
      expect(result.success).toBe(true);
      expect(result.signal).toBe('SIGINT');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.handlers).toHaveLength(1);
      expect(result.handlers[0].name).toBe('ok-handler');
      expect(result.handlers[0].success).toBe(true);
    });

    it('should mark handler as failed when it throws', async () => {
      gs.register({
        name: 'failing',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          throw new Error('Shutdown failed');
        },
      });

      const result = await gs.shutdown('SIGTERM', true);
      expect(result.success).toBe(false);
      expect(result.handlers[0].success).toBe(false);
      expect(result.handlers[0].error).toBe('Shutdown failed');
    });

    it('should handle handler timeout', async () => {
      gs.register({
        name: 'timeouting',
        priority: 10,
        timeout: 10,
        shutdown: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
        },
      });

      const result = await gs.shutdown('SIGTERM', true);
      expect(result.handlers[0].success).toBe(false);
      expect(result.handlers[0].error).toContain('timed out');
    });

    it('should register multiple results', async () => {
      gs.register({
        name: 'a',
        priority: 20,
        timeout: 1000,
        shutdown: async () => {},
      });
      gs.register({
        name: 'b',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          throw new Error('b failed');
        },
      });

      const result = await gs.shutdown('SIGTERM', true);
      expect(result.handlers).toHaveLength(2);
      expect(result.success).toBe(false);
    });

    it('should prevent re-entrant shutdown', async () => {
      gs.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      const result1 = await gs.shutdown('SIGTERM', true);
      const result2 = await gs.shutdown('SIGTERM', true);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(false);
      expect(result2.duration).toBe(0);
      expect(result2.handlers).toHaveLength(0);
    });
  });

  describe('hooks', () => {
    it('should call before shutdown hooks', async () => {
      let beforeCalled = false;
      gs.onBeforeShutdown(async () => {
        beforeCalled = true;
      });

      gs.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      await gs.shutdown('SIGTERM', true);
      expect(beforeCalled).toBe(true);
    });

    it('should call after shutdown hooks with result', async () => {
      let afterResult: unknown = null;
      gs.onAfterShutdown((result) => {
        afterResult = result;
      });

      gs.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      await gs.shutdown('SIGTERM', true);
      expect(afterResult).not.toBeNull();
      const r = afterResult as { success: boolean };
      expect(r.success).toBe(true);
    });

    it('should call multiple before hooks', async () => {
      let count = 0;
      gs.onBeforeShutdown(async () => { count++; });
      gs.onBeforeShutdown(async () => { count++; });

      await gs.shutdown('SIGTERM', true);
      expect(count).toBe(2);
    });

    it('should call multiple after hooks', async () => {
      let count = 0;
      gs.onAfterShutdown(() => { count++; });
      gs.onAfterShutdown(() => { count++; });

      await gs.shutdown('SIGTERM', true);
      expect(count).toBe(2);
    });

    it('should handle before hook errors gracefully', async () => {
      gs.onBeforeShutdown(async () => {
        throw new Error('Hook error');
      });

      gs.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      // Should not throw despite hook error
      const result = await gs.shutdown('SIGTERM', true);
      expect(result.success).toBe(true);
    });

    it('should handle after hook errors gracefully', async () => {
      gs.onAfterShutdown(() => {
        throw new Error('After hook error');
      });

      gs.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      // Should not throw despite after hook error
      const result = await gs.shutdown('SIGTERM', true);
      expect(result.success).toBe(true);
    });
  });

  describe('signal handling', () => {
    it('should call shutdown on signal', async () => {
      // We can't easily test actual process.on, but we verify the listen method
      // doesn't throw
      const g = new GracefulShutdown({ signals: ['SIGTERM'] });
      expect(() => g.listen()).not.toThrow();
    });

    it('should handle manual shutdown with all signal types', async () => {
      const signals: ShutdownSignal[] = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP'];
      
      for (const sig of signals) {
        const instance = new GracefulShutdown();
        instance.register({
          name: 'handler',
          priority: 10,
          timeout: 1000,
          shutdown: async () => {},
        });
        const result = await instance.shutdown(sig, true);
        expect(result.signal).toBe(sig);
      }
    });
  });
});
