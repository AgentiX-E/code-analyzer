// @code-analyzer/infra — Crash Supervisor Tests
import { describe, it, expect } from 'vitest';
import { CrashSupervisor } from '../crash-supervisor.js';

describe('CrashSupervisor', () => {
  it('should return task result on success', async () => {
    const supervisor = new CrashSupervisor();
    const result = await supervisor.executeWithSupervision(async () => 'success', '/src/file.ts');
    expect(result).toBe('success');
  });

  it('should throw on task failure', async () => {
    const supervisor = new CrashSupervisor();
    await expect(
      supervisor.executeWithSupervision(async () => {
        throw new Error('task failed');
      }, '/src/file.ts'),
    ).rejects.toThrow('task failed');
  });

  it('should quarantine file after 3 consecutive failures (default threshold=3)', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 3 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(supervisor.executeWithSupervision(failingTask, '/src/bad.ts')).rejects.toThrow();
    }

    expect(supervisor.isQuarantined('/src/bad.ts')).toBe(true);
  });

  it('should not quarantine after fewer than threshold failures', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 3 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    await expect(supervisor.executeWithSupervision(failingTask, '/src/bad.ts')).rejects.toThrow();

    expect(supervisor.isQuarantined('/src/bad.ts')).toBe(false);
  });

  it('should skip quarantined files with clear error message', async () => {
    const supervisor = new CrashSupervisor();
    supervisor.quarantineFile('/src/bad.ts');

    await expect(
      supervisor.executeWithSupervision(async () => 'should not reach', '/src/bad.ts'),
    ).rejects.toThrow('SKIP_QUARANTINED');
  });

  it('should clear quarantine for a specific file', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 1 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    await expect(
      supervisor.executeWithSupervision(failingTask, '/src/fixable.ts'),
    ).rejects.toThrow();
    expect(supervisor.isQuarantined('/src/fixable.ts')).toBe(true);

    supervisor.clearQuarantine('/src/fixable.ts');
    expect(supervisor.isQuarantined('/src/fixable.ts')).toBe(false);
  });

  it('should clear all quarantines', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 1 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    await expect(supervisor.executeWithSupervision(failingTask, '/src/a.ts')).rejects.toThrow();
    await expect(supervisor.executeWithSupervision(failingTask, '/src/b.ts')).rejects.toThrow();

    supervisor.clearAllQuarantines();
    expect(supervisor.isQuarantined('/src/a.ts')).toBe(false);
    expect(supervisor.isQuarantined('/src/b.ts')).toBe(false);
  });

  it('should return correct crash stats', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 2 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    await expect(supervisor.executeWithSupervision(failingTask, '/src/a.ts')).rejects.toThrow();
    await expect(supervisor.executeWithSupervision(failingTask, '/src/a.ts')).rejects.toThrow();

    const stats = supervisor.getCrashStats();
    expect(stats.totalCrashes).toBe(2);
    expect(stats.quarantinedFiles).toContain('/src/a.ts');
  });

  it('should reset failure count after successful execution', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 5 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    // Fail twice
    await expect(
      supervisor.executeWithSupervision(failingTask, '/src/recovery.ts'),
    ).rejects.toThrow();
    await expect(
      supervisor.executeWithSupervision(failingTask, '/src/recovery.ts'),
    ).rejects.toThrow();

    // Succeed
    await supervisor.executeWithSupervision(async () => 'ok', '/src/recovery.ts');

    // Should NOT be quarantined (counter reset)
    expect(supervisor.isQuarantined('/src/recovery.ts')).toBe(false);

    // Fail again — count should start from 0, not 2
    await expect(
      supervisor.executeWithSupervision(failingTask, '/src/recovery.ts'),
    ).rejects.toThrow();
    expect(supervisor.isQuarantined('/src/recovery.ts')).toBe(false);
  });

  it('should reset all state', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 1 });
    const failingTask = async () => {
      throw new Error('fail');
    };

    await expect(supervisor.executeWithSupervision(failingTask, '/src/a.ts')).rejects.toThrow();

    supervisor.reset();
    const stats = supervisor.getCrashStats();
    expect(stats.totalCrashes).toBe(0);
    expect(stats.quarantinedFiles).toHaveLength(0);
  });

  it('should trim recent failures when exceeding maxRecentFailures (line 90)', async () => {
    const supervisor = new CrashSupervisor({
      quarantineThreshold: 100, // Never quarantine in this test
      maxRecentFailures: 3,
    });
    const failingTask = async () => {
      throw new Error('fail');
    };

    // Generate 5 failures, only last 3 should be kept
    for (let i = 0; i < 5; i++) {
      await expect(
        supervisor.executeWithSupervision(failingTask, `/src/file${i}.ts`),
      ).rejects.toThrow();
    }

    const stats = supervisor.getCrashStats();
    expect(stats.totalCrashes).toBe(5);
    // Only maxRecentFailures (3) most recent failures should be retained
    expect(stats.recentFailures).toHaveLength(3);
    expect(stats.recentFailures[0]!.filePath).toBe('/src/file2.ts');
    expect(stats.recentFailures[1]!.filePath).toBe('/src/file3.ts');
    expect(stats.recentFailures[2]!.filePath).toBe('/src/file4.ts');
  });

  it('should use explicit timeout parameter instead of default', async () => {
    const supervisor = new CrashSupervisor({ defaultTimeout: 5000 });
    // Pass a custom short timeout explicitly
    await expect(
      supervisor.executeWithSupervision(
        async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'late';
        },
        '/src/slow.ts',
        50, // explicit timeout overrides default
      ),
    ).rejects.toThrow('TIMEOUT');
  });

  it('should use default timeout when no timeout parameter provided', async () => {
    const supervisor = new CrashSupervisor({ defaultTimeout: 50 });
    await expect(
      supervisor.executeWithSupervision(
        async () => {
          await new Promise((r) => setTimeout(r, 200));
          return 'late';
        },
        '/src/slow.ts',
        // No explicit timeout — uses defaultTimeout=50
      ),
    ).rejects.toThrow('TIMEOUT');
  });

  it('should not quarantine file after single failure with default threshold', async () => {
    const supervisor = new CrashSupervisor(); // default threshold=3
    await expect(
      supervisor.executeWithSupervision(async () => {
        throw new Error('single fail');
      }, '/src/once.ts'),
    ).rejects.toThrow();
    expect(supervisor.isQuarantined('/src/once.ts')).toBe(false);
  });

  it('should handle non-Error throwables in crash recording', async () => {
    const supervisor = new CrashSupervisor({ quarantineThreshold: 5 });
    await expect(
      supervisor.executeWithSupervision(async () => {
        throw 'raw string crash';
      }, '/src/raw.ts'),
    ).rejects.toThrow('raw string crash');

    const stats = supervisor.getCrashStats();
    expect(stats.totalCrashes).toBe(1);
    expect(stats.recentFailures[0]!.error).toBe('raw string crash');
  });
});
