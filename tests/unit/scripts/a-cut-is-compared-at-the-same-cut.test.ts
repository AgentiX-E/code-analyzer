// **A comparison is about the reviewer only when the two arms are allowed the same number of comments.**
//
// §159 compared our `k = 5` against the competitor's uncut output and read the result as a lead; §162 records what that
// was. `scripts/same-cut.mjs` exists so the comparison cannot be made that way again, and these cases hold the five ways
// it can stop being true - every one of them a way the table would print two numbers about two different questions:
//
//   1. **A curve on another denominator.** Ours is `core`, theirs is recomputed from the corpus; a mismatch is a table of
//      two percentages of two wholes.
//   2. **A curve cut by other steps.** Both arms must be cut by the same non-budget steps, or the budget is not the only
//      thing varying down the table.
//   3. **Rows that are not in the order the arm ranked them.** "The top four" is only a cut if the list is ranked.
//   4. **A published point the rows do not rebuild.** A pricing over a different emission is a pricing of a different run.
//   5. **A gap that is not ours minus theirs.** The one column a reader will take on trust.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/same-cut.mjs';

/**
 * A corpus of two pull requests, four goldens each.
 *
 * `category` is `test` on one golden per pull request so the fixture exercises the `drop test` step both arms are cut by,
 * and `path` is a test path on one comment so the path-class step is exercised too.
 */
const CORPUS = [
  {
    githubPrUrl: 'https://example.invalid/pull/1',
    comments: [
      { category: 'bug', path: null },
      { category: 'bug', path: null },
      { category: 'test_gap', path: null },
      { category: 'test', path: null },
    ],
  },
  {
    githubPrUrl: 'https://example.invalid/pull/2',
    comments: [
      { category: 'bug', path: null },
      { category: 'bug', path: null },
      { category: 'doc_defect', path: null },
      { category: 'test', path: null },
    ],
  },
];

/** One arm's rows: `[path, category, score, goldens]` per comment, in ranked order. */
type Row = [string, string, number, number[]];

function baseline(rows: Record<string, Row[]>): Record<string, unknown> {
  const pulls: Record<string, unknown> = {};
  for (const [pr, entries] of Object.entries(rows)) {
    pulls[pr] = {
      goldens: 4,
      detail: entries.map(([path, category, score, goldens]) => ({
        path,
        category,
        score,
        actionable: true,
        matchedGoldens: goldens,
      })),
    };
  }
  return { version: 1, competitor: { tool: 'fixture' }, pulls };
}

/** Our side, as `scripts/cut-curve.mjs` writes it: one budget step, and the same steps before it. */
function curve(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const rows = [
    { budget: 1, emitted: 2, truePositives: 1, precision: 0.5, recall: 1 / 6, f1: 2 / 8 },
    { budget: 2, emitted: 4, truePositives: 3, precision: 0.75, recall: 0.5, f1: 0.75 },
  ];
  return {
    version: 'cut-curve-v1',
    results: [
      {
        artifact: 'benchmarks/fixture.json',
        corpus: 'benchmarks/fixture-corpus.json',
        profile: 'core',
        cut: 'drop:test+drop-path:test+budget:2',
        goldens: 6,
        shipped: { emitted: 4, truePositives: 3 },
        curve: rows,
        ...overrides,
      },
    ],
  };
}

function run(options: {
  theirs?: Record<string, unknown>;
  ours?: Record<string, unknown>;
  args?: string[];
}): { code: number; out: string; json: Record<string, unknown> | null } {
  const directory = mkdtempSync(join(tmpdir(), 'same-cut-'));
  const write = (name: string, body: unknown) => {
    const path = join(directory, name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };
  const corpus = write('corpus.json', CORPUS);
  const theirs = write('baseline.json', options.theirs ?? baseline(THEIRS));
  const ours = write('curve.json', options.ours ?? curve());
  const out = join(directory, 'out.json');
  const args = [
    SCRIPT,
    '--ours',
    ours,
    '--theirs',
    theirs,
    '--corpus',
    corpus,
    '--json',
    out,
    ...(options.args ?? ['--expect-theirs', '6,6']),
  ];
  try {
    const stdout = execFileSync('node', args, { encoding: 'utf8' });
    return { code: 0, out: stdout, json: JSON.parse(readFileSync(out, 'utf8')) };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failed.status ?? 1,
      out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      json: null,
    };
  }
}

