// @code-analyzer/code-analyzer — a lane whose every finding the emission rule deletes
//
// **The measurement this file was written after.** On two artifacts of fifty pull requests, `testing` filed 73 and 79
// findings whose category is `test`, and the shipped cut (`drop test, drop path class test, budget 12`) emitted **zero**
// of them - 152 findings in total, none of which reached a judge. The lane's own bill is not zero: five lanes see the
// same diff and pay for it five times, so `testing` is **19.9 % of a run's prompt tokens** (§107.1's ledger).
//
// **What that does and does not mean.** It does not mean the lane is worthless: a product reviewer that never asks for
// a missing test is a worse reviewer, and `drop test` is a rule about *this corpus*, whose goldens are written about
// `src/`. It means the *benchmark* is paying a fifth of its bill for findings its own cut deletes, and a benchmark whose
// arm costs 20 % more for nothing is a benchmark whose remaining devices are priced against a figure that includes the
// waste.
//
// **So the set is named, and it is a set rather than a change of default.** `shipped` stays what every published figure
// was measured under; `lean` is the same four questions minus the one this corpus does not score, and `pair-lean`
// dispatches both over the same rows so the difference between the artifacts is this line.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planMatrix } from '../../../.github/scripts/aacr-plan-matrix.mjs';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PROMPTS = readFileSync(
  join(ROOT, 'packages', 'intelligence', 'src', 'review', 'llm', 'prompts.ts'),
  'utf8',
);
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

function laneSetBody(name: string): string {
  const block = /export const LANE_SETS = \{([\s\S]*?)\n\} as const satisfies/.exec(PROMPTS);
  expect(block, 'LANE_SETS is no longer declared in the shape this test reads').not.toBeNull();
  const body = new RegExp(`\\n  ${name}: \\[([\\s\\S]*?)\\]`, 'u').exec(block![1]!);
  expect(body, `LANE_SETS.${name} is missing`).not.toBeNull();
  return body![1]!;
}

function lanesOf(name: string): string[] {
  return [...laneSetBody(name).matchAll(/'([a-z]+)'/g)].map((match) => match[1]!);
}

describe('the lane set the corpus does not score', () => {
  it('is the shipped four questions and not the fifth', () => {
    // **Derived rather than spelled out**, because a set written as a second list is a set that drifts the first time
    // somebody adds a lane to `shipped` and forgets this one: the assertion is `shipped` minus one name, in order.
    const shipped = lanesOf('shipped');
    const lean = lanesOf('lean');
    expect(shipped).toContain('testing');
    expect(lean).toEqual(shipped.filter((lane) => lane !== 'testing'));
    expect(lean).toHaveLength(shipped.length - 1);
  });

  it('is offered beside the shipped set rather than instead of it', () => {
    // **The default is a published figure.** A switch that moved it would re-price every table in `EVAL-CONTRACT.md`,
    // so the workflow must offer `lean` as an option on a choice whose default is still `off`.
    const options = /lane_set:[\s\S]*?options: \[([^\]]*)\]/u.exec(WORKFLOW);
    expect(
      options,
      'the workflow no longer declares the lane_set options in one list',
    ).not.toBeNull();
    expect(options![1]).toContain("'lean'");
    expect(options![1]).toContain("'pair-lean'");
    expect(WORKFLOW).toMatch(/lane_set:\n(?:.*\n)*?\s+default: 'off'/u);
  });

  it('has a matrix arm, because an option with no arm downloads nothing', () => {
    // **R-35 lost its comparison to exactly this omission.** A dispatch value the matrix never produces uploads an
    // artifact with the default arm's name, and the step that pairs the two arms then reads one artifact twice.
    //
    // **The arm is now read from the planner rather than from the expression that used to hold it.** §129 moved the
    // rows into `aacr-plan-matrix.mjs` so that a combination could exist at all; asserting a string inside a 9 KB
    // expression would have kept passing on a planner nobody had wired, which is the shape of a guard that certifies a
    // stale subject. This asserts the produced row instead - what the job would actually buy.
    expect(WORKFLOW).toContain('include: ${{ fromJSON(needs.plan.outputs.matrix) }}');

    const lean = planMatrix({ lane_set: 'lean' });
    expect(lean, 'the planner produced no arm for lane_set=lean').toHaveLength(1);
    expect(lean[0]!['lane_set']).toBe('lean');

    // **And the pair is two arms, one of them the shipped set**, because the comparison's sign is `with` minus
    // `without` and `with` has to be the arm that dropped a lane.
    const pair = planMatrix({ lane_set: 'pair-lean' });
    expect(pair).toHaveLength(2);
    expect(pair[0]!['lane_set']).toBe('shipped');
    expect(pair[1]!['lane_set']).toBe('lean');
    // **Every other key identical between the two**, which is what makes the difference a subtraction over one variable.
    const differing = Object.keys(pair[0]!).filter((k) => pair[0]![k] !== pair[1]![k]);
    expect(differing).toEqual(['lane_set']);
  });
});
