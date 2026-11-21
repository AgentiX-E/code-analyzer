import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { planMatrix } from '../../../.github/scripts/aacr-plan-matrix.mjs';

/**
 * **The merge flag has three states, and the third one exists because a device was measured by accident.**
 *
 * R-29 was registered as *a list merged from the five lanes and the reading reviewer* and dispatched with the lanes
 * emptied by the cost rule three hundred lines upstream (§57.2). It merged the reader with nothing, scored **0.2504
 * against 0.2148** on the confirmation slice, and reported `confirmed` - **a plausible figure for a device that never
 * ran.** The repair cannot be "never empty the lanes again", because emptying them was right for every other agent arm;
 * it is to **name the one-sided device** so that the arm which was measured by accident becomes an arm that can be
 * registered, re-run and falsified.
 *
 * These assertions are wiring, and the reason they are this file's subject is that **no figure in that artifact could
 * have caught the difference**: both devices produce a number, both numbers are internally consistent, and the artifact
 * named the same configuration either way.
 */
const BENCH = readFileSync(resolve(__dirname, '../../../.github/scripts/aacr-bench.mjs'), 'utf8');
const WORKFLOW = readFileSync(
  resolve(__dirname, '../../../.github/workflows/aacr-bench.yml'),
  'utf8',
);

describe('the merge flag', () => {
  it('reads three values, and only one of them skips the lanes', () => {
    expect(BENCH).toContain('const ENSEMBLE_READER_ONLY = ENSEMBLE_MODE ===');
    // **The condition, not the comment**: a one-sided merge keeps the cost rule, because the lanes it would empty are
    // the lanes it was never given.
    expect(BENCH).toContain('const lanesRun = !AGENT || (ENSEMBLE && !ENSEMBLE_READER_ONLY);');
  });

  it('records which of the two devices ran, because a pair is matched on the artifact', () => {
    // `false` for the lanes, `on` for the union, `reader` for the one-sided merge. **A boolean here is what let one
    // device be counted as the other**, so the value carries the device's name.
    expect(BENCH).toContain('const ENSEMBLE_SETTING = ENSEMBLE ? ENSEMBLE_MODE : false;');
    expect(BENCH).toContain('ensemble: AGENT ? ENSEMBLE_SETTING : false,');
  });

  it('is dispatchable as either pair, and the compare job fires for both', () => {
    const input = WORKFLOW.slice(WORKFLOW.indexOf('      ensemble:'));
    // `options:` comes after `type:` in this file, so the slice has to run to the default rather than to the type.
    const options = input.slice(0, input.indexOf('default:'));
    for (const value of ['on', 'reader', 'pair', 'pair-reader']) {
      expect(options).toContain(`'${value}'`);
    }
    // **R-30's own defect, asserted**: the paired job listed four inputs and this one was not among them, so the run
    // bought two arms and its comparison job was skipped - **the job whose output is the reason the run exists.**
    const gate = WORKFLOW.slice(WORKFLOW.indexOf('  compare:'));
    const condition = gate.slice(0, gate.indexOf('timeout-minutes'));
    expect(condition).toContain("(inputs.ensemble || 'off') == 'pair'");
    expect(condition).toContain("(inputs.ensemble || 'off') == 'pair-reader'");
  });

  it('downloads the reader-only arm under the name its own matrix row produces', () => {
    // The name is expanded from the matrix in `an-artifact-that-is-never-uploaded-is-never-downloaded.test.ts`; this
    // asserts the reader row exists with the two keys that name it, so the literal below cannot drift alone.
    // **The row is asked of the planner rather than read out of the workflow** (§129): the literal used to live inside
    // the 9 KB `include:` expression, and asserting a string that no longer exists would have failed for the wrong
    // reason - while a planner that stopped producing this row would have gone unnoticed if the string were still there.
    const readerRow = planMatrix({ ensemble: 'reader' })[0]!;
    expect(readerRow).toMatchObject({ agent: 'on', remarks: 'off', ensemble: 'reader' });
    expect(readerRow['code_context']).toBe('off');
    expect(WORKFLOW).toContain('name: aacr-bench-advisory-off-off-off-on-reader-off');
  });

  it('does not let the code-window download fire on a merge dispatch, which has no such arm', () => {
    // That step's guard was "not any pair except the ones it names", and `ensemble` was not one of them - so a merge
    // dispatch would have failed at the download, **after both arms had been paid for**.
    const step = WORKFLOW.slice(WORKFLOW.indexOf('- name: Download the run with the claim check'));
    const condition = step.slice(0, step.indexOf('uses:'));
    expect(condition).toContain("(inputs.ensemble || 'off') != 'pair'");
    expect(condition).toContain("(inputs.ensemble || 'off') != 'pair-reader'");
  });
});
