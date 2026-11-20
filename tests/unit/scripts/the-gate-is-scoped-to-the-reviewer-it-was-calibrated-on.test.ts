// **Which rule decides what reaches a reader, and why the answer has now changed twice.**
//
// **First change (§23.7).** `43176459822` scored the reading arm at both operating points on the same thirty-six pull
// requests: **0.2092 with every finding it filed, 0.0523 under the registered actionability gate.** The gate kept
// twenty-four of 196 findings, eight of them true, and stopped forty-two goldens from being covered by anything. Of the
// forty-eight findings that had found a golden and were dropped anyway, **forty-three were `grounded` with both
// `quotesDiff` and `proposesChange` false** - the gate's second conjunct asks for a suggestion or a quotation of an added
// line, which is what a single-shot lane produces and not what a reader that quoted the file produces. So the gate was
// scoped to the lanes and the arm kept its own filing check.
//
// **Second change (§54).** The gate was then priced against every other cut of the same verdicts, and it lost on the
// lanes as well: on the pair `43676036390` it scores F1 0.1823 where `drop test, budget 12` scores 0.2121, with precision
// 0.2236 against 0.1735 and 148 fewer comments. **A rule that loses on both arms is not a scoping question**, so the
// shipped rule became an emission policy the product applies - one object, imported by the harness rather than restated -
// and the gate stayed in the artifact as `laneGate`, a row that keeps being measured.
//
// This file holds the source to both, because **a rule applied to the wrong reviewer, or a rule that survives the
// measurement that falsified it, is a two-line defect that no published figure can reveal.**

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'scripts', 'aacr-bench.mjs'),
  'utf8',
);

