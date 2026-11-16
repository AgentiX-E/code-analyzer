// **One device, one arm, and a harness that refuses the dispatch where the device is not there.**
//
// Two reviewers disagree in a way worth money: on `43676036390` the five lanes and the reading agent covered 198 and 171
// distinct goldens with **93 in common**, a union of 276 of 724 against 198 for either alone. The reason the second
// reviewer has never paid for itself is that it spends 1 920 comments to say what one says in 1 109 - **so the device is
// the merge, and this file holds the three ways the wiring can be wrong without any figure showing it:**
//
//   1. **The reader runs and its findings are discarded**, which is what `ENSEMBLE ? [...lanes, ...reader] : reader` looks
//      like when the ternary is written the other way round - and the arm would then be R-22 again, at R-22's score.
//   2. **The merge runs after the judge**, which costs the judge a pair for every candidate the merge was going to remove
//      and makes the arm's bill a figure about the union rather than about the merge.
//   3. **The merge is implemented twice**, once in the harness and once in the product, which is the defect §54 already
//      paid for: two cuts of one run that are not held together by an import are two tables about one run.
//
// The workflow's own invariant is checked beside them, because **every matrix row carries every key**: a row that omitted
// `ensemble` would reach the script as `undefined`, and the script's default is the reviewer every previous figure was
// measured under - a silent difference between the dispatch and the artifact.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..');
const BENCH = readFileSync(join(root, '.github', 'scripts', 'aacr-bench.mjs'), 'utf8');
const COMPARE = readFileSync(join(root, '.github', 'scripts', 'aacr-ablation-compare.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(root, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');

describe('the ensemble arm', () => {
  it('is read from the matrix, and refuses a dispatch where the second reviewer is absent', () => {
    expect(BENCH).toContain("process.env['AACR_ENSEMBLE']");
    // **The refusal is the assertion.** Without it, `AACR_ENSEMBLE=on` and `AACR_AGENT=off` writes `ensemble: true` into
    // an artifact produced by the five lanes, and the next pair is read as if the merge had been under test.
    const refusal = BENCH.slice(
      BENCH.indexOf('if (ENSEMBLE && !AGENT)'),
      BENCH.indexOf('if (ENSEMBLE && !AGENT)') + 400,
    );
    expect(refusal).toContain('process.exit(2)');
    expect(refusal).toContain('merge');
  });

  it('keeps both reviewers\u2019 findings, and only when the arm is on', () => {
    // **The fragments, not the line**, because the formatter reflows a conditional this long and a test pinned to its
    // whitespace fails for a change that moved no logic.
    expect(BENCH).toContain(
      'ENSEMBLE ? [...laneLocated, ...agentResult.findings] : agentResult.findings',
    );
    // **And the lanes are captured before the reader replaces them**, or the merge has one list to merge. The capture
    // is a named function rather than a spread since §59.5, because the flattening was where each finding lost the lane
    // that produced it - so the assertion is the call, and the attribution is asserted where it is computed.
    expect(BENCH).toContain('const laneLocated = locateLaneFindings(lanes)');
  });

  it('runs the lanes under the merge, because a merge of one list and nothing is a sort', () => {
    // **R-29's own defect, as a wiring assertion.** The registration named a merge of the five lanes and the reading
    // reviewer; the lanes were emptied whenever the agent ran, so the arm merged the reader with nothing and the artifact
    // could not say so. The condition below is the fix, and it is asserted here because **no figure in that run could
    // have shown it**: 0.2504 is a plausible score for both devices.
    // **Except for the one-sided merge, which is defined as one list** (§58): `ensemble: reader` is the arm R-29
    // measured by accident, and emptying the lanes is what that device *is* rather than a defect in it.
    expect(BENCH).toContain('const lanesRun = !AGENT || (ENSEMBLE && !ENSEMBLE_READER_ONLY);');
    expect(BENCH).toContain('for (const section of lanesRun ? sections : [])');
    // **And what the merge received is published**, so the next reader can tell a union from a single list.
    expect(BENCH).toContain('mergeCounters.sides.lanes += merged.sides.lanes;');
    expect(BENCH).toContain('mergeCounters.unionPulls += 1;');
  });

  it('names the merge arm in the artifact it uploads, because a pair matches on names', () => {
    // **Two devices publishing one artifact name** is how a paired comparison comes to compare an arm with itself: the
    // merge run uploaded `...-adjudicate-off-idioms-off-agent-on-remarks-off`, which is the name an agent-only run uses.
    expect(WORKFLOW).toContain('${{ matrix.ensemble }}-${{ matrix.remarks }}');
    // And the pair that dispatches both configurations over the same rows, so the difference is the merge alone.
    expect(WORKFLOW).toContain("(inputs.ensemble || 'off') == 'pair'");
  });

  it('merges after ranking and before judging, because the judge is the half that costs money', () => {
    const merge = BENCH.indexOf('await mergeReviewers({');
    expect(merge, 'the merge is called').toBeGreaterThan(-1);
    const rank = BENCH.lastIndexOf('rankFindings(located, prFacts)', merge);
    const judge = BENCH.indexOf('const ourMatrix = await judgeMatrix(', merge);
    expect(rank).toBeGreaterThan(-1);
    expect(judge).toBeGreaterThan(merge);
  });

  it('imports the product\u2019s merge rather than restating it', () => {
    expect(BENCH).toContain(
      "await import('../../packages/intelligence/dist/review/merge-reviewers.js')",
    );
    // **One budget, imported**, so a harness that cut at eight and a command that cut at twelve could not both be right.
    expect(BENCH).toContain('MERGE_BUDGET_PER_PULL_REQUEST');
  });

  it('records which path decided each pull request\u2019s merge, so a fallback is visible in the artifact', () => {
    expect(BENCH).toContain('mergeCounters.paths[merged.decidedBy] += 1;');
    expect(BENCH).toContain('mergeCounters.fallbackReasons.push(');
    expect(BENCH).toContain('merge: mergeCounters,');
  });

  it('carries the key on every matrix row and passes it through', () => {
    const matrix = WORKFLOW.slice(WORKFLOW.indexOf('matrix:'), WORKFLOW.indexOf('steps:'));
    const rows = matrix.match(/\{&quot;|\{"profile"/gu) ?? [];
    const keys = matrix.match(/"ensemble":"(?:on|off|reader)"/gu) ?? [];
    expect(rows.length, 'the matrix has rows').toBeGreaterThan(0);
    // **One `ensemble` per row.** A row that omitted it would be dispatched with the script's default while the matrix
    // recorded nothing, which is the arrangement where the artifact and the dispatch can disagree.
    expect(keys.length).toBe(rows.length);
    expect(WORKFLOW).toContain('AACR_ENSEMBLE: ${{ matrix.ensemble }}');
    expect(WORKFLOW).toContain('ensemble:');
    expect(WORKFLOW).toContain("default: 'off'");
  });

  it('registers the claim, and treats the reader as the key the merge entails', () => {
    expect(COMPARE).toContain('§56 (R-29)');
    expect(COMPARE).toContain('registeredGain: 0.02');
    const entailment = COMPARE.slice(
      COMPARE.indexOf('  ensemble: ['),
      COMPARE.indexOf('  ensemble: [') + 400,
    );
    expect(entailment).toContain("key: 'agent'");
    expect(entailment).toContain("key: 'codeContext'");
  });
});
