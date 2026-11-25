// **The pool's density is a property of a stage, and §160.3 compared two stages.**
//
// §160.3 published `0.0986` against the competitor's `0.1769` and called our pool "nearly twice as dilute". The two
// figures were not the same quantity: ours divided the **full emission** - before the product's own rule - and theirs
// divided the **shipped** emission - after the competitor's. Correcting it needs an instrument that says which stage it
// measured, and these cases hold the four properties that make its output a reading rather than a second opinion.
//
//   1. **The pool is the rule's output and not the budget's.** A comment the rule refuses never competes for a slot, and a
//      comment that a slot refuses was still in the pool: the two stages are printed as two rows, and the reported density
//      is the first one's.
//   2. **Density and marginal value are different questions.** A lane whose comments are all credited can still be free to
//      remove when every slot it holds would go to a comment that is also credited; a lane with a poor density can still be
//      load-bearing when the slots it frees go unused. Only the budget makes those differ.
//   3. **The rebuild has to reproduce the artifact's own point**, because a pool rebuilt through a rule the run did not
//      apply is a pool about a different reviewer.
//   4. **A marginal that one half of the corpus chose and the other half denies is not a marginal.** The whole-pool delta
//      is `+0.0000` on both lanes below precisely because the halves cancel, which is what a reader would have published
//      as "neither lane matters" if the halves were never separated.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/pool-density.mjs';

/**
 * Two pull requests, one golden each, and two lanes that are each worth the slot on one of them.
 *
 * `quiet` is credited on `a/1` and uncredited on `b/2`; `loud` is the reverse - and on both pull requests `quiet` scores
 * higher, so **the budget keeps `quiet` on `b/2` where it credits nothing and would keep `loud` if `quiet` were gone.**
 * At a budget of one the two effects cancel exactly. That is the fixture's purpose: the whole pool sees nothing, and the
 * halves see `-1.0000` and `+1.0000`.
 */
const CORPUS = [
  { githubPrUrl: 'https://example.test/a/pull/1', comments: [{ category: 'bug' }] },
  { githubPrUrl: 'https://example.test/b/pull/2', comments: [{ category: 'bug' }] },
];

const FIRST = 'https://example.test/a/pull/1';
const SECOND = 'https://example.test/b/pull/2';

function finding(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    pr: FIRST,
    lane: 'loud',
    category: 'bug',
    path: 'src/a.ts',
    score: 5,
    matchedGoldens: [],
    ...overrides,
  };
}

/**
 * Six findings after the rule: `loud` carries four of them and credits one, `quiet` carries two and credits one.
 *
 * The `test`-category comment is the one the rule refuses, and it scores 20 - **higher than everything the budget will
 * ever see**, so a pool measured after the budget instead of after the rule would report a density of one comment in two
 * rather than two in six.
 */
const FINDINGS = [
  finding({ lane: 'quiet', score: 9, matchedGoldens: [0] }),
  finding({ score: 5 }),
  finding({ score: 3 }),
  finding({ score: 2 }),
  finding({ category: 'test', path: 'src/a.test.ts', score: 20 }),
  finding({ pr: SECOND, lane: 'quiet', score: 9 }),
  finding({ pr: SECOND, score: 5, matchedGoldens: [0] }),
];

/**
 * The artifact a run published: one step that drops a category, one budget of one, and the point those two produce.
 *
 * `point` is `k: 2, truePositives: 1` - the kept comments are `quiet` on both pull requests and one of them is credited.
 * **A fixture whose point is not what the rebuild produces cannot test the guard**, so the published numbers are the ones
 * the arithmetic gives rather than round numbers chosen to look plausible.
 */
function artifact(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    configuration: { laneSet: { name: 'fixture', lanes: ['loud', 'quiet'] } },
    truePositives: 1,
    falseNegatives: 1,
    emissionRules: {
      shipped: {
        steps: [
          { kind: 'drop', categories: ['test'] },
          { kind: 'budget', k: 1 },
        ],
        point: { k: 2, truePositives: 1, falsePositives: 1, precision: 0.5, recall: 0.5, f1: 0.5 },
      },
    },
    rankedFindings: FINDINGS,
    ...overrides,
  });
}

/** One lane that holds a slot it cannot pay for, and one credited comment below it. */
const WASTED_SLOT = JSON.stringify({
  version: 1,
  configuration: { laneSet: { name: 'fixture', lanes: ['dud', 'quiet'] } },
  truePositives: 1,
  falseNegatives: 0,
  emissionRules: {
    shipped: { steps: [{ kind: 'budget', k: 1 }], point: { k: 1, truePositives: 0 } },
  },
  rankedFindings: [
    { pr: FIRST, lane: 'dud', category: 'bug', path: 'src/a.ts', score: 9, matchedGoldens: [] },
    {
      pr: FIRST,
      lane: 'quiet',
      category: 'bug',
      path: 'src/a.ts',
      score: 5,
      matchedGoldens: [0],
    },
  ],
});

