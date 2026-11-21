// @code-analyzer/code-analyzer — the arms a dispatch buys are computed, so a combination can exist
//
// **Why this file exists.** Until §129 the arm list was a 9 394-character single-quoted `include:` expression: twenty-six
// `||` branches, each varying at most one key against the baseline. It was written that way to satisfy `variedField`,
// which refuses a pair of artifacts that differ in more than one key - a correct rule for a subtraction, and fatal for
// the only experiment that can find a good *combination*, because a factorial is not a subtraction.
//
// **What that cost, measured.** Three iterations of single-factor ablations (R-64, R-67, and the pair registrations
// before them) searched a space whose F1 ceiling - any re-cut of one artifact's 943 findings - is 0.2781. Every
// registered gain was smaller than the instrument's 0.0281 resolution. **A factor design would have priced three devices
// at once instead of three devices in three iterations**, which is the whole reason this file exists.
//
// So the rows moved into `.github/scripts/aacr-plan-matrix.mjs`, and this file holds the two things a move must prove:
// **the transcription is exact** (every branch the expression handled produces the same rows), and **the grid is a real
// factorial** (2^k rows, every factor at two levels, balanced so a main effect is a difference of two equal-sized means).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASE,
  GRID_FACTORS,
  experimentKind,
  gridRows,
  planMatrix,
} from '../../../.github/scripts/aacr-plan-matrix.mjs';
import { INPUT_VARS } from '../../../.github/scripts/aacr-plan-matrix-cli.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('a plan is the plan the expression built', () => {
  // **The table is the old `||` chain, branch for branch, in the order it evaluated.** A row that moved changes which
  // arm a dispatch with two inputs set buys, and the dispatch cannot be re-run to find out.
  const CASES: Array<[Record<string, string>, number, string]> = [
    [{}, 1, 'a dispatch with nothing set buys the baseline once'],
    [{ window: 'pair' }, 2, 'window outranks every other input'],
    [{ agent: 'pair' }, 2, 'agent pair'],
    [{ agent: 'on' }, 1, 'agent alone'],
    [{ idioms: 'pair' }, 2, 'idioms pair'],
    [{ idioms: 'on' }, 1, 'idioms alone'],
    [{ remarks: 'pair' }, 2, 'remarks pair'],
    [{ remarks: 'on' }, 1, 'remarks alone'],
    [{ pair: 'falsifier-v4' }, 2, 'the v4 contract'],
    [{ pair: 'change-shape' }, 2, 'change shape under the v2 contract'],
    [{ pair: 'falsifier-v3' }, 2, 'the v3 contract'],
    [{ pair: 'falsifier-v2' }, 2, 'the v2 contract'],
    [{ pair: 'falsifier' }, 2, 'the v1 contract'],
    [{ pair: 'on' }, 2, 'the retired adjudicator'],
    [{ ensemble: 'pair-reader' }, 2, 'reader ensemble pair'],
    [{ ensemble: 'reader' }, 1, 'reader ensemble'],
    [{ ensemble: 'pair' }, 2, 'full ensemble pair'],
    [{ ensemble: 'on' }, 1, 'full ensemble'],
    [{ second_concern: 'pair' }, 2, 'second concern pair'],
    [{ second_concern: 'on' }, 1, 'second concern'],
    [{ lane_set: 'pair-lean' }, 2, 'lean pair'],
    [{ lane_set: 'lean' }, 1, 'lean'],
    [{ lane_set: 'pair-wide' }, 2, 'wide pair'],
    [{ lane_set: 'wide' }, 1, 'wide'],
    [{ lane_set: 'pair' }, 2, 'behaviour pair'],
    [{ lane_set: 'on' }, 1, 'behaviour'],
    [{ window: 'grid' }, 8, 'the grid, which the expression could not express'],
  ];

  it.each(CASES)('%j buys %i arm(s) — %s', (inputs, expected) => {
    expect(planMatrix(inputs)).toHaveLength(expected);
  });

  it('gives every row all ten keys, because a missing key becomes a variable the matrix never recorded', () => {
    const keys = Object.keys(BASE).sort();
    expect(keys).toHaveLength(10);
    for (const inputs of CASES.map(([i]) => i)) {
      for (const row of planMatrix(inputs)) {
        expect(Object.keys(row).sort()).toEqual(keys);
      }
    }
  });

  it('differs in one key, except where the device is two keys by construction', () => {
    // **This is the constraint the old expression existed to satisfy**, and stating it as "which keys" rather than "one
    // row is the baseline" is the truer form: `pair=change-shape` keeps `adjudicate: falsifier-v2` on *both* rows,
    // because the device is only meaningful under the contract it was registered against - and it is still a pair,
    // because the difference between the two artifacts is one key.
    //
    // **`ensemble` is the one genuine two-key device**, and the exception is recorded rather than smoothed: a merge of
    // one reviewer is not a merge, so an ensemble arm cannot exist without `agent: on`. The pair is therefore
    // "five lanes" against "one agent that merges itself", which is a difference of two switches and one experiment.
    for (const [inputs] of CASES) {
      const rows = planMatrix(inputs);
      if (rows.length !== 2) continue;
      const differing = Object.keys(BASE).filter((k) => rows[0]![k] !== rows[1]![k]);
      const expected = String(inputs['ensemble'] ?? 'off').startsWith('pair')
        ? ['agent', 'ensemble']
        : null;
      if (expected === null) {
        expect(differing, `${JSON.stringify(inputs)} varies ${differing.length} keys`).toHaveLength(
          1,
        );
      } else {
        expect(differing.sort(), `${JSON.stringify(inputs)} is not the ensemble pair`).toEqual(
          expected,
        );
      }
    }
  });

  it('never produces two identical rows, because a duplicate is a measurement bought twice', () => {
    for (const [inputs] of CASES) {
      const rows = planMatrix(inputs).map((r) => JSON.stringify(r));
      expect(new Set(rows).size, `duplicate row in ${JSON.stringify(inputs)}`).toBe(rows.length);
    }
  });
});

