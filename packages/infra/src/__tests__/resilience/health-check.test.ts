// @code-analyzer/infra — Health Check Tests

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HealthCheckRegistry,
  createDependencyCheck,
  createThresholdCheck,
} from '../../resilience/health-check.js';

import type { HealthStatus } from '../../resilience/health-check.js';

// ---------------------------------------------------------------------------
// HealthCheckRegistry
// ---------------------------------------------------------------------------

describe('HealthCheckRegistry', () => {
  let registry: HealthCheckRegistry;

  beforeEach(() => {
    registry = new HealthCheckRegistry();
  });

  it('should register a health check', () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    expect(registry.size).toBe(1);
  });

  it('should throw when registering duplicate check', () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    expect(() =>
      registry.register('db', async () => ({ status: 'healthy' })),
    ).toThrow(/already registered/);
  });

  it('should unregister a health check', () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    expect(registry.unregister('db')).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('should return false when unregistering non-existent check', () => {
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('should run all checks and return healthy when all pass', async () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    registry.register('cache', async () => ({ status: 'healthy' }));
    registry.register('api', async () => ({ status: 'healthy' }));

    const report = await registry.runAll();

    expect(report.status).toBe('healthy');
    expect(report.checks).toHaveLength(3);
    expect(report.uptime).toBeGreaterThanOrEqual(0);
    expect(report.timestamp).toBeTruthy();
  });

  it('should return degraded when any check is degraded', async () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    registry.register('cache', async () => ({
      status: 'degraded',
      message: 'Cache hit rate low',
    }));
    registry.register('api', async () => ({ status: 'healthy' }));

    const report = await registry.runAll();
    expect(report.status).toBe('degraded');
  });

  it('should return unhealthy when any check is unhealthy', async () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    registry.register('api', async () => ({
      status: 'unhealthy',
      message: 'Connection refused',
    }));

    const report = await registry.runAll();
    expect(report.status).toBe('unhealthy');
  });

  it('should return healthy when no checks registered', async () => {
    const report = await registry.runAll();
    expect(report.status).toBe('healthy');
    expect(report.checks).toHaveLength(0);
  });

  it('should capture response time for each check', async () => {
    registry.register('fast-check', async () => ({ status: 'healthy' }));

    const report = await registry.runAll();
    const check = report.checks[0]!;
    expect(check.responseTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle check throwing an error as unhealthy', async () => {
    registry.register('broken', async () => {
      throw new Error('Boom');
    });

    const report = await registry.runAll();
    expect(report.status).toBe('unhealthy');
    expect(report.checks[0]!.status).toBe('unhealthy');
    expect(report.checks[0]!.message).toContain('Boom');
  });

  it('should run a single check by name', async () => {
    registry.register('db', async () => ({ status: 'healthy', message: 'OK' }));

    const result = await registry.runOne('db');
    expect(result.name).toBe('db');
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('OK');
  });

  it('should throw when running non-existent check', async () => {
    await expect(registry.runOne('nonexistent')).rejects.toThrow(/not found/);
  });

  it('should track average response times', async () => {
    registry.register('db', async () => ({ status: 'healthy' }));

    await registry.runAll();
    await registry.runAll();
    await registry.runAll();

    const avg = registry.getAverageResponseTime('db');
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThanOrEqual(0);
  });

  it('should return null average for non-existent check', () => {
    expect(registry.getAverageResponseTime('nonexistent')).toBeNull();
  });

  it('should reset response time history', async () => {
    registry.register('db', async () => ({ status: 'healthy' }));
    await registry.runAll();

    registry.resetHistory();
    expect(registry.getAverageResponseTime('db')).toBeNull();
  });

  it('should include message from check result', async () => {
    registry.register('mem', async () => ({
      status: 'healthy',
      message: 'Heap: 45MB / 512MB',
    }));

    const report = await registry.runAll();
    expect(report.checks[0]!.message).toBe('Heap: 45MB / 512MB');
  });
});

// ---------------------------------------------------------------------------
// createDependencyCheck
// ---------------------------------------------------------------------------

describe('createDependencyCheck', () => {
  it('should return healthy when dependency is available', async () => {
    const check = createDependencyCheck('store', () => ({ connected: true }));
    const result = await check();
    expect(result.status).toBe('healthy');
  });

  it('should return unhealthy when dependency is null', async () => {
    const check = createDependencyCheck('store', () => null);
    const result = await check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('not initialized');
  });

  it('should return unhealthy when dependency is undefined', async () => {
    const check = createDependencyCheck('store', () => undefined);
    const result = await check();
    expect(result.status).toBe('unhealthy');
  });

  it('should handle getter throwing', async () => {
    const check = createDependencyCheck('store', () => {
      throw new Error('Getter failed');
    });
    const result = await check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('Getter failed');
  });
});

// ---------------------------------------------------------------------------
// createThresholdCheck
// ---------------------------------------------------------------------------

describe('createThresholdCheck', () => {
  it('should return healthy when below warning threshold', async () => {
    const check = createThresholdCheck('heap', () => 200, 400, 500, 'MB');
    const result = await check();
    expect(result.status).toBe('healthy');
  });

  it('should return degraded when above warning threshold', async () => {
    const check = createThresholdCheck('heap', () => 450, 400, 500, 'MB');
    const result = await check();
    expect(result.status).toBe('degraded');
    expect(result.message).toContain('warning');
  });

  it('should return unhealthy when above critical threshold', async () => {
    const check = createThresholdCheck('heap', () => 550, 400, 500, 'MB');
    const result = await check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('critical');
  });

  it('should handle getter throwing', async () => {
    const check = createThresholdCheck('heap', () => {
      throw new Error('Cannot read memory');
    }, 400, 500, 'MB');
    const result = await check();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('Cannot read memory');
  });

  it('should work without unit', async () => {
    const check = createThresholdCheck('cpu', () => 60, 80, 95);
    const result = await check();
    expect(result.status).toBe('healthy');
  });
});
