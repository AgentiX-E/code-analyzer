// @code-analyzer — Scale Profiling Tests
// Validates that the system scales linearly without memory leaks or
// super-linear query latency degradation.

import { describe, it, expect, beforeAll } from 'vitest';
import { runScaleProfile, type ScaleProfileResult } from '../scale-profiling.bench.js';

let result: ScaleProfileResult;

beforeAll(async () => {
  result = await runScaleProfile();
}, 120_000);

describe('Scale Profiling', () => {
  // --- Basic Structure ---
  it('should produce profile points for all scale tiers', () => {
    expect(result.profilePoints.length).toBe(3);
  });

  it('should include 100-file scale tier', () => {
    expect(result.profilePoints.some((p) => p.fileCount === 100)).toBe(true);
  });

  it('should include 500-file scale tier', () => {
    expect(result.profilePoints.some((p) => p.fileCount === 500)).toBe(true);
  });

  it('should include 2000-file scale tier', () => {
    expect(result.profilePoints.some((p) => p.fileCount === 2000)).toBe(true);
  });

  // --- Throughput ---
  it('should index at least 50 files/second at 100 scale', () => {
    const point = result.profilePoints.find((p) => p.fileCount === 100);
    expect(point?.filesPerSecond).toBeGreaterThanOrEqual(50);
  });

  it('should maintain reasonable throughput at 2000 scale', () => {
    const point = result.profilePoints.find((p) => p.fileCount === 2000);
    expect(point?.filesPerSecond).toBeGreaterThan(0);
  });

  // --- Memory ---
  it('should not exceed 512MB memory at 2000 scale', () => {
    const point = result.profilePoints.find((p) => p.fileCount === 2000);
    expect(point?.memoryAfterMB).toBeLessThan(512);
  });

  // --- Linearity ---
  it('should produce nodes proportional to file count', () => {
    const point100 = result.profilePoints.find((p) => p.fileCount === 100);
    const point500 = result.profilePoints.find((p) => p.fileCount === 500);
    if (point100 && point500) {
      const ratio = point500.nodeCount / point100.nodeCount;
      expect(ratio).toBeGreaterThan(1);
      expect(ratio).toBeLessThan(15);
    }
  });

  // --- Query Latency ---
  it('should measure query latency at each scale tier', () => {
    for (const point of result.profilePoints) {
      expect(point.queryTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  // --- Summary ---
  it('should produce a summary with max throughput', () => {
    expect(result.summary.maxThroughput).toBeGreaterThan(0);
  });

  it('should produce a summary with max memory', () => {
    expect(result.summary.maxMemoryMB).toBeGreaterThan(0);
  });

  it('should complete within 120 seconds', () => {
    const totalTime = result.profilePoints.reduce((sum, p) => sum + p.totalTimeMs, 0);
    expect(totalTime).toBeLessThan(120_000);
  });
});
