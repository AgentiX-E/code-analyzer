import { describe, it, expect } from 'vitest';

describe('BenchmarkRunner', () => {
  it('can be imported', async () => {
    const m = await import('../benchmark/benchmark-runner.js');
    expect(typeof m.BenchmarkRunner).toBe('function');
    const runner = new m.BenchmarkRunner();
    expect(runner).toBeDefined();
    expect(typeof runner.run).toBe('function');
    expect(typeof runner.getResults).toBe('function');
  });
});
