// The flagship figure, measured on a dataset this project did not write.
//
// **Why this file exists.** `citations.json` records F1 0.761 for the internal suite - 49 hand-written fixtures, and
// `independentValidation: false` because this project wrote them. The scorecard has said `measured: false` for the
// PR-review target ever since, while the number itself was already above both the target and the competitor.
//
// Those 49 fixtures cannot support a published comparison. A hundred issues from public bug-fix commits can, and
// this is what measures the same engine against them.
//
// **The mapping, which is the whole subtlety.** `BenchmarkRunner.runSingleCase` analyses `file.afterContent` - the
// code submitted for review. The internal fixtures are PRs that *add* code, so their `afterContent` is the code with
// the bug in it. A real bug-fix commit is the opposite: the fix is in `after`, and **the code that was wrong is
// `before`**. So the code under review is the before-content, and its ground-truth ranges - read from the human's
// patch, window-relative - already point into exactly that.
//
//   internal fixture   afterContent = the code under review
//   real issue         beforeContent = the code under review   <- the mapping below
//
// **The number this prints is the point of the whole exercise.** It is not expected to be 0.761: that figure came
// from fixtures tuned against this engine, and a dataset written by other people is a harder question.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BenchmarkRunner } from '../benchmark/benchmark-runner.js';

import type { BenchmarkCase } from '../benchmark/benchmark-data.js';

const DATASET = resolve(process.cwd(), 'benchmarks/real-ground-truth/issues.json');

interface RealIssue {
  id: string;
  language: string;
  description: string;
  files: Array<{ filePath: string; beforeContent: string; afterContent: string }>;
  groundTruth: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    category: string;
    severity: string;
    description: string;
  }>;
}

/**
 * A real issue as a `BenchmarkCase`, with the before-content as the code under review.
 *
 * **The one line that carries the semantics**: `afterContent: file.beforeContent`. Everything else is a rename, and
 * the ground-truth ranges need no adjustment because they were taken window-relative in that same content.
 */
function toBenchmarkCase(issue: RealIssue): BenchmarkCase {
  return {
    id: issue.id,
    language: issue.language,
    description: issue.description,
    files: issue.files.map((f) => ({
      filePath: f.filePath,
      // **`''` is not a placeholder, it is load-bearing.** `runSingleCase` computes
      // `changeType = beforeContent === '' ? 'added' : 'modified'` and builds a diff from it, and the path-based rules
      // fire on the diff's lines. The window IS the changed region, so it is `added` - and the first version of this
      // harness set `beforeContent` to the same text as `afterContent`, which made the diff EMPTY and left those
      // rules reporting static positions instead of the lines a human had changed. That produced F1 0.0021 against
      // an engine whose findings were simply aimed elsewhere.
      beforeContent: '',
      // The code the reviewer is looking at: the state the human's fix changed.
      afterContent: f.beforeContent,
    })),
    groundTruth: issue.groundTruth.map((g) => ({
      filePath: g.filePath,
      startLine: g.startLine,
      endLine: g.endLine,
      category: g.category as BenchmarkCase['groundTruth'][number]['category'],
      severity: g.severity as BenchmarkCase['groundTruth'][number]['severity'],
      description: g.description,
    })),
    expectedFalsePositives: [],
  } as BenchmarkCase;
}

describe('the engine against real ground truth', () => {
  it('reports precision, recall and F1 on the real dataset, and how many issues it holds', () => {
    if (!existsSync(DATASET)) {
      // A dataset that has not been extracted yet is a legitimate state.
      expect(existsSync(DATASET)).toBe(false);
      return;
    }
    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { count: number; issues: RealIssue[] };
    const cases = data.issues.map(toBenchmarkCase);
    const result = new BenchmarkRunner().runBenchmark(cases);
    // The names are `overall*` on `AggregateMetrics`; reading the wrong ones gave `undefined`, which the
    // range assertions below would have caught if the console line had not printed first.
    const { overallPrecision: precision, overallRecall: recall, overallF1: f1Score } = result.aggregate;

    // One line, greppable, and it carries the dataset size - a figure without its population is not a measurement.
    // eslint-disable-next-line no-console
    console.log(
      `REAL-F1 ${f1Score} (precision ${precision}, recall ${recall}) on ${data.count} real issues, ` +
        `${result.languagesTested} language(s)`,
    );

    // **The shapes that must hold whatever the number turns out to be.** A metric outside its range, or a benchmark
    // that processed no cases, is a broken measurement rather than a bad result.
    expect(data.count).toBe(cases.length);
    expect(cases.length).toBeGreaterThan(0);
    expect(result.fixturesProcessed).toBe(cases.length);
    for (const metric of [precision, recall, f1Score]) {
      expect(metric).toBeGreaterThanOrEqual(0);
      expect(metric).toBeLessThanOrEqual(1);
    }
    // F1 is the harmonic mean of the other two, so it cannot exceed either of them.
    expect(f1Score).toBeLessThanOrEqual(Math.max(precision, recall) + 1e-9);
    expect(f1Score).toBeGreaterThanOrEqual(Math.min(precision, recall) - 1e-9);
  }, 120_000);

  it('does not depend on the dataset being the internal suite', () => {
    if (!existsSync(DATASET)) return;
    const data = JSON.parse(readFileSync(DATASET, 'utf8')) as { issues: RealIssue[] };
    // Every case names a public commit. That is what makes the number publishable, and it is checked here so a
    // dataset that lost its provenance cannot be scored as if it had it.
    for (const issue of data.issues) {
      expect(issue.id).toMatch(/^real-/);
    }
  });
});
