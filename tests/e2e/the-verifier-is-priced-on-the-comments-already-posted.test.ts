// @code-analyzer/scripts — the verifier priced end to end, on a corpus small enough to check by hand
//
// **What this test is for.** §166.4's prize is arithmetic on an artifact; the device that has to reach it is a pass over
// sentences. Between the two sits a readout, and a readout is exactly the kind of code that can be wrong in a way every
// unit test agrees with: a cut applied in the wrong order, a bit addressed to the wrong pair, a comment silently added back.
// So this runs `scripts/symbol-crosscheck.mjs` as a process, over a two-pull-request corpus whose F1 can be computed on
// paper, and asserts the numbers it prints.
//
// **Why a fixture rather than the real board.** The real board's numbers come from a run that buys judge calls; this file
// must be free and must run on every commit. The fixture is the *shape* - two arms, one judge, a fixed budget - and the
// real board is the same code path with 227 comments instead of 4.
//
// **The user story it stands for.** *A reviewer posts four comments; the verifier corrects one of them; the number of
// comments does not move; the corrected sentence earns a golden the original did not.* If that story stops being true, the
// prize this campaign has been aiming at stops meaning anything.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const REPO = resolve(import.meta.dirname, '../..');
const PR1 = 'https://github.com/o/r/pull/1';
const PR2 = 'https://github.com/o/r/pull/2';

const work = mkdtempSync(join(tmpdir(), 'crosscheck-'));
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** Two pull requests, four goldens of which the Core profile keeps three. */
const CORPUS = [
  {
    githubPrUrl: PR1,
    comments: [
      { note: 'the credential id is handed to a user lookup', category: 'bug' },
      { note: 'the refresh call is not awaited', category: 'security' },
      { note: 'the docstring is stale', category: 'style' },
    ],
  },
  { githubPrUrl: PR2, comments: [{ note: 'the retry budget is ignored', category: 'bug' }] },
];

/** Four comments, two per pull request, and a budget that posts all four. */
const ARTIFACT = {
  measuredAt: '2026-11-26',
  truePositives: 2,
  falseNegatives: 1,
  emissionRules: {
    shipped: {
      steps: [{ kind: 'budget', k: 2 }],
      point: { k: 4, truePositives: 2 },
    },
  },
  rankedFindings: [
    {
      pr: PR1,
      path: 'a.ts',
      startLine: 10,
      score: 0.9,
      category: 'bug',
      text: 'alpha is wrong',
      matchedGoldens: [0],
    },
    {
      pr: PR1,
      path: 'a.ts',
      startLine: 20,
      score: 0.5,
      category: 'bug',
      text: 'beta is wrong',
      matchedGoldens: [],
    },
    {
      pr: PR2,
      path: 'b.ts',
      startLine: 5,
      score: 0.8,
      category: 'bug',
      text: 'gamma is wrong',
      matchedGoldens: [0],
    },
    {
      pr: PR2,
      path: 'b.ts',
      startLine: 9,
      score: 0.4,
      category: 'bug',
      text: 'delta is wrong',
      matchedGoldens: [],
    },
  ],
};

/** The plan §166 published, in miniature: one golden on a comment we post, addressed by the row the plan chose. */
const PLAN = {
  version: 'symbol-adjacency-v1',
  plan: [{ key: `${PR1}#1`, golden: 1, findingAt: 1, rank: 2, symbols: ['credentialId'] }],
};

/**
 * **The recorded run, in the shape `--mode record` writes it.**
 *
 * Arm A credits two goldens - row 0 against PR1's first, row 2 against PR2's only one. Arm B credits those **and** the one
 * the correction earned, row 1 against PR1's second - which is the whole reason §166.5 says a conversion is not a credit:
 * had PR1 held one golden, correcting a second comment on it would have stolen the credit rather than added any.
 */
function recorded(armB) {
  return {
    version: 'symbol-crosscheck-v1',
    verdicts: [
      {
        at: 0,
        pr: PR1,
        path: 'a.ts',
        startLine: 10,
        symbol: 'alpha',
        rewritten: false,
        before: 'alpha is wrong',
        after: 'alpha is wrong',
      },
      {
        at: 1,
        pr: PR1,
        path: 'a.ts',
        startLine: 20,
        symbol: 'credentialId',
        rewritten: true,
        before: 'beta is wrong',
        after: '`refresh` hands `credentialId` to `findUser`, which wants a user id',
      },
      {
        at: 2,
        pr: PR2,
        path: 'b.ts',
        startLine: 5,
        symbol: 'gamma',
        rewritten: false,
        before: 'gamma is wrong',
        after: 'gamma is wrong',
      },
      {
        at: 3,
        pr: PR2,
        path: 'b.ts',
        startLine: 9,
        symbol: 'delta',
        rewritten: false,
        before: 'delta is wrong',
        after: 'delta is wrong',
      },
    ],
    verifier: { contract: 'two-sides-v1', considered: 4, called: 2, rewritten: 1, failed: 0 },
    judgements: {
      calls: 4,
      armA: {
        [`${PR1}#0~0`]: true,
        [`${PR1}#1~0`]: false,
        [`${PR1}#0~1`]: false,
        [`${PR1}#1~1`]: false,
        [`${PR2}#0~2`]: true,
        [`${PR2}#0~3`]: false,
      },
      armB: armB ?? {
        [`${PR1}#0~0`]: true,
        [`${PR1}#1~0`]: false,
        [`${PR1}#0~1`]: false,
        [`${PR1}#1~1`]: true,
        [`${PR2}#0~2`]: true,
        [`${PR2}#0~3`]: false,
      },
    },
  };
}