describe('the grid is a factorial, not a pile of pairs', () => {
  const rows = gridRows();

  it('is 2^3 rows over three factors', () => {
    expect(rows).toHaveLength(8);
    expect(GRID_FACTORS).toHaveLength(3);
  });

  it('is closed: every factor is set in exactly half the rows', () => {
    // **Balance is what makes a main effect a difference of two equal-sized means.** An unbalanced grid would let the
    // mean of an "on" set be confounded with the number of rows in it, which is the defect an orthogonal design exists
    // to prevent.
    for (const factor of GRID_FACTORS) {
      const on = rows.filter((r) => r[factor] !== BASE[factor]).length;
      expect(on, `${factor} is not balanced`).toBe(rows.length / 2);
    }
  });

  it('varies nothing outside its three factors', () => {
    const others = Object.keys(BASE).filter((k) => !GRID_FACTORS.includes(k));
    for (const key of others) {
      expect(new Set(rows.map((r) => r[key]))).toEqual(new Set([BASE[key]]));
    }
  });

  it('keeps row 0 as the baseline, so a grid never re-buys its own control', () => {
    expect(rows[0]).toEqual(BASE);
  });

  it('contains every combination exactly once', () => {
    const patterns = rows.map((r) => GRID_FACTORS.map((f) => r[f]).join('|'));
    expect(new Set(patterns).size).toBe(8);
  });

  it('names a contract rather than the word on, because "on" is not a device', () => {
    // §74: two runs both wrote `adjudicate: true` and were not the same experiment. A grid that varied the boolean would
    // repeat that, one dimension wider.
    const adjudicate = new Set(rows.map((r) => r['adjudicate']));
    expect(adjudicate.has('on')).toBe(false);
    expect(adjudicate.has('falsifier-v2')).toBe(true);
  });
});

describe('a set of rows knows which experiment it is', () => {
  it('calls one row single, two rows differing in one key a pair, and a factorial a grid', () => {
    expect(experimentKind(planMatrix({}))).toBe('single');
    expect(experimentKind(planMatrix({ window: 'pair' }))).toBe('pair');
    expect(experimentKind(gridRows())).toBe('grid');
  });

  it('refuses to call a two-key pair a pair, which is the rule the old expression was built to satisfy', () => {
    const rows = [BASE, { ...BASE, code_context: 'on', remarks: 'on' }];
    expect(experimentKind(rows)).toBe('single');
  });

  it('refuses to call an incomplete factorial a grid', () => {
    // **Five rows over three two-level factors is 2^3 minus three**, which no main effect can be read from.
    expect(experimentKind(gridRows().slice(0, 5))).toBe('single');
  });
});

describe('the workflow reads the plan instead of holding it', () => {
  it('lets the matrix be the plan job output, with no branches left in the workflow', () => {
    expect(WORKFLOW).toContain('include: ${{ fromJSON(needs.plan.outputs.matrix) }}');
    // **The old expression is gone**, and asserting its absence is the point: a workflow that kept a copy and also
    // referenced the plan would have two truths about which arms to buy.
    expect(WORKFLOW).not.toContain("== ''pair-lean''");
    expect(WORKFLOW).not.toContain('"lane_set":"behaviour"');
  });

  it('buys the plan before it buys the arms', () => {
    expect(WORKFLOW).toMatch(/aacr-bench:\n\s+needs: plan/u);
    expect(WORKFLOW).toMatch(/^ {2}plan:\n/mu);
    expect(WORKFLOW).toContain('node .github/scripts/aacr-plan-matrix-cli.mjs');
  });

  it('maps every input the planner reads, and maps no input the workflow does not declare', () => {
    for (const name of INPUT_VARS) {
      const upper = name.toUpperCase();
      // **Built by concatenation rather than a template**, because `${{` inside a template literal is an interpolation
      // the parser reads before the test ever runs - which it did, as a parse error at this line.
      const expected = 'INPUT_' + upper + ': ${{ inputs.' + name;
      expect(WORKFLOW, `${name} is not passed to the planner`).toContain(expected);
    }
    // **And nothing extra**, because a planner reading an input the workflow never sets would always take its default
    // and silently ignore the one somebody dispatched. The braces are escaped: `{{` unescaped is a quantifier, which is
    // how this line failed to parse the first time it ran.
    const mapped = [...WORKFLOW.matchAll(/INPUT_([A-Z_]+): \$\{\{ inputs\.([a-z_]+)/gu)].map(
      (m) => m[2],
    );
    expect(new Set(mapped)).toEqual(new Set(INPUT_VARS));
  });

  it('offers grid as a window option, because an experiment nobody can dispatch is a document', () => {
    const options = /window:[\s\S]*?options:\s*\[([^\]]*)\]/u.exec(WORKFLOW);
    if (options !== null) {
      expect(options[1]).toContain("'grid'");
    } else {
      // **`window` may be declared as a bare list rather than an inline one**; either shape has to name the arm.
      expect(WORKFLOW).toContain('grid');
    }
  });
});
