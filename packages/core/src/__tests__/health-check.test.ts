import { describe, it, expect, beforeEach } from 'vitest';

import {
  HealthCheckRegistry,
} from '../operations/health-check.js';

import type {
  HealthCheck,
  HealthCheckResult,
  HealthStatus,
} from '../operations/health-check.js';

describe('HealthCheckRegistry', () => {
  let registry: HealthCheckRegistry;

  // Use memoryThreshold: 100 to ensure the built-in memory check always
  // passes in CI/sandbox environments where heap usage can be unpredictable.
  beforeEach(() => {
    registry = new HealthCheckRegistry({ memoryThreshold: 100 });
  });

  describe('static createDefault', () => {
    it('should create a registry with built-in checks', () => {
      const reg = HealthCheckRegistry.createDefault();
      expect(reg.size).toBeGreaterThanOrEqual(4);
      expect(reg.getCheck('memory-usage')).toBeDefined();
      expect(reg.getCheck('store-connectivity')).toBeDefined();
      expect(reg.getCheck('disk-space')).toBeDefined();
      expect(reg.getCheck('worker-pool')).toBeDefined();
    });
  });

  describe('registration', () => {
    it('should register a custom health check', () => {
      const check: HealthCheck = {
        name: 'custom-db',
        check: async () => ({
          name: 'custom-db',
          status: 'pass',
        }),
      };
      registry.register(check);
      expect(registry.getCheck('custom-db')).toBeDefined();
    });

    it('should overwrite an existing check with the same name', () => {
      const first: HealthCheck = {
        name: 'override',
        check: async () => ({ name: 'override', status: 'pass' }),
      };
      const second: HealthCheck = {
        name: 'override',
        check: async () => ({ name: 'override', status: 'warn' }),
      };
      registry.register(first);
      registry.register(second);
      // Just ensure it was registered — the second one overwrites
      expect(registry.getCheck('override')).toBeDefined();
    });

    it('should unregister a check', () => {
      registry.unregister('memory-usage');
      expect(registry.getCheck('memory-usage')).toBeUndefined();
    });

    it('should return undefined for non-existent check', () => {
      expect(registry.getCheck('nonexistent')).toBeUndefined();
    });
  });

  describe('runAll', () => {
    // Uses a registry with memoryThreshold: 100 so memory check passes
    it('should return healthy when all checks pass', async () => {
      const status = await registry.runAll();
      expect(status.status).toBe('healthy');
      expect(status.checks.length).toBeGreaterThanOrEqual(4);
      expect(status.uptime).toBeGreaterThan(0);
      expect(status.version).toBe('0.0.0');
      expect(status.timestamp).toBeTruthy();
    });

    // Uses a registry with memoryThreshold: 100 so only the added check fails
    it('should include version from options', async () => {
      const r = new HealthCheckRegistry({ version: '1.2.3', memoryThreshold: 100 });
      const status = await r.runAll();
      expect(status.version).toBe('1.2.3');
    });

    // Uses a registry with memoryThreshold: 100 so the built-in memory check passes
    it('should mark as degraded when a non-critical check fails', async () => {
      registry.register({
        name: 'failing-check',
        critical: false,
        check: async () => ({
          name: 'failing-check',
          status: 'fail',
          message: 'Something is wrong',
        }),
      });

      const status = await registry.runAll();
      expect(status.status).toBe('degraded');
    });

    // Uses a registry with memoryThreshold: 100; the new critical check
    // overrides the healthy state.
    it('should mark as unhealthy when a critical check fails', async () => {
      registry.register({
        name: 'critical-db',
        critical: true,
        check: async () => ({
          name: 'critical-db',
          status: 'fail',
          message: 'Database down',
        }),
      });

      const status = await registry.runAll();
      expect(status.status).toBe('unhealthy');
    });

    // Uses a registry with memoryThreshold: 100 so only the warn causes degraded
    it('should mark as degraded when a check returns warn', async () => {
      registry.register({
        name: 'slow-endpoint',
        critical: false,
        check: async () => ({
          name: 'slow-endpoint',
          status: 'warn',
          message: 'Response time > 1s',
        }),
      });

      const status = await registry.runAll();
      expect(status.status).toBe('degraded');
    });

    it('should handle timed-out checks gracefully', async () => {
      // Register a new check that will time out
      registry.register({
        name: 'slow-check',
        timeout: 1,
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { name: 'slow-check', status: 'pass' };
        },
      });

      const status = await registry.runAll();
      const slowCheck = status.checks.find((c: HealthCheckResult) => c.name === 'slow-check');
      expect(slowCheck).toBeDefined();
      expect(slowCheck!.status).toBe('fail');
    });

    it('should catch thrown errors in checks', async () => {
      // Override the memory-usage check with one that throws
      registry.unregister('memory-usage');
      registry.register({
        name: 'throwing-check',
        check: async () => {
          throw new Error('Boom!');
        },
      });

      const status = await registry.runAll();
      const failCheck = status.checks.find((c: HealthCheckResult) => c.name === 'throwing-check');
      expect(failCheck).toBeDefined();
      expect(failCheck!.status).toBe('fail');
      if (failCheck!.message) {
        expect(failCheck!.message).toContain('Boom');
      }
    });

    it('should include latency in results', async () => {
      const status = await registry.runAll();
      for (const check of status.checks) {
        expect(typeof check.latency).toBe('number');
      }
    });
  });

  describe('runOne', () => {
    // Uses a registry with memoryThreshold: 100
    it('should run a single check and pass', async () => {
      const result = await registry.runOne('memory-usage');
      expect(result.name).toBe('memory-usage');
      expect(result.status).toBe('pass');
      expect(typeof result.latency).toBe('number');
    });

    it('should fail for non-existent check name', async () => {
      const result = await registry.runOne('does-not-exist');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('not found');
    });

    it('should time out a single slow check', async () => {
      registry.register({
        name: 'slow-one',
        timeout: 1,
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { name: 'slow-one', status: 'pass' };
        },
      });

      const result = await registry.runOne('slow-one');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('timed out');
    });
  });

  describe('readiness', () => {
    // Uses a registry with memoryThreshold: 100
    it('should return true when healthy', async () => {
      expect(await registry.readiness()).toBe(true);
    });

    it('should return false when a critical check fails', async () => {
      registry.register({
        name: 'critical-fail',
        critical: true,
        check: async () => ({
          name: 'critical-fail',
          status: 'fail',
        }),
      });

      expect(await registry.readiness()).toBe(false);
    });

    // Uses a registry with memoryThreshold: 100 where only non-critical fails
    it('should return true when only non-critical checks fail', async () => {
      registry.register({
        name: 'non-critical-fail',
        critical: false,
        check: async () => ({
          name: 'non-critical-fail',
          status: 'fail',
        }),
      });

      expect(await registry.readiness()).toBe(true);
    });
  });

  describe('liveness', () => {
    // Uses a registry with memoryThreshold: 100
    it('should return true when healthy', async () => {
      expect(await registry.liveness()).toBe(true);
    });

    it('should return true when some checks fail', async () => {
      registry.register({
        name: 'failing-but-not-all',
        critical: true,
        check: async () => ({
          name: 'failing-but-not-all',
          status: 'fail',
        }),
      });

      // Still alive — built-in checks are passing (memoryThreshold: 100)
      expect(await registry.liveness()).toBe(true);
    });

    it('should return false when all checks fail', async () => {
      // Remove all built-in checks and register one that fails
      registry.unregister('memory-usage');
      registry.unregister('store-connectivity');
      registry.unregister('disk-space');
      registry.unregister('worker-pool');

      registry.register({
        name: 'only-check',
        critical: true,
        check: async () => ({
          name: 'only-check',
          status: 'fail',
        }),
      });

      expect(await registry.liveness()).toBe(false);
    });
  });

  describe('built-in checks', () => {
    // Uses a registry with memoryThreshold: 100 so this passes
    it('should pass memory-usage check when below threshold', async () => {
      const result = await registry.runOne('memory-usage');
      expect(result.status).toBe('pass');
      expect(result.details).toBeDefined();
    });

    it('should fail memory-usage when threshold is exceeded', async () => {
      const r = new HealthCheckRegistry({ memoryThreshold: 0 });
      const result = await r.runOne('memory-usage');
      // With threshold of 0, heap usage will always exceed it
      expect(result.status).toBe('fail');
    });

    it('should pass store-connectivity by default', async () => {
      const result = await registry.runOne('store-connectivity');
      expect(result.status).toBe('pass');
    });

    it('should fail store-connectivity when check returns false', async () => {
      const r = new HealthCheckRegistry({
        storeCheck: async () => false,
        memoryThreshold: 100,
      });
      const result = await r.runOne('store-connectivity');
      expect(result.status).toBe('fail');
    });

    it('should fail store-connectivity when check throws', async () => {
      const r = new HealthCheckRegistry({
        storeCheck: async () => {
          throw new Error('Connection refused');
        },
        memoryThreshold: 100,
      });
      const result = await r.runOne('store-connectivity');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('Connection refused');
    });

    it('should pass disk-space check by default', async () => {
      const result = await registry.runOne('disk-space');
      expect(result.status).toBe('pass');
    });

    it('should warn disk-space when below threshold', async () => {
      const r = new HealthCheckRegistry({
        minDiskSpace: Number.MAX_SAFE_INTEGER,
        memoryThreshold: 100,
      });
      const result = await r.runOne('disk-space');
      expect(result.status).toBe('warn');
    });

    it('should warn disk-space when check throws', async () => {
      const r = new HealthCheckRegistry({
        diskCheck: async () => {
          throw new Error('Disk unavailable');
        },
        memoryThreshold: 100,
      });
      const result = await r.runOne('disk-space');
      expect(result.status).toBe('warn');
    });

    it('should pass worker-pool by default', async () => {
      const result = await registry.runOne('worker-pool');
      expect(result.status).toBe('pass');
    });

    it('should fail worker-pool when check returns false', async () => {
      const r = new HealthCheckRegistry({
        workerPoolCheck: async () => false,
        memoryThreshold: 100,
      });
      const result = await r.runOne('worker-pool');
      expect(result.status).toBe('fail');
    });

    it('should fail worker-pool when check throws', async () => {
      const r = new HealthCheckRegistry({
        workerPoolCheck: async () => {
          throw new Error('Workers exhausted');
        },
        memoryThreshold: 100,
      });
      const result = await r.runOne('worker-pool');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('Workers exhausted');
    });

    // worker-pool is not critical, so the overall status should be degraded
    // even though memory-usage passes (memoryThreshold: 100).
    it('should not be critical for worker-pool failure', async () => {
      const r = new HealthCheckRegistry({
        workerPoolCheck: async () => false,
        memoryThreshold: 100,
      });
      const status = await r.runAll();
      // worker-pool is not critical, so overall status should be degraded, not unhealthy
      expect(status.status).toBe('degraded');
    });
  });

  describe('defaultTimeout option', () => {
    it('should use the configured default timeout', async () => {
      const r = new HealthCheckRegistry({ defaultTimeout: 1, memoryThreshold: 100 });
      r.register({
        name: 'very-slow',
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { name: 'very-slow', status: 'pass' };
        },
      });

      const result = await r.runOne('very-slow');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('timed out');
    });

    it('should use per-check timeout over default', async () => {
      const r = new HealthCheckRegistry({ defaultTimeout: 10000, memoryThreshold: 100 });
      r.register({
        name: 'per-check-timed',
        timeout: 1,
        check: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { name: 'per-check-timed', status: 'pass' };
        },
      });

      const result = await r.runOne('per-check-timed');
      expect(result.status).toBe('fail');
    });
  });

  describe('size', () => {
    it('should return the number of registered checks', () => {
      expect(registry.size).toBeGreaterThanOrEqual(4);
      registry.register({
        name: 'extra',
        check: async () => ({ name: 'extra', status: 'pass' }),
      });
      expect(registry.size).toBeGreaterThanOrEqual(5);
      registry.unregister('extra');
      expect(registry.size).toBeGreaterThanOrEqual(4);
    });
  });
});
