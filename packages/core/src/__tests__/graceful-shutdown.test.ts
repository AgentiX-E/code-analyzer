import { describe, it, expect, beforeEach, vi } from 'vitest';

import { GracefulShutdown } from '../operations/graceful-shutdown.js';

import type {
  ShutdownHandler,
  ShutdownSignal,
  ShutdownResult,
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

    it('should handle non-Error throws in handler', async () => {
      gs.register({
        name: 'string-throw',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'plain string error';
        },
      });

      const result = await gs.shutdown('SIGTERM', true);
      expect(result.success).toBe(false);
      expect(result.handlers[0].success).toBe(false);
      expect(result.handlers[0].error).toBe('plain string error');
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
      gs.onBeforeShutdown(async () => {
        count++;
      });
      gs.onBeforeShutdown(async () => {
        count++;
      });

      await gs.shutdown('SIGTERM', true);
      expect(count).toBe(2);
    });

    it('should call multiple after hooks', async () => {
      let count = 0;
      gs.onAfterShutdown(() => {
        count++;
      });
      gs.onAfterShutdown(() => {
        count++;
      });

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
    it('should install listeners through process.on by default', () => {
      // The default registrar must be wired to process.on; spying on it keeps the
      // test process free of real signal listeners.
      const onSpy = vi.spyOn(process, 'on').mockImplementation((() => process) as never);

      const g = new GracefulShutdown({ signals: ['SIGTERM'] });
      g.listen();

      expect(onSpy).toHaveBeenCalledTimes(1);
      expect(onSpy.mock.calls[0]![0]).toBe('SIGTERM');
      expect(typeof onSpy.mock.calls[0]![1]).toBe('function');

      onSpy.mockRestore();
    });

    it('should register a listener for every configured signal', () => {
      const registered: Array<[ShutdownSignal, () => void]> = [];
      const g = new GracefulShutdown({ signals: ['SIGTERM', 'SIGQUIT'] });

      g.listen((signal, listener) => registered.push([signal, listener]));

      expect(registered.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGQUIT']);
      expect(registered.every(([, listener]) => typeof listener === 'function')).toBe(true);
    });

    it('should run the shutdown sequence when a captured signal listener fires', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const listeners = new Map<ShutdownSignal, () => void>();
      const results: ShutdownResult[] = [];
      let handlerRuns = 0;

      const g = new GracefulShutdown();
      g.register({
        name: 'db',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          handlerRuns++;
        },
      });
      g.onAfterShutdown((result) => results.push(result));
      // Capture the installed listeners instead of emitting a real OS signal.
      g.listen((signal, listener) => listeners.set(signal, listener));

      listeners.get('SIGTERM')!();
      // The listener delegates with `void`, so let the async sequence settle.
      await new Promise((resolve) => setImmediate(resolve));

      expect(handlerRuns).toBe(1);
      expect(results).toHaveLength(1);
      expect(results[0]!.signal).toBe('SIGTERM');
      expect(results[0]!.success).toBe(true);
      // A successful non-manual shutdown completes the force-exit path.
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
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

  describe('non-manual shutdown (process.exit mocking)', () => {
    it('should call process.exit(0) when all handlers succeed (non-manual)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const g = new GracefulShutdown({ shutdownTimeout: 100, forceExitTimeout: 50 });
      g.register({
        name: 'ok-handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      await g.shutdown('SIGTERM', false);
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });

    it('should call process.exit(1) when a handler fails (non-manual)', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const g = new GracefulShutdown({ shutdownTimeout: 100, forceExitTimeout: 50 });
      g.register({
        name: 'failing',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          throw new Error('fail');
        },
      });

      await g.shutdown('SIGTERM', false);
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should set up force exit timer in non-manual mode', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const g = new GracefulShutdown({ shutdownTimeout: 100, forceExitTimeout: 50 });
      g.register({
        name: 'handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {},
      });

      const result = await g.shutdown('SIGTERM', false);
      // Force exit timer was set up but cleared before firing since handler completed
      expect(result.success).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });

    it('should trigger force exit when handler does not complete in time', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      const g = new GracefulShutdown({ shutdownTimeout: 10, forceExitTimeout: 10 });
      g.register({
        name: 'slow-handler',
        priority: 10,
        timeout: 1000,
        shutdown: async () => {
          // Handler never resolves within the force exit timeout
          await new Promise(() => {}); // never resolves
        },
      });

      // Start shutdown without awaiting — it will hang on the handler
      const shutdownPromise = g.shutdown('SIGTERM', false);

      // Advance time past the force exit timeout (shutdownTimeout + forceExitTimeout = 20ms)
      await vi.advanceTimersByTimeAsync(50);

      // The force exit timer should have fired process.exit(1)
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
      vi.useRealTimers();

      // Clean up — the shutdown promise will never resolve, so just ignore it
      shutdownPromise.catch(() => {});
    });
  });
});
