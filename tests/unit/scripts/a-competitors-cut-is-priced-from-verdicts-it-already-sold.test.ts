// **A competitor's curve is a point, and the point was never priced.**
//
// §159.4 claimed the first reading above the bar (0.3221 against 0.2991) and immediately named what that claim does not
// establish: *their `0.2991` is their best of three readings, at whatever emission their pipeline produces, and their
// curve has not been priced* (S40). The arithmetic is cheap - every verdict in the pair was already bought - so what was
// missing was an instrument, and these cases hold the four properties that make the instrument's output a reading rather
// than a second opinion.
//
//   1. **The denominator is the corpus's, not the rows'.** A pull request with no row is a hole in the pairing and not a
//      zero, so its goldens stay in the denominator while contributing nothing to the numerator. The alternative flatters
//      whichever arm covered less of the corpus, and the arm that covered less is the one that ran out of time.
//   2. **Two findings credited with one golden is one true positive.** The corpus's own protocol is a maximum matching per
//      pull request; a sum over `matchedGoldens` reports 40 % more credit than the corpus does on the recorded file.
//   3. **The published figure has to be reproduced before a new one is printed.** A pricing over a different emission is
//      a pricing of a different run.
//   4. **A profile is a denominator, and the denominator is part of the question.** The board scores 158 of Martian's 173
//      goldens, so the same rows must be priceable on either.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/competitor-cut.mjs';

/**
 * Three pull requests, six goldens, and the third has no row.
 *
 * `A` holds `style, bug, bug`; `B` holds `style, bug`; `C` holds `bug` and the competitor produced nothing on it. **The
 * hole is the point of the fixture**: the corpus's denominator is six while the rows hold five, so a pricing that counted
 * its own rows would report `0.5455` where the corpus reports `0.5000`.
 */
const CORPUS = [
  {
    githubPrUrl: 'https://example.test/a/pull/1',
    comments: [{ category: 'style' }, { category: 'bug' }, { category: 'bug' }],
  },
  {
    githubPrUrl: 'https://example.test/b/pull/2',
    comments: [{ category: 'style' }, { category: 'bug' }],
  },
  { githubPrUrl: 'https://example.test/c/pull/3', comments: [{ category: 'bug' }] },
];

/**
 * Two rows whose findings are chosen to make the two cuts differ by more than the denominator does.
 *
 * `A` emits four findings, one of which the gate drops; `B` emits two and the gate drops one. On `all` the gate takes six
 * comments to four, and on `core` it takes five credited pairs to four - so neither number is a rescaling of the other.
 */
const PULLS = {
  'https://example.test/a/pull/1': {
    goldens: 3,
    matches: [[1], [2], [1, 2], []],
    keep: [true, true, false, true],
  },
  'https://example.test/b/pull/2': {
    goldens: 2,
    matches: [[0], []],
    keep: [true, false],
  },
};

function baseline(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    recordedAt: '2026-11-25',
    corpus: { fingerprint: 'sha256:fixture', judge: { model: 'deepseek-chat', prompt: 'aacr-judge-v1' } },
    competitor: { tool: 'open-code-review' },
    pulls: Object.fromEntries(
      Object.entries(PULLS).map(([key, row]) => [
        key,
        { ...row, detail: row.matches.map((matched) => ({ matchedGoldens: matched })), findings: row.matches.length },
      ]),
    ),
    ...overrides,
  });
}

interface Run {
  code: number;
  out: string;
  board: Record<string, unknown> | null;
}

