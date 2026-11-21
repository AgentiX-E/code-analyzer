// @code-analyzer/code-analyzer — the configuration the product ships is the configuration a promotion wrote
//
// **The failure this file exists to make impossible.** `DEFAULT_PULL_REQUEST_BUDGET` lived in the engine as `12`,
// `DEFAULT_PR_BUDGET` lived in the benchmark script as `12`, and a test compared the two by regular expression. That
// test would have accepted `const DEFAULT_PR_BUDGET = compute();`; it could not see a third copy in a workflow input's
// `default:`; and it said nothing at all about the six other switches whose harness default was a literal `'off'`.
// **Two places that must agree and cannot see each other is how a measured device fails to reach the product**, which
// is the defect this whole mechanism is a repair of.
//
// **So there is one place now**, `packages/intelligence/config/review-defaults.json`, and this file asserts all four
// links of the chain: the JSON is valid, the module the engine compiles is exactly what the JSON renders, the engine's
// exported default is the JSON's value, and the harness's arm falls back to the same values. **A hand edit to any one
// of them is a red build rather than a slow divergence.**

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULTS_PATH,
  KNOB_NAMES,
  RULE_PATH,
  readPromotionRule,
  readReviewDefaults,
  renderDefaultsModule,
  validateDefaults,
} from '../../../.github/scripts/lib/review-defaults.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the shipped reviewer configuration', () => {
  it('is one file, and every knob in it is a knob a reader reads', () => {
    const defaults = readReviewDefaults();

    expect(Object.keys(defaults.knobs).sort()).toEqual([...KNOB_NAMES].sort());
    // **A missing knob is the failure that reads as a working default**: the engine would fall back to a number nobody
    // wrote down, and the promotion record would describe a configuration the product does not run.
    expect(validateDefaults(defaults)).toEqual([]);
    expect(() =>
      validateDefaults({ ...defaults, knobs: { ...defaults.knobs, mystery: 1 } }),
    ).not.toThrow();
    expect(validateDefaults({ ...defaults, knobs: { ...defaults.knobs, mystery: 1 } })).toContain(
      'knobs.mystery is not a knob any reader reads',
    );
  });

  it('names the experiment, the date and the decision that produced it', () => {
    const { provenance } = readReviewDefaults() as unknown as {
      provenance: { decision: string; resolvedBy: string; resolvedAt: string };
    };

    // **A configuration whose origin is not on disk is a configuration nobody can defend**, and a figure that cites it
    // is a figure about an unnamed reviewer.
    expect(['held', 'promoted']).toContain(provenance.decision);
    expect(provenance.resolvedBy).toBe('aacr-promote.mjs');
    expect(provenance.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it('renders to exactly the module the engine compiles', () => {
    // **The drift, closed.** The module is committed so a reader sees the numbers without a build; this assertion is
    // what stops the committed copy from being a copy.
    const rendered = renderDefaultsModule(readReviewDefaults());

    expect(read('packages/intelligence/src/review/llm/review-defaults.generated.ts')).toBe(
      rendered,
    );
  });

  it('passes its own drift check as a command, because CI runs the command and not this test', () => {
    // A test asserting on a function CI never calls is a test about the test. The workflow runs `--check`, so the
    // command has to be the thing that is green.
    const output = execFileSync(
      process.execPath,
      [join(ROOT, '.github/scripts/aacr-review-defaults-codegen.mjs'), '--check'],
      { encoding: 'utf8' },
    );

    expect(output).toContain('the committed module is what the JSON renders');
  });

  it('is the number the engine exports and the number the harness falls back to', () => {
    const defaults = readReviewDefaults();
    const engine = read('packages/intelligence/src/review/llm/llm-review-engine.ts');
    const bench = read('.github/scripts/aacr-bench.mjs');

    // The engine reads the generated module; it must not also carry the literal, or there would be two answers again.
    expect(engine).toContain(
      'export const DEFAULT_PULL_REQUEST_BUDGET: number = REVIEW_DEFAULTS.knobs.maxFindingsPerPullRequest;',
    );
    expect(engine).not.toMatch(/export const DEFAULT_PULL_REQUEST_BUDGET = \d+;/u);

    // The harness reads the same file rather than naming its own copy.
    expect(bench).toContain('const DEFAULT_PR_BUDGET = SHIPPED.knobs.maxFindingsPerPullRequest;');
    expect(bench).toContain('const SHIPPED = readReviewDefaults();');
    expect(defaults.knobs['maxFindingsPerPullRequest']).toBe(12);
  });

  it('is the default of every switch, so an unset variable measures the shipped reviewer', () => {
    // **This is the assertion the six `?? 'off'` literals could never make.** Each of these switches had a harness
    // default written by hand, and one of them (`AACR_CHECKLIST`) disagreed with the engine's own default for two
    // releases - a harness measuring a configuration nobody ships is exactly the cost.
    const bench = read('.github/scripts/aacr-bench.mjs');

    for (const [variable, knob] of [
      ['AACR_CHECKLIST', 'languageChecklist'],
      ['AACR_CODE_CONTEXT', 'codeContext'],
      ['AACR_ADJUDICATE', 'adjudicate'],
      ['AACR_REMARKS', 'remarks'],
      ['AACR_SECOND_CONCERN', 'secondConcern'],
    ] as const) {
      expect(bench, `${variable} no longer falls back to the shipped ${knob}`).toContain(
        `process.env['${variable}'] ?? onOff(SHIPPED.knobs.${knob})`,
      );
    }
    expect(bench).toContain(
      "process.env['AACR_SAME_SITE_CONCERNS'] ?? SHIPPED.knobs.sameSiteConcerns",
    );
    // And no switch keeps a second literal default beside it.
    expect(bench).not.toContain("process.env['AACR_REMARKS'] ?? 'off'");
  });
});

describe('the evidence the shipped budget rests on', () => {
  it('is twelve, and the replay that measured it is on disk', () => {
    // **Carried over from `the-budget-the-benchmark-runs-is-the-budget-the-engine-ships.test.ts`**, which compared two
    // literals by regular expression and is now superseded by the chain above. The assertion that survives is the one
    // that was never about punctuation: the number is a measurement, so the file it was measured from has to be present
    // - a future edit that changes the knob without a replay would otherwise leave no trace of where twelve came from.
    const replay = JSON.parse(read('benchmarks/r41b-witness.json')) as {
      budgetCurves: Record<string, { f1: number }>;
    };
    const at = (n: number) => replay.budgetCurves[`score@${String(n)}`]!.f1;

    expect(readReviewDefaults().knobs['maxFindingsPerPullRequest']).toBe(12);
    expect(at(12)).toBeGreaterThanOrEqual(at(8));
    expect(at(12)).toBeGreaterThan(at(16));
  });
});

describe('the promotion rule', () => {
  it('is a file, versioned, and its bar is the instrument resolution rather than a preference', () => {
    const rule = readPromotionRule() as {
      version: number;
      metric: string;
      minimumDelta: number;
      requirePaired: boolean;
      guards: { precision: number; recall: number };
    };

    // **0.0281 is the resolution measured in §129**, not a round number somebody liked: R-64 and R-67 return +0.0108
    // and +0.0105 on same-class configurations, both inside it. A rule that promoted below it would be promoting the
    // noise trade this number exists to refuse.
    expect(rule.minimumDelta).toBe(0.0281);
    // **The metric is the arm the product runs.** `reviewPullRequest` is what the editor and the GitHub app call, so a
    // promotion judged on the file arm's F1 would be a promotion to a reviewer nobody ships.
    expect(rule.metric).toBe('pullRequestArm.f1');
    // **Paired or not at all**: two arms scored on the same goldens are paired data, and an unpaired difference is two
    // marginal totals with a story attached.
    expect(rule.requirePaired).toBe(true);
    expect(rule.guards.precision).toBeGreaterThan(0);
    expect(rule.guards.recall).toBeGreaterThan(0);
    expect(rule.version).toBeGreaterThanOrEqual(1);
  });

  it('is on disk where the promoter reads it, not inlined in the script', () => {
    // A rule in a script is a rule a script can quietly weaken; a rule in a file is reviewed like code.
    const rule = read(RULE_PATH.slice(ROOT.length + 1));

    expect(rule).toContain('"minimumDelta": 0.0281');
    expect(read('.github/scripts/aacr-promote.mjs')).toContain('readPromotionRule()');
    expect(read('.github/scripts/aacr-promote.mjs')).not.toContain('const MINIMUM_DELTA');
  });

  it('reads from a path that exists, or the whole mechanism is a comment', () => {
    expect(() => readReviewDefaults(DEFAULTS_PATH)).not.toThrow();
  });
});