interface Run {
  code: number;
  out: string;
  board: Record<string, unknown> | null;
}

function run(args: string[] = [], files: { artifact?: string; corpus?: string } = {}): Run {
  const directory = mkdtempSync(join(tmpdir(), 'pool-density-'));
  const artifactPath = join(directory, 'artifact.json');
  writeFileSync(artifactPath, files.artifact ?? artifact());
  const corpusPath = join(directory, 'corpus.json');
  writeFileSync(corpusPath, files.corpus ?? JSON.stringify(CORPUS));
  const jsonPath = join(directory, 'out.json');
  try {
    const out = execFileSync(
      'node',
      [SCRIPT, artifactPath, '--corpus', corpusPath, '--json', jsonPath, ...args],
      { encoding: 'utf8' },
    );
    return {
      code: 0,
      out,
      board: JSON.parse(readFileSync(jsonPath, 'utf8')) as Record<string, unknown>,
    };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failed.status ?? 1,
      out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`,
      board: null,
    };
  }
}

describe('a pool is measured before the slots are contested', () => {
  it('prints the pool the rule leaves and the point the budget makes, as two rows', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    // Six of seven findings survive the `drop test` step; the budget then keeps one per pull request.
    expect(out).toContain('pool after the rule 6 with 2 credited');
    expect(out).toContain('at the budget: emitted 2  tp 1  P 0.5000  R 0.5000  F1 0.5000');
    // **The density in the header is the pool's and not the budget's**: two credited of six, against one of two.
    expect(out).toContain('density 0.3333');
  });

  it('gives each lane its own matching rather than a share of the pool’s', () => {
    const { board } = run();
    const groups = board?.['groups'] as { group: string; comments: number; density: number }[];
    // `quiet` writes two comments and one is credited; `loud` writes four and one is credited.
    expect(groups.find((group) => group.group === 'quiet')).toMatchObject({
      comments: 2,
      density: 0.5,
    });
    expect(groups.find((group) => group.group === 'loud')).toMatchObject({
      comments: 4,
      density: 0.25,
    });
  });

  it('shows a lane whose removal gains a point when the slot it holds is wasted', () => {
    const { code, board } = run([], { artifact: WASTED_SLOT });
    expect(code).toBe(0);
    const groups = board?.['groups'] as { group: string; delta: number }[];
    // `dud` scores nine and credits nothing; the budget of one keeps it and drops the comment that would have scored.
    expect(groups.find((group) => group.group === 'dud')?.delta).toBeCloseTo(1, 6);
    expect(groups.find((group) => group.group === 'quiet')?.delta).toBeCloseTo(0, 6);
  });

  it('refuses a pool it cannot rebuild, and names both counts', () => {
    const mismatch = artifact({
      emissionRules: {
        shipped: { steps: [{ kind: 'budget', k: 4 }], point: { k: 4, truePositives: 2 } },
      },
    });
    const { code, out } = run([], { artifact: mismatch });
    expect(code).toBe(1);
    // Six comments survive a budget of four applied to a pool of five and two; the published point says four. **The counts
    // rather than the rate**, because a matching bug and a denominator bug both move F1 and only one moves a count.
    expect(out).toContain('the rebuild emits 6 comments / 2 true positives');
    expect(out).toContain('the artifact published 4 / 2');
  });

  it('needs a profile before it will split the corpus in half', () => {
    const { code, out } = run(['--split-half']);
    expect(code).toBe(2);
    expect(out).toContain('--split-half needs --profile');
  });

  it('leaves a lane unresolved when its two halves disagree, however large either half reads', () => {
    const { code, board, out } = run(['--profile', 'core', '--split-half']);
    expect(code).toBe(0);
    // **Both lanes read `+0.0000` on the whole pool**, which is the reading that would have ended the question.
    const whole = board?.['groups'] as { group: string; delta: number; verdict: string }[];
    expect(whole.every((group) => Math.abs(group.delta) < 1e-9)).toBe(true);

    const split = board?.['splitHalf'] as {
      groups: { group: string; chosenDelta: number; heldOutDelta: number; verdict: string }[];
    };
    const quiet = split.groups.find((group) => group.group === 'quiet');
    // One half is credited only by `quiet`, the other only by `loud`: removing `quiet` loses everything on the first and
    // gains everything on the second, and the pair is a disagreement rather than an average.
    expect(quiet?.chosenDelta).toBeCloseTo(-1, 6);
    expect(quiet?.heldOutDelta).toBeCloseTo(1, 6);
    expect(quiet?.verdict).toBe('unresolved');
    expect(out).toContain('unresolved');
  });
});
