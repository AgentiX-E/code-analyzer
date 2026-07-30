// @code-analyzer — CA-Bench Tests
// Comprehensive tests for the benchmark runner, reporter, and all suites.

import { describe, it, expect, beforeAll } from 'vitest';
import { CaBenchRunner, type BenchmarkSuite, type BenchmarkResult } from '../runner.js';
import { generateJsonReport, generateMarkdownReport, generateHtmlReport, measurement, makeResult } from '../reporter.js';
import { ParseAccuracySuite } from '../suites/parse-accuracy.bench.js';
import { SearchQualitySuite } from '../suites/search-quality.bench.js';
import { ReviewQualitySuite } from '../suites/review-quality.bench.js';
import { ThroughputSuite } from '../suites/throughput.bench.js';

// ---------------------------------------------------------------------------
// Mock Suite for Testing
// ---------------------------------------------------------------------------

class MockPassingSuite implements BenchmarkSuite {
  readonly name = 'mock-passing';
  readonly description = 'A mock suite that always passes';

  async run(): Promise<BenchmarkResult> {
    return makeResult(this.name, this.description, [
      measurement('metric-a', 95, 'percent', { target: 90, min: 80 }),
      measurement('metric-b', 42, 'ms', { target: 50, max: 100 }),
    ]);
  }
}

class MockFailingSuite implements BenchmarkSuite {
  readonly name = 'mock-failing';
  readonly description = 'A mock suite that always fails';

  async run(): Promise<BenchmarkResult> {
    return makeResult(this.name, this.description, [
      measurement('below-min', 5, 'count', { target: 10, min: 8 }),
      measurement('above-max', 200, 'ms', { target: 100, max: 150 }),
    ]);
  }
}

class MockThrowingSuite implements BenchmarkSuite {
  readonly name = 'mock-throwing';
  readonly description = 'A mock suite that throws an error';

  async run(): Promise<BenchmarkResult> {
    throw new Error('Simulated suite failure');
  }
}

// ---------------------------------------------------------------------------
// Runner Tests
// ---------------------------------------------------------------------------