function run(overrides = {}) {
  const out = join(work, 'out.json');
  writeFileSync(out, `${JSON.stringify(recorded(overrides.armB), null, 2)}\n`);
  writeFileSync(join(work, 'arm.json'), `${JSON.stringify(ARTIFACT, null, 2)}\n`);
  writeFileSync(join(work, 'corpus.json'), `${JSON.stringify(CORPUS, null, 2)}\n`);
  writeFileSync(join(work, 'plan.json'), `${JSON.stringify(PLAN, null, 2)}\n`);
  const stdout = execFileSync(
    process.execPath,
    [
      join(REPO, 'scripts/symbol-crosscheck.mjs'),
      '--arm',
      join(work, 'arm.json'),
      '--corpus',
      join(work, 'corpus.json'),
      '--plan',
      join(work, 'plan.json'),
      '--profile',
      'core',
      '--budget',
      '2',
      '--mode',
      'replay',
      '--out',
      out,
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  return { stdout, result: JSON.parse(execFileSync('cat', [out], { encoding: 'utf8' })) };
}

describe('a rewrite is priced on the comments that were already posted', () => {
  const { result, stdout } = run();

  it('posts the same number of comments in both arms, which is the premise of the prize', () => {
    expect(result.comments).toEqual({ armA: 4, armB: 4, unchanged: true });
  });

  it('scores both arms against the same denominator', () => {
    // **Three goldens survive the Core profile out of four**, and a recall computed against the artifact's own count would
    // be a different denominator wearing the same name.
    expect(result.goldens).toBe(3);
  });

  it('computes F1 the way the artifact does, from credit over the sum of the two denominators', () => {
    expect(result.point.armA.truePositives).toBe(2);
    expect(result.point.armA.f1).toBeCloseTo((2 * 2) / (4 + 3), 6);
    expect(result.point.armB.truePositives).toBe(3);
    expect(result.point.armB.f1).toBeCloseTo((2 * 3) / (4 + 3), 6);
  });

  it('reports the one pair the correction moved, and no others', () => {
    expect(result.paired).toMatchObject({ pairs: 6, fixed: 1, broken: 0, delta: 1 });
  });

  it('counts the plan entry it converted, and the golden that conversion earned', () => {
    expect(result.prize.planned).toBe(1);
    expect(result.prize.rewritten).toBe(1);
    expect(result.prize.credited).toBe(1);
    expect(result.prize.detail[0]).toMatchObject({
      key: `${PR1}#1`,
      rewritten: true,
      credited: true,
    });
  });

  it('says whether the bar was cleared, rather than leaving a reader to compare two numbers', () => {
    expect(result.bar.target).toBe(0.3735);
    expect(result.bar.cleared).toBe(true);
    expect(result.bar.deltaToTarget).toBeGreaterThan(0);
  });

  it('prints the pair of points rather than only the winner', () => {
    expect(stdout).toContain('4 / 4');
    expect(stdout).toContain('2 → 3');
  });
});

describe('an arm that changed nothing is reported as changed nothing', () => {
  const same = recorded();
  const { result } = run({
    armB: Object.fromEntries(
      Object.entries(same.judgements.armA).map(([key, value]) => [key, value]),
    ),
  });

  it('reports no movement at all', () => {
    expect(result.paired).toMatchObject({ fixed: 0, broken: 0, delta: 0, p: 1 });
    expect(result.point.delta).toBe(0);
  });

  it('does not credit the plan entry, because no verdict moved for it', () => {
    expect(result.prize.credited).toBe(0);
  });
});

describe('the readout refuses to invent a run it was not given', () => {
  it('refuses a replay with no recorded run, rather than printing a figure from nothing', () => {
    let failure: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(
        process.execPath,
        [
          join(REPO, 'scripts/symbol-crosscheck.mjs'),
          '--arm',
          join(work, 'arm.json'),
          '--corpus',
          join(work, 'corpus.json'),
          '--out',
          join(work, 'nothing-here.json'),
        ],
        { cwd: REPO, encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure).not.toBeNull();
    expect(failure?.status).toBe(2);
    expect(String(failure?.stderr)).toMatch(/needs a recorded run/);
  });
});
