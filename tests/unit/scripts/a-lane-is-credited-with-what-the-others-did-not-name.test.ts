// **A lane is worth its call only when it names what the other lanes do not.**
//
// §162.3 measured the number the claim is about: our emission names 84 credited goldens at any budget on the board's
// 158, and the competitor's arm reaches 109. **No cut can reach a comment nobody wrote**, so every device since then has
// been aimed at the pool - and the pool's arithmetic has one trap in it: a lane that re-states a golden another lane
// already named adds a comment and no recall. `matchedGoldens` cannot tell the two apart, because both rows carry the
// same golden index.
//
// `scripts/lane-discovery.mjs` is the instrument, and these cases hold the five ways it could report a gain that is not
// one:
//
//   1. **A pool rebuilt under another cut.** The arm's own published point has to rebuild through its own steps first.
//   2. **A lane's credit counted against itself.** The number that matters is what it credits that no other lane does.
//   3. **A budget that was not re-imposed.** `--budget` replaces the run's budget step and nothing else.
//   4. **A difference that is not a difference.** `onlyArm` / `onlyReference` / `shared` have to add up to the two
//      ceilings, keyed by pull request as well as by index.
//   5. **A counterfactual that was never made.** `--without` has to name a lane this artifact used, has to leave the
//      arm's own headline numbers alone, and must not be answered by dropping nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT = 'scripts/lane-discovery.mjs';

/**
 * **Two pull requests, three goldens, and one golden that two lanes both claim.**
 *
 * `A:0` is named by `alpha` and re-stated by `beta`; `A:1` and `B:0` are named by one lane each. So the ceiling is three
 * and only two lanes' uniques are non-zero - which is the distinction this file exists to keep.
 */
const ARM = {
  version: 'artifact-fixture',
  truePositives: 3,
  falseNegatives: 2,
  configuration: { laneSet: { name: 'reviewer', lanes: ['alpha', 'beta'] } },
  emissionRules: {
    shipped: {
      rule: 'budget 2',
      steps: [{ kind: 'budget', k: 2 }],
      // **Four comments, not three**: the budget is per pull request, and the second one has two findings to keep.
      point: { k: 4, truePositives: 3 },
    },
  },
  rankedFindings: [
    // A: three findings, budget 2 keeps the two highest scores.
    {
      pr: 'A',
      lane: 'alpha',
      score: 0.9,
      category: 'bug',
      matchedGoldens: [0],
      text: 'the call names a',
    },
    {
      pr: 'A',
      lane: 'beta',
      score: 0.5,
      category: 'bug',
      matchedGoldens: [0],
      text: 'a restated, about A:0',
    },
    {
      pr: 'A',
      lane: 'alpha',
      score: 0.7,
      category: 'bug',
      matchedGoldens: [1],
      text: 'the call names b',
    },
    // B: two findings, one golden, both claim it - the matching pays for one.
    {
      pr: 'B',
      lane: 'beta',
      score: 0.9,
      category: 'bug',
      matchedGoldens: [0],
      text: 'the key is c',
    },
    {
      pr: 'B',
      lane: 'alpha',
      score: 0.6,
      category: 'bug',
      matchedGoldens: [0],
      text: 'a restated, about B:0',
    },
  ],
};

/** A second arm, so the set difference has something to be different from. */
const REFERENCE = {
  ...ARM,
  truePositives: 2,
  falseNegatives: 3,
  configuration: { laneSet: { name: 'wide', lanes: ['alpha'] } },
  emissionRules: {
    shipped: {
      rule: 'budget 2',
      steps: [{ kind: 'budget', k: 2 }],
      point: { k: 2, truePositives: 2 },
    },
  },
  rankedFindings: [
    {
      pr: 'A',
      lane: 'alpha',
      score: 0.9,
      category: 'bug',
      matchedGoldens: [0],
      text: 'the call names a',
    },
    {
      pr: 'B',
      lane: 'alpha',
      score: 0.9,
      category: 'bug',
      matchedGoldens: [0],
      text: 'the key is c',
    },
  ],
};

function run(artifact: object, extra: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-discovery-'));
  const path = join(dir, 'arm.json');
  writeFileSync(path, `${JSON.stringify(artifact)}\n`, 'utf8');
  return execFileSync('node', [SCRIPT, '--arm', path, '--profile', 'all', ...extra], {
    encoding: 'utf8',
  });
}

function failure(artifact: object, extra: string[] = []): { status: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lane-discovery-'));
  const path = join(dir, 'arm.json');
  writeFileSync(path, `${JSON.stringify(artifact)}\n`, 'utf8');
  try {
    execFileSync('node', [SCRIPT, '--arm', path, '--profile', 'all', ...extra], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stderr?: Buffer | string };
    return { status: Number(failed.status ?? 1), stderr: String(failed.stderr ?? '') };
  }
}

