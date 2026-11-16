// **The arm that ships is not a predicate over one finding, and for one iteration the artifact pretended it was.**
//
// §54 moved the lanes' headline from the actionability gate to `drop test, budget 12`. The gate is `finding.actionable`,
// which `paired-replay.mjs` can recompute from any row. **The budget is a function of the pull request** - twelve
// comments among however many that pull request produced - so `keep(finding)` cannot express it, and `scoring.publishedArm`
// went on saying `gate` while the file's own headline was the policy.
//
// The check that caught it: `43775832164` published F1 0.2148 and the replay recomputed the gate's 0.1997 from the same
// rows, so `aacr-paired-replay.mjs --check` failed the job. **That is the checker doing its job** - the artifact said one
// thing and its rows said another - and the repair is the one below: the artifact publishes the arm it published
// (`shipped`), one row per pull request carries what that rule kept (`shippedEmitted`), and the replay reads it back.
//
// **The second assertion is the one that matters more.** With the arm's rows absent, the comparison used to skip all
// three fields and report `ok: true` - a check that passes by not running. It now fails, and names the arm.

import { describe, expect, it } from 'vitest';

import { compareReplayToArtifact, replayHeadToHead } from '../../../scripts/lib/paired-replay.mjs';

/** One pull request, three goldens, five comments filed and three of them posted. */
const row = (
  pr: string,
  goldens: number,
  covered: number[],
  shippedEmitted: number,
  emitted: number,
) => ({
  pr,
  goldens,
  covered,
  shippedEmitted,
  emitted,
});

const ranked = [
  { pr: 'a', path: 'src/a.ts', category: 'bug', actionable: true, matchedGoldens: [0] },
  { pr: 'a', path: 'src/a.ts', category: 'bug', actionable: true, matchedGoldens: [] },
  { pr: 'a', path: 'src/a.ts', category: 'test', actionable: false, matchedGoldens: [] },
];

const bench = {
  measuredAt: '2026-11-16',
  // **One comment, one golden, three goldens in the pull request**: precision 1, recall 1/3, F1 0.5 - the three numbers
  // a shipped point can hold at once, and the reason the fixture publishes all three rather than one.
  precision: 1,
  recall: 0.3333,
  f1: 0.5,
  scoring: { publishedArm: 'shipped' },
  emissionRules: {
    shipped: {
      steps: [
        { kind: 'drop', categories: ['test'] },
        { kind: 'budget', k: 12 },
      ],
    },
  },
  rankedFindings: ranked,
  coverage: { byPullRequest: [row('a', 3, [0], 1, 3)] },
};

describe('the shipped arm, replayed from the rows the artifact publishes for it', () => {
  it('reproduces the published figure from `covered` and `shippedEmitted`', () => {
    const replay = replayHeadToHead({ bench, baseline: { pulls: {} } });
    // One golden covered by one comment: precision and recall are both a third, which is what the artifact published.
    expect(replay.whole.shipped).toMatchObject({
      precision: 1,
      recall: 0.3333,
      f1: 0.5,
      truePositives: 1,
      falsePositives: 0,
      falseNegatives: 2,
    });
    expect(compareReplayToArtifact(replay, bench).ok).toBe(true);
  });

  it('reads a different figure from the same rows under the gate, which is why the arm has to be named', () => {
    const replay = replayHeadToHead({ bench, baseline: { pulls: {} } });
    // **The two arms disagree on the same pull request**, and that is the whole defect in one assertion: the gate keeps
    // both actionable findings and posts one of them twice, while the policy posts one.
    expect(replay.whole.gate.precision).not.toBe(replay.whole.shipped?.precision);
  });

  it('refuses an artifact that names an arm its rows cannot reproduce, instead of skipping the comparison', () => {
    const withoutRows = {
      ...bench,
      coverage: { byPullRequest: [{ pr: 'a', goldens: 3, covered: [0], emitted: 3 }] },
    };
    const replay = replayHeadToHead({ bench: withoutRows, baseline: { pulls: {} } });
    expect(replay.whole.shipped).toBeUndefined();
    const verdict = compareReplayToArtifact(replay, withoutRows);
    expect(verdict.ok).toBe(false);
    expect(verdict.mismatches).toEqual([
      {
        field: 'arm',
        published: 'shipped',
        replayed: null,
        arm: 'shipped',
        reason: 'the artifact names an arm its own rows cannot reproduce',
      },
    ]);
  });

  it('leaves an artifact that publishes no figure alone, because there is nothing to check', () => {
    const empty = { ...bench, precision: null, recall: null, f1: null };
    const replay = replayHeadToHead({ bench: empty, baseline: { pulls: {} } });
    expect(compareReplayToArtifact(replay, empty).ok).toBe(true);
  });
});
