// @code-analyzer/code-analyzer — the reviewer arm is dispatchable, and it is one lane swapped for one lane
//
// **A lane set that cannot be dispatched is a paragraph in a document.** §164 registers the device - a seventh
// question asked of the same diff, in place of the one whose entire product the cut deletes - and this file is the
// wiring that makes it a run: the workflow offers it, the planner builds the arm, the bench accepts the name, and the
// three lists agree about how many lanes the arm buys.
//
// **Why the swap rather than a seventh call.** A run that also costs 17 % more per file cannot be priced against one
// that does not, and the lane it replaces filed 192 findings whose category is `test` in the wide artifact - every one
// of them dropped by the cut's first step on both boards. **The bill is six calls either way**, which is the same
// rule §69.5 stated for `behaviour` and §107 for `lean`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { planMatrix } from '../../../.github/scripts/aacr-plan-matrix.mjs';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');
const BENCH = readFileSync(join(ROOT, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');

describe('the reviewer arm', () => {
  it('is a value a dispatch can choose, beside the sets that ship', () => {
    const options = /lane_set:[\s\S]*?options: \[([^\]]*)\]/u.exec(WORKFLOW);
    expect(
      options,
      'the workflow no longer declares the lane_set options in one list',
    ).not.toBeNull();
    expect(options![1]).toContain("'reviewer'");
    // **The default is a published figure.** A switch that moved it would re-price every table in `EVAL-CONTRACT.md`.
    expect(WORKFLOW).toMatch(/lane_set:\n(?:.*\n)*?\s+default: 'off'/u);
  });

  it('has a matrix arm, because an option with no arm downloads nothing', () => {
    // **R-35 lost its comparison to exactly this omission**: a dispatch value the matrix never produces uploads an
    // artifact with the baseline's name, and the step that pairs the arms then reads one artifact twice.
    expect(WORKFLOW).toContain('include: ${{ fromJSON(needs.plan.outputs.matrix) }}');
    const reviewer = planMatrix({ lane_set: 'reviewer' });
    expect(reviewer, 'the planner produced no arm for lane_set=reviewer').toHaveLength(1);
    expect(reviewer[0]!['lane_set']).toBe('reviewer');
    // **And the pair**, because a device is priced against an arm run in the same dispatch: two runs on different days
    // have reported the same configuration 0.07 apart, which is larger than every effect registered here.
    const pair = planMatrix({ lane_set: 'pair-reviewer' });
    expect(pair).toHaveLength(2);
    expect(pair[0]!['lane_set']).toBe('shipped');
    expect(pair[1]!['lane_set']).toBe('reviewer');
  });

  it('is accepted by the bench, with the size the arm actually buys', () => {
    // **The count is asserted where the run counts it**, because a set declared with six lanes and dispatched with five
    // is an artifact about a reviewer nobody ran (§58.1's shape). The table is read out of the run's own guard rather
    // than restated: a `reviewer: 7` here would pass while the guard threw after the corpus had been paid for.
    expect(BENCH).toContain("'reviewer'");
    expect(BENCH).toMatch(/reviewer: 6/);
  });

  it('keeps the pair in the planner and off this dispatch', () => {
    // **The acceptance is a fixed target, not a same-day delta**: §164 asks whether the arm's own `k = 5` reaches
    // `0.3735` and whether its pool names ten more goldens than `72`, and both are absolute readings of one artifact.
    // So this round buys one arm, and an option whose pair step never fires - which uploads one arm and reports a
    // comparison of one against nothing - is not offered until the device has something to price.
    const options = /lane_set:[\s\S]*?options: \[([^\]]*)\]/u.exec(WORKFLOW);
    expect(options![1]).not.toContain("'pair-reviewer'");
  });

  it('is refused under fused, because the fused prompt does not carry the question', () => {
    // **`FUSED_REVIEW_PROMPT` renders the union, and the union is not this set.** A fused call over `reviewer` would
    // buy a seventh question it never puts, and the artifact would name a reviewer whose lane was never asked - the
    // §58.1 shape one device over. **The guard is asserted here and the union is read from the module**, so the day
    // somebody writes the fused question the refusal disappears together with the reason for it.
    const prompts = readFileSync(
      join(ROOT, 'packages', 'intelligence', 'src', 'review', 'llm', 'prompts.ts'),
      'utf8',
    );
    const union = /export const FUSED_QUESTIONS[\s\S]*?\n\];/u.exec(prompts);
    expect(
      union,
      'FUSED_QUESTIONS is no longer declared in the shape this test reads',
    ).not.toBeNull();
    const asked = [...union![0].matchAll(/lane: '([a-z]+)'/gu)].map((match) => match[1]!);
    expect(asked).not.toContain('crosscheck');
    // **And the sets that have run are still covered**, so the guard refuses this arm rather than every arm.
    for (const lane of [
      'security',
      'architecture',
      'performance',
      'maintainability',
      'testing',
      'behaviour',
    ])
      expect(asked).toContain(lane);
    expect(BENCH).toMatch(/FUSED_QUESTIONS does not ask it/u);
  });
});