describe('a lane is credited with what the others did not name', () => {
  it("rebuilds the arm's own point before it prints a ceiling", () => {
    const out = run(ARM);
    expect(out).toContain('guard k 4 · truePositives 3');
    expect(out).toContain('ceiling 3 credited goldens');
  });

  it('counts a re-statement as a comment and not as credit', () => {
    // **`beta` names `A:0` and `B:0`, and `alpha` names both as well**, so its unique count is the number that decides
    // whether its call earned its place. A table that reported `credited` alone would show `beta` at two and read as a
    // second opinion when it is an echo.
    const out = run(ARM);
    const line = (lane: string): string[] =>
      out
        .split('\n')
        .find((row) => row.startsWith(lane))
        ?.trim()
        .split(/\s+/u) ?? [];
    expect(line('alpha')[1]).toBe('3'); // findings
    expect(line('alpha')[2]).toBe('3'); // credited
    expect(line('alpha')[3]).toBe('1'); // unique: only alpha names A:1
    expect(line('beta')[2]).toBe('2');
    expect(line('beta')[3]).toBe('0');
  });

  it('re-imposes the budget and leaves the rest of the cut alone', () => {
    // **The run's cut is `budget 2`**, and `--budget 1` has to replace that step rather than add a second one: at one
    // comment per pull request the arm emits two and credits two, and a second budget step would leave the original two
    // in force and print the same figure twice.
    const out = run(ARM, ['--budget', '1']);
    expect(out).toContain('budget 1 · 2 comments · 2 credited');
  });

  it('adds the set difference up, so onlyArm and onlyReference are two sides of one union', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lane-discovery-'));
    const armPath = join(dir, 'arm.json');
    const referencePath = join(dir, 'reference.json');
    writeFileSync(armPath, `${JSON.stringify(ARM)}\n`, 'utf8');
    writeFileSync(referencePath, `${JSON.stringify(REFERENCE)}\n`, 'utf8');
    const out = execFileSync(
      'node',
      [SCRIPT, '--arm', armPath, '--reference', referencePath, '--profile', 'all'],
      { encoding: 'utf8' },
    );
    // **Both arms' ceilings are three and two, and the shared set is two** (`A:0` and `B:0`), so the difference is one
    // golden this arm names that the reference never did - `A:1` - and none the other way round.
    expect(out).toContain('their ceiling 2 · shared 2 · only this arm 1 · only theirs 0');
  });

  it('refuses an artifact whose pool does not rebuild its own point', () => {
    // **The failure this guard exists for**: a pool cut by a rule the run did not apply is a pool about a different
    // reviewer, and every ceiling under it is a claim about nothing.
    const wrong = {
      ...ARM,
      emissionRules: {
        shipped: { ...ARM.emissionRules.shipped, point: { k: 4, truePositives: 2 } },
      },
    };
    const refused = failure(wrong);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('refusing');
  });

  it('refuses an artifact that publishes no cut at all', () => {
    // **Exit 2 rather than 1**, because nothing was measured: an artifact with no `emissionRules.shipped` is a record of
    // a run that did not say what it emitted, which is an argument about the file rather than a disagreement with it.
    const refused = failure({ version: 'x', rankedFindings: [] });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('emissionRules.shipped');
  });

  it('drops a lane out of one artifact and reports both sides of the swap', () => {
    // **The counterfactual has to come from the same run.** `alpha` names `A:0`, `A:1` and `B:0`; without it the pool is
    // `beta`'s two restatements and the ceiling falls from three to two. The headline figures above the block stay the
    // arm's own, because a record whose number belongs to a set of lanes it does not have is the error this file is about.
    const out = run(ARM, ['--budget', '2', '--without', 'alpha']);
    expect(out).toContain('ceiling 3 credited goldens');
    expect(out).toContain('without alpha: 3 findings dropped · denominator held at 5');
    expect(out).toContain(
      'ceiling 3 -> 2 · k=2 F1 0.6667 -> 0.5714 · credited 3 -> 2 · comments 4 -> 2',
    );
  });

  it('refuses a lane the artifact never used, rather than dropping nothing', () => {
    // **A typo that quietly drops nothing** reports the arm's own numbers as the answer to "what happens without this
    // lane", which is the most convincing possible way to be wrong about a swap that was never made.
    const refused = failure(ARM, ['--without', 'gamma']);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('no such lane');
    expect(refused.stderr).toContain('alpha, beta');
  });
});
