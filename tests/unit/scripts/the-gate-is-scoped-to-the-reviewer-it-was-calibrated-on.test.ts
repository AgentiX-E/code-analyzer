// **A gate calibrated on one reviewer was being applied to another, and the artifact could have said so.**
//
// `43176459822` scored the reading arm at both operating points on the same thirty-six pull requests: **0.2092 with
// every finding it filed, 0.0523 under the registered actionability gate.** The gate kept twenty-four of 196 findings,
// eight of them true, and stopped forty-two goldens from being covered by anything. The artifact's own `rankedFindings`
// says why it was not a threshold problem: of the forty-eight findings that had found a golden and were dropped anyway,
// **forty-three were `grounded` with both `quotesDiff` and `proposesChange` false** - the gate's second conjunct asks for
// a suggestion or a quotation of an added line, which is what a single-shot lane produces and not what a reader that
// quoted the file produces. Every rule the artifact supports was then scored offline against the same judge verdicts, and
// **none beat emitting everything.**
//
// `docs/EVAL-CONTRACT.md` §23.7 registers the consequence: the gate is scoped to the lanes, the arm's emission rule is its
// own filing check, **and the lane rule is still scored beside it** so a scoping decision keeps being measured instead of
// remembered. This file holds the source to that, because a rule that is applied to two reviewers is a two-line defect
// that no figure can reveal once it has been published.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '.github', 'scripts', 'aacr-bench.mjs'),
  'utf8',
);

/** The body of one `const NAME = ...` definition, up to the terminator this file uses between top-level statements. */
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
  it('ships everything the reading arm filed and nothing the lanes did not pass', () => {
    const rule = definition('shippedRuleKeep');
    expect(rule).toContain('AGENT ? entries.map(() => true) : laneRuleKeep(entries, profileKept)');
    // **The arm's half is `true` for every entry**, because its filing check - the quoted code located in the file at the
    // reviewed commit - already refused 29 of 225 drafts, and **a second filter over the survivors is what §23.7 removed.**
    expect(rule).toContain('entries.map(() => true)');
  });

  it('keeps the lane rule as its own function, so it can be scored on findings it did not keep', () => {
    const rule = definition('laneRuleKeep');
    expect(rule).toContain('entry.score.actionable && profileKept.has(entry)');
  });

  it('writes the shipped rule into keep and the lane rule into laneGateKeep', () => {
    const row = perPullRequestRow();
    expect(row).toContain('keep: shippedRuleKeep(ranked, profileKept)');
    expect(row).toContain('laneGateKeep: laneRuleKeep(ranked, profileKept)');
    // **And the inline expression cannot come back**, because a rule that is written twice is a rule that will one day be
    // edited once: the row's `keep` must not mention the gate's own condition.
    expect(row).not.toContain('keep: ranked.map');
  });

  it('scores both rules over the same findings in the artifact', () => {
    expect(SOURCE).toContain('laneGateEmission');
    const rules = SOURCE.slice(
      SOURCE.indexOf('emissionRules: {'),
      SOURCE.indexOf('fullEmission: allEmitted'),
    );
    expect(rules).toContain('shipped: {');
    expect(rules).toContain('laneGate: {');
    expect(rules).toContain('point: gated');
    expect(rules).toContain('point: laneGate');
  });

  it('says in the artifact which rule and which reviewer produced the figure', () => {
    expect(SOURCE).toContain('the reading arm files only what it can locate');
    expect(SOURCE).toContain("emissionRule: AGENT\n        ? `the reading arm's own filing rule");
  });

  it('proves the split without a model, in the dry run the CI job runs on every push', () => {
    expect(SOURCE).toContain('assert.equal(\n    laneRule.filter(Boolean).length,\n    3,');
    expect(SOURCE).toContain('AGENT ? ranked.length : 3');
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