describe('CaBenchRunner', () => {
  let runner: CaBenchRunner;

  beforeAll(() => {
    runner = new CaBenchRunner();
    runner.register(new MockPassingSuite());
    runner.register(new MockFailingSuite());
    runner.register(new MockThrowingSuite());
  });

  it('should register suites and list their names', () => {
    const names = runner.suiteNames;
    expect(names).toContain('mock-passing');
    expect(names).toContain('mock-failing');
    expect(names).toContain('mock-throwing');
    expect(names).toHaveLength(3);
  });

  it('should throw when registering a duplicate suite', () => {
    expect(() => runner.register(new MockPassingSuite())).toThrow(
      /already registered/,
    );
  });

  it('should run a single passing suite', async () => {
    const result = await runner.runSuite('mock-passing');
    expect(result.suiteName).toBe('mock-passing');
    expect(result.passed).toBe(true);
    expect(result.measurements).toHaveLength(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeTruthy();
  });

  it('should run a single failing suite', async () => {
    const result = await runner.runSuite('mock-failing');
    expect(result.suiteName).toBe('mock-failing');
    expect(result.passed).toBe(false);
    expect(result.measurements).toHaveLength(2);
  });

  it('should throw for unknown suite name', async () => {
    await expect(runner.runSuite('nonexistent')).rejects.toThrow(/not found/);
  });

  it('should handle throwing suites gracefully in runAll', async () => {
    const report = await runner.runAll();
    const throwingResult = report.suites.find((s) => s.suiteName === 'mock-throwing');
    expect(throwingResult).toBeDefined();
    expect(throwingResult!.passed).toBe(false);
    expect(throwingResult!.details[0]).toContain('Simulated suite failure');
  });

  it('should generate correct summary in report', async () => {
    const report = await runner.runAll();
    expect(report.summary.totalSuites).toBe(3);
    expect(report.summary.passedSuites).toBe(1);
    expect(report.summary.failedSuites).toBe(2);
    expect(report.summary.totalMeasurements).toBe(4);
    expect(report.summary.passedMeasurements).toBe(2);
    expect(report.summary.failedMeasurements).toBe(2);
    expect(report.title).toBe('CA-Bench — Code Analyzer Benchmark Report');
    expect(report.generatedAt).toBeTruthy();
  });

  it('should generate valid JSON report', async () => {
    const report = await runner.runAll();
    const json = runner.generateJsonReport(report);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe('ca-bench-v1');
    expect(parsed.summary.totalSuites).toBe(3);
    expect(Array.isArray(parsed.suites)).toBe(true);
  });

  it('should generate valid Markdown report', async () => {
    const report = await runner.runAll();
    const md = runner.generateMarkdownReport(report);
    expect(md).toContain('# CA-Bench');
    expect(md).toContain('mock-passing');
    expect(md).toContain('mock-failing');
    expect(md).toContain('✅');
    expect(md).toContain('❌');
  });

  it('should generate valid HTML report', async () => {
    const report = await runner.runAll();
    const html = runner.generateHtmlReport(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('CA-Bench');
    expect(html).toContain('mock-passing');
    expect(html).toContain('&#9989;');
    expect(html).toContain('</html>');
  });
});

// ---------------------------------------------------------------------------
// Reporter Tests
// ---------------------------------------------------------------------------

describe('Reporter', () => {
  const sampleReport = {
    title: 'Test Report',
    generatedAt: '2026-01-01T00:00:00Z',
    summary: {
      totalSuites: 2,
      passedSuites: 1,
      failedSuites: 1,
      totalMeasurements: 4,
      passedMeasurements: 2,
      failedMeasurements: 2,
    },
    suites: [
      makeResult('suite-a', 'First suite', [
        measurement('metric-1', 95, 'percent', { target: 90, min: 80 }),
        measurement('metric-2', 42, 'ms', { target: 50, max: 100 }),
      ]),
      makeResult('suite-b', 'Second suite', [
        measurement('metric-3', 5, 'count', { target: 10, min: 8 }),
        measurement('metric-4', 200, 'ms', { target: 100, max: 150 }),
      ]),
    ],
  };

  it('should generate valid JSON report', () => {
    const json = generateJsonReport(sampleReport);
    const parsed = JSON.parse(json);
    expect(parsed.schema).toBe('ca-bench-v1');
    expect(parsed.summary.totalSuites).toBe(2);
  });

  it('should generate valid Markdown report', () => {
    const md = generateMarkdownReport(sampleReport);
    expect(md).toContain('# CA-Bench Report');
    expect(md).toContain('suite-a');
    expect(md).toContain('suite-b');
    expect(md).toContain('50.0%');
  });

  it('should generate valid HTML report', () => {
    const html = generateHtmlReport(sampleReport);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('suite-a');
    expect(html).toContain('suite-b');
    expect(html).toContain('50.0%');
    expect(html).toContain('</html>');
  });

  it('should handle empty report', () => {
    const emptyReport = {
      title: 'Empty',
      generatedAt: '2026-01-01T00:00:00Z',
      summary: {
        totalSuites: 0,
        passedSuites: 0,
        failedSuites: 0,
        totalMeasurements: 0,
        passedMeasurements: 0,
        failedMeasurements: 0,
      },
      suites: [],
    };

    const json = generateJsonReport(emptyReport);
    expect(() => JSON.parse(json)).not.toThrow();

    const md = generateMarkdownReport(emptyReport);
    expect(md).toContain('0.0%');

    const html = generateHtmlReport(emptyReport);
    expect(html).toContain('0.0%');
  });

  it('measurement helper should validate thresholds correctly', () => {
    // Within range
    const m1 = measurement('ok', 50, 'ms', { target: 50, min: 30, max: 100 });
    expect(m1.passed).toBe(true);

    // Below min
    const m2 = measurement('low', 10, 'ms', { target: 50, min: 30 });
    expect(m2.passed).toBe(false);

    // Above max
    const m3 = measurement('high', 200, 'ms', { target: 50, max: 100 });
    expect(m3.passed).toBe(false);

    // No bounds — always passes
    const m4 = measurement('unbounded', 999, 'count', { target: 100 });
    expect(m4.passed).toBe(true);
  });

  it('makeResult should set passed based on all measurements', () => {
    const passing = makeResult('test', 'desc', [
      measurement('a', 10, 'count', { target: 10, min: 5 }),
      measurement('b', 50, 'ms', { target: 50, max: 100 }),
    ]);
    expect(passing.passed).toBe(true);

    const failing = makeResult('test', 'desc', [
      measurement('a', 10, 'count', { target: 10, min: 5 }),
      measurement('b', 200, 'ms', { target: 50, max: 100 }),
    ]);
    expect(failing.passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parse Accuracy Suite Tests
// ---------------------------------------------------------------------------

describe('ParseAccuracySuite', () => {
  it('should run and return results', async () => {
    const suite = new ParseAccuracySuite();
    const result = await suite.run();
    expect(result.suiteName).toBe('parse-accuracy');
    expect(result.measurements.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should have parse accuracy measurement', async () => {
    const suite = new ParseAccuracySuite();
    const result = await suite.run();
    const accuracy = result.measurements.find((m) => m.name === 'Parse Accuracy');
    expect(accuracy).toBeDefined();
    expect(accuracy!.value).toBeGreaterThanOrEqual(0);
    expect(accuracy!.value).toBeLessThanOrEqual(1);
  });

  it('should test at least 9 languages', async () => {
    const suite = new ParseAccuracySuite();
    const result = await suite.run();
    const langCount = result.measurements.find((m) => m.name === 'Total Languages Tested');
    expect(langCount).toBeDefined();
    expect(langCount!.value).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// Search Quality Suite Tests
// ---------------------------------------------------------------------------

describe('SearchQualitySuite', () => {
  let result: BenchmarkResult;

  beforeAll(async () => {
    const suite = new SearchQualitySuite();
    result = await suite.run();
  });

  it('should run and return results', () => {
    expect(result.suiteName).toBe('search-quality');
    expect(result.measurements.length).toBeGreaterThan(0);
  });

  it('should have exact name match measurement', () => {
    const m = result.measurements.find((x) => x.name === 'Exact Name Match (P@1)');
    expect(m).toBeDefined();
    expect(m!.value).toBe(1.0);
  });

  it('should have latency measurement under threshold', () => {
    const m = result.measurements.find((x) => x.name === 'Search Latency');
    expect(m).toBeDefined();
    expect(m!.value).toBeLessThan(200);
  });

  it('should handle empty query gracefully', () => {
    const m = result.measurements.find((x) => x.name === 'Empty Query Results');
    expect(m).toBeDefined();
    expect(m!.value).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Review Quality Suite Tests
// ---------------------------------------------------------------------------

describe('ReviewQualitySuite', () => {
  it('should run and return results', async () => {
    const suite = new ReviewQualitySuite();
    const result = await suite.run();
    expect(result.suiteName).toBe('review-quality');
    expect(result.measurements.length).toBeGreaterThan(0);
  });

  it('should have detection rate measurement', async () => {
    const suite = new ReviewQualitySuite();
    const result = await suite.run();
    const dr = result.measurements.find((m) => m.name === 'Vulnerability Detection Rate');
    expect(dr).toBeDefined();
    expect(dr!.value).toBeGreaterThanOrEqual(0);
    expect(dr!.value).toBeLessThanOrEqual(1);
  });

  it('should evaluate all 4 test cases', async () => {
    const suite = new ReviewQualitySuite();
    const result = await suite.run();
    const cases = result.measurements.find((m) => m.name === 'Test Cases Evaluated');
    expect(cases).toBeDefined();
    expect(cases!.value).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Throughput Suite Tests
// ---------------------------------------------------------------------------

describe('ThroughputSuite', () => {
  let result: BenchmarkResult;

  beforeAll(async () => {
    const suite = new ThroughputSuite();
    result = await suite.run();
  });

  it('should run and return results', () => {
    expect(result.suiteName).toBe('throughput');
    expect(result.measurements.length).toBeGreaterThan(0);
  });

  it('should insert 1000 nodes correctly', () => {
    const m = result.measurements.find((x) => x.name === 'Nodes Inserted');
    expect(m).toBeDefined();
    expect(m!.value).toBe(1000);
  });

  it('should verify node count accuracy', () => {
    const m = result.measurements.find((x) => x.name === 'Node Count Accuracy');
    expect(m).toBeDefined();
    expect(m!.value).toBe(1);
  });

  it('should have reasonable insert throughput', () => {
    const m = result.measurements.find((x) => x.name === 'Insert Throughput');
    expect(m).toBeDefined();
    expect(m!.value).toBeGreaterThan(1000);
  });

  it('should have reasonable query latency', () => {
    const m = result.measurements.find((x) => x.name === 'Query Latency (1K nodes)');
    expect(m).toBeDefined();
    expect(m!.value).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// End-to-End Integration
// ---------------------------------------------------------------------------

describe('CA-Bench Integration', () => {
  it('should run all 4 real suites and produce a valid report', async () => {
    const runner = new CaBenchRunner();
    runner.register(new ParseAccuracySuite());
    runner.register(new SearchQualitySuite());
    runner.register(new ReviewQualitySuite());
    runner.register(new ThroughputSuite());

    const report = await runner.runAll();

    expect(report.summary.totalSuites).toBe(4);
    expect(report.suites).toHaveLength(4);
    expect(report.title).toContain('CA-Bench');
    expect(report.generatedAt).toBeTruthy();

    // All suites should have results
    for (const suite of report.suites) {
      expect(suite.measurements.length).toBeGreaterThan(0);
      expect(suite.durationMs).toBeGreaterThanOrEqual(0);
      expect(suite.timestamp).toBeTruthy();
    }

    // Generate all report formats
    const json = runner.generateJsonReport(report);
    expect(() => JSON.parse(json)).not.toThrow();

    const md = runner.generateMarkdownReport(report);
    expect(md.length).toBeGreaterThan(100);

    const html = runner.generateHtmlReport(report);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('should run parse-accuracy suite individually via runner', async () => {
    const runner = new CaBenchRunner();
    runner.register(new ParseAccuracySuite());

    const result = await runner.runSuite('parse-accuracy');
    expect(result.suiteName).toBe('parse-accuracy');
    expect(result.passed).toBeDefined();
  });
});
