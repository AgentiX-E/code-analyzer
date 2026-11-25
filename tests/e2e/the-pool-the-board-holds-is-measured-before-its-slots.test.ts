// **The board's own artifacts, read the way the command line reads them.**
//
// The unit cases lock the arithmetic on a fixture that makes every branch fire. This one runs the same instrument over
// what the repository actually shipped - `benchmarks/martian-bench.json` and the Martian corpus beside it - because the
// figure §161 publishes is a reading of those two files and a reading nobody re-runs is a number in a paragraph.
//
// **The finding these cases lock is a negative one**, and it is the round's most useful result: on this board no lane and
// no category is *resolvably* free to remove. Both of the candidates that looked free on the whole pool reverse sign in
// one half, `security` is load-bearing in both halves, and `bug` dominates everything - which is why the campaign's next
// device has to change what a lane writes rather than whether it runs.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ARTIFACT = 'benchmarks/martian-bench.json';
const CORPUS = 'benchmarks/martian/positive_samples.json';

interface Reading {
  fullEmission: number;
  pool: number;
  poolPoint: { truePositives: number };
  point: { emitted: number; truePositives: number; f1: number };
  groups: { group: string; comments: number; density: number; delta: number; verdict: string }[];
  splitHalf: {
    groups: { group: string; chosenDelta: number; heldOutDelta: number; verdict: string }[];
  };
}

function read(args: string[]): Reading {
  const json = join(mkdtempSync(join(tmpdir(), 'pool-e2e-')), 'out.json');
  execFileSync(
    'node',
    [
      'scripts/pool-density.mjs',
      ARTIFACT,
      '--corpus',
      CORPUS,
      '--profile',
      'core',
      '--budget',
      '5',
      '--split-half',
      '--json',
      json,
      ...args,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(readFileSync(json, 'utf8')) as Reading;
}

describe('the pool the board holds is measured before its slots are contested', () => {
  const lanes = read([]);
  const categories = read(['--group', 'category']);

  it('rebuilds the shipped point and then divides the pool the rule leaves', () => {
    // The guard has already refused the run if the rebuild disagreed with the artifact, so reaching here is the first
    // assertion; these are the two stages it prints, and **the density is the pool's rather than the budget's**.
    expect(lanes.fullEmission).toBe(943);
    expect(lanes.pool).toBe(743);
    expect(lanes.poolPoint.truePositives).toBe(86);
    expect(lanes.poolPoint.truePositives / lanes.pool).toBeCloseTo(0.1157, 4);
    // At the budget §159 chose for the wide arm, applied to the shipped arm's pool: this is the point every marginal
    // below is measured against, and it is 0.2732 rather than the 0.2757 the artifact ships at `k = 12`.
    expect(lanes.point).toMatchObject({ emitted: 230, truePositives: 53 });
    expect(lanes.point.f1).toBeCloseTo(0.2732, 4);
  });

  it('names the lane whose slots the corpus pays for, in both halves', () => {
    const security = lanes.splitHalf.groups.find((group) => group.group === 'security');
    // **Negative on the half that chose it and negative on the half that did not see it**, and the held-out magnitude is
    // four times the instrument's resolution: this is the one group on this board a removal cannot be proposed for.
    expect(security?.chosenDelta).toBeLessThan(0);
    expect(security?.heldOutDelta).toBeLessThan(-0.0126);
    expect(security?.verdict).toBe('load-bearing');
  });

  it('finds no lane it can resolvably retire, which is the round’s finding', () => {
    // Four of five lanes are `unresolved` and the fifth is load-bearing. **A verdict of `removal-gains` here would be a
    // lane the campaign could delete for free**, and there is not one - so the two candidates the whole-pool column
    // favours (`maintainability` at `+0.0058`, `performance` at `+0.0066`) stay, at a fifth of the resolution each.
    expect(lanes.splitHalf.groups.map((group) => group.verdict)).not.toContain('removal-gains');
    expect(lanes.splitHalf.groups.filter((group) => group.verdict === 'unresolved')).toHaveLength(
      4,
    );
  });

  it('puts half the pool in one lane and a quarter of it in the one that pays', () => {
    const byName = new Map(lanes.groups.map((group) => [group.group, group]));
    // `architecture` writes 55.7 % of the pool at a density of 0.1159; `security` writes 17.8 % at 0.25. **The lane with
    // the volume and the lane with the yield are different lanes**, which is what makes "raise the density" a statement
    // about one lane rather than about the reviewer.
    expect(byName.get('architecture')?.comments).toBe(414);
    expect(byName.get('architecture')?.density).toBeCloseTo(0.1159, 4);
    expect(byName.get('security')?.comments).toBe(132);
    expect(byName.get('security')?.density).toBeCloseTo(0.25, 4);
  });

  it('separates the category that carries the board from the category that dilutes it', () => {
    const byName = new Map(categories.groups.map((group) => [group.group, group]));
    // `bug` is 48.2 % of the pool and credits 63 of the pool's 86 goldens; `architecture` is a quarter of the pool at
    // 0.0526, and even its whole-pool gain does not survive the split.
    expect(byName.get('bug')).toMatchObject({ comments: 358, truePositives: 63 });
    expect(byName.get('architecture')?.density).toBeCloseTo(0.0526, 4);
    const bug = categories.splitHalf.groups.find((group) => group.group === 'bug');
    expect(bug?.verdict).toBe('load-bearing');
  });
});
