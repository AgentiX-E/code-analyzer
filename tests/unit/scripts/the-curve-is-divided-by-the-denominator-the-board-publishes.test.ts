// **A curve divided by the wrong denominator is a curve about a different corpus.**
//
// `F1 = 2·TP/(emitted + goldens)` and the board publishes its bar on **158** of Martian's 173 goldens (the eight Core
// categories, minus `style` and `speculative`). §140.5 found our own figures divided by 173 while every competitor's were
// divided by 158 - and §157.4 then priced the budget on the 173 denominator, which is the same defect one level down: **a
// curve whose held-out gain is computed on a basis the board does not publish is a number that cannot be placed beside
// the bar.**
//
// So the instrument takes a profile, and these cases hold the three properties that make it safe:
//
//   1. **The emission guard stays on the artifact's own basis.** The guard asks whether the curve is about the run the
//      artifact published; that question is about 173, and re-basing it to 158 would reject an artifact for a difference
//      the profile introduced.
//   2. **A profile needs the corpus**, because the denominator lives in the corpus rather than in the findings.
//   3. **An unregistered profile is refused by name**, rather than silently scoring all of them.

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

/**
 * Two pull requests, five goldens, three of them in the profile the board publishes.
 *
 * Pull request A holds `style, bug, bug`; B holds `style, bug`. The verdicts are ordered so that a budget of two keeps
 * one the profile drops and one it keeps - which is what makes the two denominators differ on one emission.
 */
const VERDICTS: ReadonlyArray<readonly [string, ReadonlyArray<ReadonlyArray<number>>]> = [
  ['https://example.test/a/pull/1', [[1], [2], [0], [], [], []]],
  ['https://example.test/b/pull/2', [[1], [0], [], []]],
];

function artifact(): string {
  const findings: Finding[] = VERDICTS.flatMap(([pr, goldens]) =>
    goldens.map((matchedGoldens, index) => ({
      pr,
      path: `src/f${String(index)}.ts`,
      category: 'bug',
      matchedGoldens: [...matchedGoldens],
    })),
  );
  const truePositives = findings.reduce(
    (total, finding) => total + (finding.matchedGoldens ?? []).length,
    0,
  );
  return JSON.stringify({
    measuredAt: '2026-11-25',
    rankedFindings: findings,
    truePositives,
    falseNegatives: 5 - truePositives,
    emissionRules: {
      shipped: {
        steps: [{ kind: 'budget', k: 12 }],
        point: { k: findings.length, truePositives },
      },
    },
  });
}

/** The board's own corpus shape, `githubPrUrl` and a category on every comment. */
function corpus(): string {
  return JSON.stringify([
    {
      githubPrUrl: 'https://example.test/a/pull/1',
      comments: [{ category: 'style' }, { category: 'bug' }, { category: 'bug' }],
    },
    {
      githubPrUrl: 'https://example.test/b/pull/2',
      comments: [{ category: 'style' }, { category: 'bug' }],
    },
  ]);
}

function run(
  files: { artifact: string; corpus?: string },
  args: string[] = [],
): { code: number; out: string } {
  const directory = mkdtempSync(join(tmpdir(), 'cut-curve-profile-'));
  const artifactPath = join(directory, 'artifact.json');
  writeFileSync(artifactPath, files.artifact);
  const argv = [SCRIPT, artifactPath, ...args];
  if (files.corpus !== undefined) {
    const corpusPath = join(directory, 'corpus.json');
    writeFileSync(corpusPath, files.corpus);
    argv.push('--corpus', corpusPath);
  }
  try {
    return { code: 0, out: execFileSync('node', argv, { encoding: 'utf8' }) };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

describe('the curve is divided by the denominator the board publishes', () => {
  it('scores the same emission over 173 goldens and over the 158 the board scores', () => {
    const all = run({ artifact: artifact(), corpus: corpus() }, ['--budgets', '2']);
    const core = run({ artifact: artifact(), corpus: corpus() }, [
      '--budgets',
      '2',
      '--profile',
      'core',
    ]);
    expect(all.code).toBe(0);
    expect(core.code).toBe(0);
    expect(all.out).toContain('goldens 5');
    expect(core.out).toContain('goldens 3');
    // Four comments at a budget of two: four credited over five goldens, against three credited over three.
    expect(all.out).toContain('0.8889');
    expect(core.out).toContain('0.8571');
  });

  it('keeps the emission guard on the artifact basis, which is the only basis the artifact published', () => {
    // The published point credits five verdicts and the profile credits three. A guard re-based to the profile would read
    // the five as a stale artifact and refuse; the guard is about the run, so it reads five.
    const { code, out } = run({ artifact: artifact(), corpus: corpus() }, [
      '--profile',
      'core',
      '--budgets',
      '2',
    ]);
    expect(code).toBe(0);
    expect(out).not.toContain('the artifact published');
  });

  it('refuses a profile without the corpus that holds its denominator', () => {
    const { code, out } = run({ artifact: artifact() }, ['--profile', 'core']);
    expect(code).toBe(2);
    expect(out).toContain('--profile needs --corpus');
  });

  it('refuses a profile it has not registered, by name and with the ones it knows', () => {
    const { code, out } = run({ artifact: artifact(), corpus: corpus() }, [
      '--profile',
      'everything',
    ]);
    expect(code).toBe(2);
    expect(out).toContain('everything');
    expect(out).toContain('all, core');
  });

  it('holds out a half whose goldens are the profile goldens of that half', () => {
    const { code, out } = run({ artifact: artifact(), corpus: corpus() }, [
      '--split-half',
      '--profile',
      'core',
      '--budgets',
      '1,2',
    ]);
    expect(code).toBe(0);
    // Chosen on A (two profile goldens), held out on B (one): two comments, one credited, over one golden.
    expect(out).toContain('held out F1 0.6667 against 0.4000');
  });
});
