// The declaration each dataset carries, proved true against the data.
//
// `scripts/benchmark-dataset-gate.js` is JavaScript and reads `totalGroundTruthIssues` out of the source text, so
// those constants are a claim rather than a computation. This file recomputes them from the arrays and fails when
// they disagree - which is the guarantee that made the gate's one-line comparison legitimate.
//
// **Why this matters more than it looks.** `benchmarks/citations.json` recorded the internal suite as 49: fifteen
// plus thirty-four. Fifteen is the number of CASES in `benchmark-data.ts`, and each carries two ground-truth entries,
// so a case count and an issue count were added together. The gate agreed because it counted `id:` strings, and the
// cases are the only `id:` strings in that file. Two wrong numbers agreeing is the failure this file prevents.

import { describe, expect, it } from 'vitest';

import { BENCHMARK_DATA_STATS, ALL_BENCHMARK_CASES } from '../benchmark-data.js';
import { ALL_BENCHMARK_FIXTURES, FIXTURE_STATS } from '../benchmark-fixtures.js';

describe('a dataset declares its own size', () => {
  it('counts every case and every ground-truth entry in benchmark-data.ts', () => {
    const issues = ALL_BENCHMARK_CASES.reduce((sum, item) => sum + item.groundTruth.length, 0);

    expect(BENCHMARK_DATA_STATS.totalCases).toBe(ALL_BENCHMARK_CASES.length);
    expect(BENCHMARK_DATA_STATS.totalGroundTruthIssues).toBe(issues);
    // **The two are different numbers, and that is the whole point.** A file whose cases hold one entry each cannot
    // hide a unit error; this one holds two, which is why 15 could stand in for 30 for a year.
    expect(issues).toBeGreaterThan(ALL_BENCHMARK_CASES.length);
  });

  it('counts every fixture and every ground-truth entry in benchmark-fixtures.ts', () => {
    const issues = ALL_BENCHMARK_FIXTURES.reduce((sum, item) => sum + item.groundTruth.length, 0);

    expect(FIXTURE_STATS.totalFixtures).toBe(ALL_BENCHMARK_FIXTURES.length);
    expect(FIXTURE_STATS.totalGroundTruthIssues).toBe(issues);
  });

  it('adds to the 64 the citations file records, not the 49 it used to', () => {
    // A sum is only meaningful when both terms are the same unit. This asserts the unit, not the total.
    const total =
      BENCHMARK_DATA_STATS.totalGroundTruthIssues + FIXTURE_STATS.totalGroundTruthIssues;

    expect(total).toBe(64);
  });

  it('has no ground-truth entry without a line range to point at', () => {
    // A paper claim in the other direction: an entry that cannot say where the defect is cannot be matched by a
    // finding either, so it would inflate the denominator of every recall figure the runner produces.
    // **The two datasets do not share a ground-truth shape**, which is worth knowing: `benchmark-data.ts` carries
    // `filePath` per entry and `benchmark-fixtures.ts` carries it per fixture, and only the fixtures give an `id`.
    // Both agree on the line range, and the line range is what a finding is matched against.
    const empty = [
      ...ALL_BENCHMARK_CASES.flatMap((item) => item.groundTruth),
      ...ALL_BENCHMARK_FIXTURES.flatMap((item) => item.groundTruth),
    ].filter((entry) => entry.startLine === undefined || entry.endLine === undefined);

    expect(empty.map((entry) => entry.filePath)).toEqual([]);
  });
});
