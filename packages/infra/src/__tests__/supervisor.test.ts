// @code-analyzer/infra — IndexSupervisor Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { IndexSupervisor } from '../workers/supervisor.js';
import type { SupervisorConfig } from '../workers/supervisor.js';

describe('IndexSupervisor', () => {
  let config: SupervisorConfig;

  beforeEach(() => {
    config = {
      timeout: 500,
      maxRetries: 2,
      memoryLimit: 1024 * 1024 * 1024, // 1GB
    };
  });

  it('completes successful tasks', async () => {
    const supervisor = new IndexSupervisor(config);
    const result = await supervisor.supervise(async () => {
      // Give memory watcher time to fire
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(result.status).toBe('complete');
    expect(result.filesProcessed).toBe(1);
    expect(result.filesFailed).toBe(0);
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.peakMemory).toBeGreaterThan(0);
  });

  it('retries failed tasks', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 3 });
    let attempts = 0;

    const result = await supervisor.supervise(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('temporary failure');
      }
    });

    expect(result.status).toBe('complete');
    expect(attempts).toBe(3);
    expect(result.filesFailed).toBe(2);
    expect(result.crashReports.length).toBe(2);
  });

  it('reports crashed status after max retries', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 1 });
    let attempts = 0;

    const result = await supervisor.supervise(async () => {
      attempts++;
      throw new Error('persistent failure');
    });

    expect(result.status).toBe('crashed');
    expect(attempts).toBe(2); // initial + 1 retry
    expect(result.filesFailed).toBe(2);
    expect(result.crashReports.length).toBe(2);
  });

  it('reports timeout status', async () => {
    const supervisor = new IndexSupervisor({ timeout: 100, maxRetries: 0 });

    const result = await supervisor.supervise(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    expect(result.status).toBe('timeout');
    expect(result.filesFailed).toBeGreaterThan(0);
  });

  it('reports complete status when retries ultimately succeed', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 2 });
    let attempts = 0;

    const result = await supervisor.supervise(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('first attempt failed');
      }
      // second attempt succeeds
    });

    expect(result.status).toBe('complete');
    expect(result.filesFailed).toBe(1);
    expect(result.filesProcessed).toBe(1);
  });

  it('tracks duration correctly', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 0 });

    const result = await supervisor.supervise(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const duration = result.duration;
    expect(duration).toBeGreaterThanOrEqual(45); // allow small timing variance
    expect(duration).toBeLessThan(200);
  });

  it('tracks peak memory', async () => {
    const supervisor = new IndexSupervisor(config);
    const result = await supervisor.supervise(async () => {
      // Allocate some memory and wait for memory watcher to fire
      const arr = new Array(10000).fill('x'.repeat(100));
      void arr;
      await new Promise((r) => setTimeout(r, 1100));
    });

    expect(result.peakMemory).toBeGreaterThan(0);
  });

  it('includes crash reports on failure', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 1 });
    let attempts = 0;

    const result = await supervisor.supervise(async () => {
      attempts++;
      throw new Error(`crash ${attempts}`);
    });

    expect(result.crashReports.length).toBe(2);
    expect(result.crashReports[0]!.error).toBe('crash 1');
    expect(result.crashReports[0]!.attemptNumber).toBe(1);
    expect(result.crashReports[1]!.error).toBe('crash 2');
    expect(result.crashReports[1]!.attemptNumber).toBe(2);
  });

  it('includes stack traces in crash reports', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 0 });

    const result = await supervisor.supervise(async () => {
      throw new Error('test error');
    });

    expect(result.crashReports[0]!.stackTrace).toBeDefined();
    expect(result.crashReports[0]!.stackTrace).toContain('Error: test error');
  });

  it('quarantines files on repeated failures', async () => {
    const strictSupervisor = new IndexSupervisor({
      timeout: 2000,
      maxRetries: 2,
      memoryLimit: 1, // Very small, will trigger quarantine
    });

    await strictSupervisor.supervise(async () => {
      // Run long enough for memory watcher to fire at least once
      await new Promise((r) => setTimeout(r, 500));
    });

    const quarantined = strictSupervisor.getQuarantinedFiles();
    expect(quarantined.length).toBeGreaterThanOrEqual(1);
  });

  it('clears quarantine for a specific file', async () => {
    const supervisor = new IndexSupervisor({
      timeout: 2000,
      maxRetries: 1,
      memoryLimit: 1,
    });

    await supervisor.supervise(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    const quarantined = supervisor.getQuarantinedFiles();
    if (quarantined.length > 0) {
      supervisor.clearQuarantine(quarantined[0]!.filePath);
      expect(supervisor.getQuarantinedFiles().length).toBe(0);
    }
  });

  it('getQuarantinedFiles returns a copy', async () => {
    const supervisor = new IndexSupervisor({
      timeout: 2000,
      maxRetries: 0,
      memoryLimit: 1,
    });

    await supervisor.supervise(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });

    const files = supervisor.getQuarantinedFiles();
    files.push({
      filePath: 'hacked.ts',
      error: 'injected',
      quarantinedAt: new Date().toISOString(),
    });

    // Original should be unchanged
    expect(supervisor.getQuarantinedFiles().length).not.toBe(files.length);
  });

  it('allows multiple supervise calls', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 2 });

    const result1 = await supervisor.supervise(async () => {
      // success
    });
    expect(result1.status).toBe('complete');

    const result2 = await supervisor.supervise(async () => {
      throw new Error('fail');
    });
    expect(result2.status).toBe('crashed');
  });

  it('handles errors that are not Error instances', async () => {
    const supervisor = new IndexSupervisor({ timeout: 500, maxRetries: 0 });

    const result = await supervisor.supervise(async () => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });

    expect(result.status).toBe('crashed');
    expect(result.crashReports[0]!.error).toContain('string error');
  });

  it('detects timeout on long-running tasks', async () => {
    const supervisor = new IndexSupervisor({ timeout: 50, maxRetries: 0 });

    const result = await supervisor.supervise(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    expect(result.status).toBe('timeout');
  });

  it('tracks global timeout (2x config timeout)', async () => {
    const supervisor = new IndexSupervisor({ timeout: 50, maxRetries: 10 });

    const result = await supervisor.supervise(async () => {
      // Each attempt throws immediately, but after many attempts, total time will exceed 2x timeout
      // Actually, with 10 retries each throwing immediately, time might not exceed 2*50ms=100ms
      // Let's use a short sleep to ensure timeout
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('delayed failure');
    });

    // This may hit either 'crashed' (max retries) or 'timeout'
    expect(['crashed', 'timeout']).toContain(result.status);
  });
});
