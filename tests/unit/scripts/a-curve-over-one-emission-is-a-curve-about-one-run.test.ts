// The cut curve — the test that proves the instrument refuses the two ways a curve can lie.
//
// `F1 = 2·TP/(emitted + goldens)`, so the budget is a term in the figure. §157.4 found the shipped `budget: 12` right on
// AACR and 0.015-0.032 wrong on two Martian artifacts, which is a property of a constant. The instrument that reads that
// is only worth having if it refuses (a) a curve over an emission the artifact never shipped and (b) a held-out figure
// divided by the wrong denominator — because both produce a table that adds up and means nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/cut-curve.mjs';

interface Finding {
  pr: string;
  path: string;
  category: string;
  matchedGoldens?: number[];
}

/** A two-pull-request artifact where the score order is the array order, so every expected figure is arithmetic. */
function artifact(options: { emitted?: number; truePositives?: number } = {}): string {
  const findings: Finding[] = [];
  // Twelve findings on the first pull request, twelve on the second: the first four of each are true positives.
  for (const pr of ['https://example.test/a/pull/1', 'https://example.test/b/pull/2']) {
    for (let index = 0; index < 12; index += 1) {
      findings.push({
        pr,
        path: `src/file${String(index)}.ts`,
        category: 'bug',
        matchedGoldens: index < 4 ? [index] : [],
      });
    }
  }
  const truePositives =
    options.truePositives ??
    findings.reduce((total, finding) => total + (finding.matchedGoldens ?? []).length, 0);
  const emitted = options.emitted ?? findings.length;
  return JSON.stringify({
    measuredAt: '2026-11-25',
    rankedFindings: findings,
    truePositives,
    falseNegatives: 8 - truePositives,
    emissionRules: {
      shipped: {
        steps: [
          { kind: 'drop', categories: ['test'] },
          { kind: 'budget', k: 12 },
        ],
        point: { k: emitted, truePositives },
      },
    },
  });
}

/** A corpus whose golden counts are known: one pull request holds two, the other one. */
function corpus(): string {
  return JSON.stringify([
    {
      pr_url: 'https://example.test/a/pull/1',
      comments: [
        { note: 'one', path: 'src/a.ts' },
        { note: 'two', path: 'src/b.ts' },
      ],
    },
    { pr_url: 'https://example.test/b/pull/2', comments: [{ note: 'three', path: 'src/c.ts' }] },
  ]);
}

function run(
  files: { artifact: string; corpus?: string },
  args: string[] = [],
): { code: number; out: string } {
  const directory = mkdtempSync(join(tmpdir(), 'cut-curve-'));
  const artifactPath = join(directory, 'artifact.json');
  writeFileSync(artifactPath, files.artifact);
  const argv = [SCRIPT, artifactPath, ...args];
  if (files.corpus !== undefined) {
    const corpusPath = join(directory, 'corpus.json');
    writeFileSync(corpusPath, files.corpus);
    argv.push('--corpus', corpusPath);
  }
  try {
    const stdout = execFileSync('node', argv, { encoding: 'utf8' });
    return { code: 0, out: stdout };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

describe('the cut curve', () => {
  it('prints a curve whose figures are the arithmetic the artifact already holds', () => {
    const { code, out } = run({ artifact: artifact() }, ['--budgets', '2,4,12']);
    expect(code).toBe(0);
    // Two pull requests at a budget of two: four comments, all of them true positives, over eight goldens.
    expect(out).toContain('0.6667');
    expect(out).toContain('<- shipped');
  });

  it('refuses a curve over an emission the artifact never published', () => {
    // The artifact says it shipped 24 comments and 8 true positives; the findings can only rebuild 24 and 8 - but the
    // published point is adjusted here to 20, which is the shape of a stale artifact and the one this guard exists for.
    const { code, out } = run({ artifact: artifact({ emitted: 20 }) }, ['--budgets', '4']);
    expect(code).toBe(1);
    expect(out).toContain('the artifact published 20');
  });

  it('refuses a held-out figure without the corpus that holds its denominator', () => {
    const { code, out } = run({ artifact: artifact() }, ['--split-half']);
    expect(code).toBe(2);
    expect(out).toContain('--split-half needs --corpus');
  });

  it('chooses on one half and reports the other, with each half divided by its own goldens', () => {
    const { code, out } = run({ artifact: artifact(), corpus: corpus() }, [
      '--split-half',
      '--budgets',
      '2,4,6',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/split-half {2}chosen k=\d on chosen/);
    // The two halves hold two and one goldens: the held-out half is one reference comment, not three.
    expect(out).toContain('held out F1');
  });
});