/** The body of one top-level `const NAME = ...` definition, up to the blank line this file uses between statements. */
function definition(name: string): string {
  const start = SOURCE.indexOf(`const ${name} =`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n\n', start);
  return SOURCE.slice(start, end === -1 ? SOURCE.length : end);
}

/** The per-pull-request row, where the emission rule is decided for every finding of every pull request. */
function perPullRequestRow(): string {
  const start = SOURCE.indexOf('    perPr.push({');
  expect(start).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('});', start);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('the emission rule, per reviewer', () => {
  it('applies the product\u2019s own policy rather than a rule written here', () => {
    // **`keepUnder` is where the import is called since §106**, because the harness now prices two policies - the one
    // that ships and the one it replaced - from one pool, and a second copy of this loop for the second row would be a
    // second rule that drifts one field at a time. `shippedRuleKeep` is the delegation, and it is asserted to delegate.
    const rule = definition('keepUnder');
    // **The import is the whole point.** A policy restated in the harness would let the command and the artifact disagree
    // about which twelve comments a pull request carries, and both figures would still look right.
    expect(rule).toContain('applyEmissionPolicy(');
    expect(rule).toContain('pr: pullRequest');
    // **And the path travels with the finding**, because §106's step classifies it: a policy handed no path reads every
    // finding as `other` and would price a step that never fires.
    expect(rule).toContain('path: entry.path');
    expect(definition('shippedRuleKeep')).toContain('keepUnder(SHIPPED_EMISSION_STEPS');
    // **And the arm special case is gone**, because a rule both reviewers lost to is not a rule for either; the branch
    // that shipped everything the reader filed is what made that arm's emission unbounded.
    expect(rule).not.toContain('AGENT ?');
    expect(SOURCE).toContain(
      "await import('../../packages/intelligence/dist/review/emission-policy.js')",
    );
  });

  it('keeps the lane rule as its own function, so it can be scored on findings it did not keep', () => {
    const rule = definition('laneRuleKeep');
    expect(rule).toContain('entry.score.actionable && profileKept.has(entry)');
  });

  it('writes the shipped rule into keep and the lane rule into laneGateKeep', () => {
    const row = perPullRequestRow();
    expect(row).toContain('keep: shippedKeepFlags');
    expect(row).toContain('laneGateKeep: laneRuleKeep(ranked, profileKept)');
    // **And the inline expression cannot come back**, because a rule that is written twice is a rule that will one day be
    // edited once: the row's `keep` must not mention the gate's own condition.
    expect(row).not.toContain('keep: ranked.map');
  });

  it('computes the shipped rule once, and before both rows that read it', () => {
    // **This test exists because the rule acquired a second reader**, and a second call to `shippedRuleKeep` would be a
    // second rule: the corpus's arithmetic (§46) scores the same findings the headline figures are computed over, and two
    // calls would let the two figures be about two operating points while both looked right. **The pull-request key is
    // part of the call**, because a budget counts twelve per pull request and a run-wide count is a different rule with a
    // better score.
    //
    // **And the profile is the third argument**, because a `defect` run's policy must run on what the floor left rather
    // than on everything: a policy applied to the unfiltered list would publish a point that posted the categories its own
    // profile dropped. The advisory profile removes nothing, which is why the excursion was invisible in every dispatch
    // so far and is fixed here instead of after a `defect` run had quoted a figure about two rules.
    const declared = [
      ...SOURCE.matchAll(
        /keepUnder\(SHIPPED_EMISSION_STEPS, ranked, competitorKey, profileKept\)/g,
      ),
    ];
    expect(declared).toHaveLength(1);
    const declarationAt = SOURCE.indexOf(
      'const shippedCut = keepUnder(SHIPPED_EMISSION_STEPS, ranked, competitorKey, profileKept)',
    );
    expect(declarationAt).toBeGreaterThan(-1);
    const uses = [...SOURCE.matchAll(/keep: shippedKeepFlags/g)];
    expect(uses).toHaveLength(2);
    for (const use of uses) expect(use.index).toBeGreaterThan(declarationAt);
  });

  it('scores both rules over the same findings in the artifact', () => {
    expect(SOURCE).toContain('laneGateEmission');
    const rules = SOURCE.slice(
      SOURCE.indexOf('emissionRules: {'),
      SOURCE.indexOf('fullEmission: allEmitted'),
    );
    expect(rules).toContain('shipped: {');
    // **The label is derived from the steps rather than typed beside them**, so a figure filed under it is the price of
    // the row with that label and not of a sentence this file wrote down.
    expect(rules).toContain('describeEmissionSteps(SHIPPED_EMISSION_STEPS)');
    expect(rules).toContain('point: gated');
    expect(rules).toContain('laneGate: {');
    expect(rules).toContain('point: laneGate');
  });

  it('proves the rule without a model, in the dry run the CI job runs on every push', () => {
    expect(SOURCE).toContain('assert.equal(\n    laneRule.filter(Boolean).length,\n    3,');
    // **The shipped vector is asserted on the policy, not on the arm**: six findings, none of them a test finding, and
    // six is under the budget - so a fixture that keeps all six is the policy working rather than the policy absent.
    expect(SOURCE).toContain('shipped.filter(Boolean).length,\n    ranked.length,');
    expect(SOURCE).toContain(
      "describeEmissionSteps(SHIPPED_EMISSION_STEPS),\n    'drop test, drop path test, budget 12',",
    );
    expect(SOURCE).toContain('shipped F1 ${shippedPoint.f1}');
  });
});

describe('the cap that turned out to bind', () => {
  it('is an input rather than a constant in the agent’s options', () => {
    // 25 of one run's 225 drafts were refused a slot, so **a figure from a capped run and one from an uncapped run are
    // two reviewers** - which is why the number is a coordinate of the figure and not a detail of the harness.
    const uses = SOURCE.split('maxFindingsPerFile: MAX_FINDINGS_PER_FILE,').length - 1;
    expect(uses).toBe(2);
    expect(SOURCE).not.toContain('maxFindingsPerFile: 3');
  });

  it('is validated rather than defaulted, so a typo cannot measure a different arm', () => {
    const cap = definition('MAX_FINDINGS_PER_FILE');
    expect(cap).toContain("process.env['AACR_MAX_FINDINGS_PER_FILE'] ?? '3'");
    expect(cap).toContain('Number.isInteger(parsed)');
    expect(cap).toContain('parsed < 1 || parsed > 20');
    expect(cap).toContain('throw new Error');
  });

  it('is recorded in the artifact beside the arm that produced the figure', () => {
    const configuration = SOURCE.slice(
      SOURCE.indexOf('    configuration: {'),
      SOURCE.indexOf('competitorMode: COMPETITOR_CHOICE.mode'),
    );
    expect(configuration).toContain('agent: AGENT');
    expect(configuration).toContain('maxFindingsPerFile: MAX_FINDINGS_PER_FILE');
  });

  it('is a dispatch input, so two arms differ in one line and nothing else', () => {
    const workflow = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'aacr-bench.yml'),
      'utf8',
    );
    expect(workflow).toContain('max_findings_per_file:');
    expect(workflow).toContain(
      "AACR_MAX_FINDINGS_PER_FILE: ${{ inputs.max_findings_per_file || '3' }}",
    );
  });
});