function run(
  files: { baseline?: string; corpus?: string } = {},
  args: string[] = [],
): Run {
  const directory = mkdtempSync(join(tmpdir(), 'competitor-cut-'));
  const baselinePath = join(directory, 'baseline.json');
  writeFileSync(baselinePath, files.baseline ?? baseline());
  const corpusPath = join(directory, 'corpus.json');
  writeFileSync(corpusPath, files.corpus ?? JSON.stringify(CORPUS));
  const jsonPath = join(directory, 'out.json');
  const argv = [SCRIPT, '--baseline', baselinePath, '--corpus', corpusPath, '--json', jsonPath, ...args];
  try {
    const out = execFileSync('node', argv, { encoding: 'utf8' });
    return { code: 0, out, board: JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown> };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`, board: null };
  }
}

describe('a competitor’s cut is priced from verdicts it already sold', () => {
  it('divides by the corpus’s goldens, so a pull request with no row is a hole and not a zero', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    // Six goldens in the corpus, five of them on rows. Three credited: two by `A`, one by `B`.
    expect(out).toContain('goldens 6');
    expect(out).toContain('2 of 3 pull requests have a row');
    expect(out).toContain('emitted 6  tp 3  P 0.5000  R 0.5000  F1 0.5000');
    // Counting only the rows' own goldens would read 0.5455, and that number flatters the arm that stopped early.
    expect(out).not.toContain('0.5455');
  });

  it('credits one golden once, even when three findings claim it', () => {
    // `A`'s finding 2 claims goldens 1 and 2, both of which are already claimed. A sum over `matchedGoldens` reads four
    // credited pairs on `A`; the maximum matching reads two.
    const { board } = run();
    const shipped = board?.['asShipped'] as { truePositives: number; emitted: number };
    expect(shipped.truePositives).toBe(3);
    expect(shipped.emitted).toBe(6);
  });

  it('prices the second point the gate makes, from the flags the record carries', () => {
    const { out } = run();
    expect(out).toContain('at our gate    emitted 4  tp 3  P 0.7500  R 0.5000  F1 0.6000');
  });

  it('says there is one point when the gate removed nothing', () => {
    const kept = baseline({
      pulls: Object.fromEntries(
        Object.entries(PULLS).map(([key, row]) => [
          key,
          {
            ...row,
            keep: row.keep.map(() => true),
            detail: row.matches.map((matched) => ({ matchedGoldens: matched })),
            findings: row.matches.length,
          },
        ]),
      ),
    });
    const { code, out } = run({ baseline: kept });
    expect(code).toBe(0);
    expect(out).toContain('the gate removed nothing, so there is one point and not two');
    expect(out).not.toContain('at our gate');
  });

  it('moves the denominator to the profile the board publishes, without re-judging a pair', () => {
    const all = run();
    const core = run({}, ['--profile', 'core']);
    expect(core.code).toBe(0);
    expect(all.out).toContain('goldens 6');
    expect(core.out).toContain('goldens 4');
    // `A`'s `style` golden is dropped, which turns `B`'s only hits into non-matches: nothing credited there.
    expect(core.out).toContain('emitted 6  tp 2  P 0.3333  R 0.5000  F1 0.4000');
    expect(core.out).toContain('at our gate    emitted 4  tp 2  P 0.5000  R 0.5000  F1 0.5000');
  });

  it('refuses to print a figure it could not rebuild, and names both numbers', () => {
    const { code, out } = run({}, ['--guard', 'P=0.5000,R=0.5000,F1=0.6']);
    expect(code).toBe(2);
    expect(out).toContain('0.6000');
    expect(out).toContain('0.5000');
    expect(out).toContain('refuses');
  });

  it('prints the figure when the guard rebuilds it', () => {
    const { code, out } = run({}, ['--guard', 'P=0.5000,R=0.5000,F1=0.5000']);
    expect(code).toBe(0);
    expect(out).toContain('rebuilds');
  });

  it('reads the guard off the artifact rather than off a number a person typed', () => {
    // **The figures a run publishes are in the run's own artifact**, and a guard typed by hand is a second copy of them
    // that goes stale the first time the corpus moves. `--guard-from` reads `secondReviewer`, which is the block those
    // three numbers are published in, so the check cannot be about a different emission than the artifact beside it.
    const directory = mkdtempSync(join(tmpdir(), 'competitor-cut-guard-'));
    const artifactPath = join(directory, 'artifact.json');
    writeFileSync(
      artifactPath,
      JSON.stringify({ secondReviewer: { precision: 0.5, recall: 0.5, f1: 0.5 } }),
    );
    const passing = run({}, ['--guard-from', artifactPath]);
    expect(passing.code).toBe(0);
    expect(passing.out).toContain('the guard rebuilds P/R/F1 exactly');

    writeFileSync(
      artifactPath,
      JSON.stringify({ secondReviewer: { precision: 0.5, recall: 0.5, f1: 0.75 } }),
    );
    const failing = run({}, ['--guard-from', artifactPath]);
    expect(failing.code).toBe(2);
    expect(failing.out).toContain('refuses');
  });

  it('refuses an artifact that published no competitor figure, rather than guarding against nothing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'competitor-cut-noguard-'));
    const artifactPath = join(directory, 'artifact.json');
    writeFileSync(artifactPath, JSON.stringify({ secondReviewer: { missing: [] } }));
    const { code, out } = run({}, ['--guard-from', artifactPath]);
    expect(code).toBe(2);
    expect(out).toContain('secondReviewer');
  });

  it('needs the corpus, because the denominator lives there rather than in the rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'competitor-cut-'));
    const baselinePath = join(directory, 'baseline.json');
    writeFileSync(baselinePath, baseline());
    let code = 0;
    let out = '';
    try {
      execFileSync('node', [SCRIPT, '--baseline', baselinePath], { encoding: 'utf8' });
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      code = failed.status ?? 1;
      out = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
    }
    expect(code).toBe(2);
    expect(out).toContain('--corpus');
  });

  it('refuses a profile it has not registered, by name', () => {
    const { code, out } = run({}, ['--profile', 'everything']);
    expect(code).toBe(2);
    expect(out).toContain('everything');
    expect(out).toContain('all, core');
  });
});