/**
 * The competitor's four comments, two per pull request, in score order, each on its own golden.
 *
 * Deliberately **worse than our fixture at the same budget on the first row and better on the second**, so that a table
 * which lined the two arms up wrongly would produce a different sign in the gap column.
 */
const THEIRS: Record<string, Row[]> = {
  'https://example.invalid/pull/1': [
    ['src/a.ts', 'bug', 0.9, [0]],
    ['src/b.ts', 'bug', 0.8, [1]],
    ['test/a.test.ts', 'test', 0.7, [2]],
  ],
  'https://example.invalid/pull/2': [
    ['src/c.ts', 'bug', 0.9, [0]],
    ['src/d.ts', 'bug', 0.6, [1]],
    ['src/e.ts', 'doc_defect', 0.5, [2]],
  ],
};

describe('a cut is compared at the same cut on both arms', () => {
  it('prints both arms on one budget axis and reads the gap as ours minus theirs', () => {
    const { code, out, json } = run({});
    expect(code).toBe(0);
    expect(out).toContain('same cut · core');
    const comparison = (json as { comparison: { budget: number; gap: number }[] }).comparison;
    expect(comparison.map((row) => row.budget)).toStrictEqual([1, 2]);
    for (const row of comparison) {
      const at = (
        json as { comparison: { budget: number; ours: { f1: number }; theirs: { f1: number } }[] }
      ).comparison.find((entry) => entry.budget === row.budget)!;
      expect(row.gap).toBeCloseTo(at.ours.f1 - at.theirs.f1, 12);
    }
  });

  it('cuts both arms by the same steps before the budget', () => {
    // The `test` comment and the test-path comment leave both emissions, so the first row is two comments on each side.
    const { json } = run({});
    const first = (
      json as { comparison: { ours: { emitted: number }; theirs: { emitted: number } }[] }
    ).comparison[0]!;
    expect(first.theirs.emitted).toBe(2);
    expect(first.ours.emitted).toBe(2);
  });

  it('records which published point it checked the competitor rows against', () => {
    const { json } = run({});
    expect(
      (json as { guards: { theirsPublished: { source: string; emitted: number } } }).guards
        .theirsPublished,
    ).toStrictEqual({ emitted: 6, truePositives: 6, source: 'argument' });
  });

  it('refuses a curve that was cut on another profile', () => {
    const { code, out } = run({ ours: curve({ profile: 'all' }) });
    expect(code).toBe(1);
    expect(out).toContain('cut on profile all and this table is on core');
  });

  it('refuses a curve cut by steps the table would not apply to both arms', () => {
    const { code, out } = run({ ours: curve({ cut: 'budget:2' }) });
    expect(code).toBe(1);
    expect(out).toContain('and this table applies');
  });

  it('refuses rows that are not in the order the competitor ranked them', () => {
    const shuffled = baseline({
      ...THEIRS,
      'https://example.invalid/pull/1': [
        ['src/a.ts', 'bug', 0.8, [0]],
        ['src/b.ts', 'bug', 0.9, [1]],
      ],
    });
    const { code, out } = run({ theirs: shuffled });
    expect(code).toBe(1);
    expect(out).toContain('are not in score order');
  });

  it('refuses when the rows do not rebuild the published point', () => {
    const { code, out } = run({ args: ['--expect-theirs', '99,6'] });
    expect(code).toBe(1);
    expect(out).toContain('rebuild 6 comments / 6 true positives');
  });

  it('refuses when our own curve disagrees with the point it says it shipped', () => {
    const { code, out } = run({
      ours: curve({ shipped: { emitted: 3, truePositives: 3 } }),
    });
    expect(code).toBe(1);
    expect(out).toContain('shipped row and its row at budget 2 disagree');
  });

  it('refuses a published point it cannot read as two integers', () => {
    const { code, out } = run({ args: ['--expect-theirs', 'four,three'] });
    expect(code).toBe(2);
    expect(out).toContain('takes "emitted,truePositives"');
  });
});
