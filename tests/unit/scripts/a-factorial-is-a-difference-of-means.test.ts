// @code-analyzer/code-analyzer — a factorial is a difference of two means, and this file checks that it is
//
// **The measurement that forced this file.** Three iterations (R-64, R-67, and the pair registrations before them) priced
// one device each, by subtraction, and every registered gain came back smaller than the instrument's own resolution. The
// question they could not ask is whether two devices help each other, and **that question has no pair to subtract**: in a
// `2^k` design no two arms differ in one key, so every pair `variedField` would accept is a pair the design does not have.
//
// So the analysis is a difference of means, and this file holds the three things that make such a number readable:
// **balance** (the means must be equal-sized), **completeness** (a `2^k` minus three arms is not a `2^k`), and
// **the naming of the question** (best F1, best precision and best F1 per dollar are different questions, and an arm
// that wins all three is the only one that needs no trade-off argument).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  analyseGrid,
  factorsOf,
  mainEffect,
  selfTest,
} from '../../../.github/scripts/aacr-grid-compare.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** One arm of a synthetic grid, with a figure chosen so the arithmetic can be checked by hand. */
const arm = (label: string, configuration: Record<string, unknown>, f1: number, extra = {}) => ({
  label,
  configuration,
  f1,
  precision: f1 / 2,
  recall: f1 * 2,
  truePositives: Math.round(f1 * 100),
  falsePositives: Math.round(f1 * 300),
  spend: { totalCacheNeutralUsd: 1 },
  ...extra,
});

describe('the factors are read from the arms, not listed here', () => {
  it('finds the one key that differs, and ignores the nine that do not', () => {
    const arms = [
      arm('a', { codeContext: false, adjudicate: 'off', laneSet: 'shipped' }, 0.2),
      arm('b', { codeContext: true, adjudicate: 'off', laneSet: 'shipped' }, 0.3),
    ];
    expect(factorsOf(arms)).toEqual([{ key: 'codeContext', levels: ['false', 'true'] }]);
  });

  it('unwraps a device written as an object rather than stringifying it', () => {
    // **`{enabled: false, families: [...]}` is how most of this repository's devices are written.** Stringifying it
    // would make two runs of the same device differ by a field neither consulted, and the factor would appear to have
    // three levels where it has two.
    const arms = [
      arm('a', { remarks: { enabled: false, families: ['naming'] } }, 0.2),
      arm('b', { remarks: { enabled: true, families: ['naming'] } }, 0.3),
    ];
    expect(factorsOf(arms)[0]?.levels).toEqual(['false', 'true']);
  });

  it('finds nothing when every arm is the same configuration, which is a replicate and not a grid', () => {
    const arms = [arm('a', { codeContext: false }, 0.2), arm('b', { codeContext: false }, 0.2)];
    expect(factorsOf(arms)).toEqual([]);
    expect(analyseGrid(arms).kind).toBe('replicates');
  });
});

describe('a main effect is a difference of two means', () => {
  const arms = [
    arm('off/off', { codeContext: false, remarks: false }, 0.2),
    arm('off/on', { codeContext: false, remarks: true }, 0.24),
    arm('on/off', { codeContext: true, remarks: false }, 0.3),
    arm('on/on', { codeContext: true, remarks: true }, 0.34),
  ];

  it('recovers the effect that was built into the figures', () => {
    // **The arithmetic is constructed so the answer is known**: `codeContext` adds 0.10 to every arm and `remarks` adds
    // 0.04, with no interaction. A main effect that did not return those two numbers would be measuring the arm order.
    const report = analyseGrid(arms);
    const code = report.factors.find((f) => f.key === 'codeContext')!;
    const remarks = report.factors.find((f) => f.key === 'remarks')!;
    expect(code.effect['f1']).toBeCloseTo(0.1, 10);
    expect(remarks.effect['f1']).toBeCloseTo(0.04, 10);
  });

  it('reports balance, because an unbalanced set turns an effect into a confound', () => {
    expect(analyseGrid(arms).factors.every((f) => f.balance.balanced)).toBe(true);
    expect(
      mainEffect(arms, { key: 'codeContext', levels: ['false', 'true'] }).balance.sizes,
    ).toEqual([2, 2]);
  });

  it('names the direction of the effect rather than leaving a sign without one', () => {
    // **`from` and `to` are the levels in first-seen order**, so a reader knows which way `+0.10` points without opening
    // the arms. A sign without a direction is what makes two reports of one device disagree.
    const effect = mainEffect(arms, { key: 'codeContext', levels: ['false', 'true'] });
    expect(effect.effect['from']).toBe('false');
    expect(effect.effect['to']).toBe('true');
  });
});

describe('a pile of arms is not a factorial', () => {
  it('refuses to call two arms over two factors a grid', () => {
    // **This is the shape three iterations actually ran**: one dispatch, two arms, two keys moving together. Reading it
    // as a grid would print the same effect twice and call it two findings.
    const arms = [
      arm('a', { codeContext: false, remarks: false }, 0.2),
      arm('b', { codeContext: true, remarks: true }, 0.34),
    ];
    const report = analyseGrid(arms);
    expect(report.kind).toBe('incomplete');
    expect(report.design).toEqual({ factors: 2, expectedArms: 4, readArms: 2, complete: false });
    // **And the two effects are the same number**, which is the evidence for the verdict rather than an assertion of it.
    expect(report.factors[0]?.effect['f1']).toBe(report.factors[1]?.effect['f1']);
  });

  it('accepts the full four, and calls it a grid', () => {
    const arms = [
      arm('a', { codeContext: false, remarks: false }, 0.2),
      arm('b', { codeContext: false, remarks: true }, 0.24),
      arm('c', { codeContext: true, remarks: false }, 0.3),
      arm('d', { codeContext: true, remarks: true }, 0.34),
    ];
    expect(analyseGrid(arms).kind).toBe('grid');
  });

  it('calls one arm single rather than a factorial of zero factors', () => {
    expect(analyseGrid([arm('a', { codeContext: false }, 0.2)]).kind).toBe('single');
  });
});

describe('the best arm depends on the question, and the report says so', () => {
  it('separates the arm with the most from the arm worth buying', () => {
    // **An arm that wins every question needs no argument**, and the one that does not is the case a report must not
    // paper over: here the loudest arm costs nothing and the one with the best precision is not the cheapest.
    const arms = [
      {
        ...arm('loud', { codeContext: true }, 0.3),
        precision: 0.1,
        spend: { totalCacheNeutralUsd: 1 },
      },
      {
        ...arm('sharp', { codeContext: false }, 0.2),
        precision: 0.5,
        spend: { totalCacheNeutralUsd: 1 },
      },
      {
        ...arm('cheap', { codeContext: false }, 0.21),
        precision: 0.2,
        spend: { totalCacheNeutralUsd: 0.5 },
      },
    ];
    // Three arms over one binary factor is still incomplete, but the *questions* do not depend on the design.
    const report = analyseGrid(arms);
    expect(report.best.byF1?.label).toBe('loud');
    expect(report.best.byPrecision?.label).toBe('sharp');
    expect(report.best.byEfficiency?.label).toBe('cheap');
    expect(report.consensus).toBeNull();
  });

  it('names a consensus when one arm wins all three, because that is the arm to dispatch again', () => {
    const arms = [
      {
        ...arm('winner', { codeContext: true }, 0.4),
        precision: 0.6,
        spend: { totalCacheNeutralUsd: 0.5 },
      },
      {
        ...arm('loser', { codeContext: false }, 0.2),
        precision: 0.3,
        spend: { totalCacheNeutralUsd: 1 },
      },
    ];
    expect(analyseGrid(arms).consensus).toBe('winner');
  });

  it('reports no best arm rather than inventing one when the artifacts carry no figure', () => {
    const arms = [
      { label: 'a', configuration: { codeContext: false } },
      { label: 'b', configuration: { codeContext: true } },
    ];
    const report = analyseGrid(arms);
    expect(report.best.byF1).toBeNull();
    expect(report.best.byEfficiency).toBeNull();
    // **`k` is still counted**, because zero findings is a measurement and a missing F1 is not.
    expect(report.rows.every((row) => row.k === 0)).toBe(true);
  });
});

describe('the job proves the arithmetic before it prints an answer', () => {
  it('self-tests on a grid whose effects were known, and refuses a pile of arms', () => {
    // **The self-test is the same function the job runs**, so a fixture that stopped exercising the refusal would fail
    // here as well as in the workflow - rather than in the run whose report nobody reads.
    expect(selfTest()).toContain('assertions hold');
  });

  it('is wired into the job that prints the report, and the report is uploaded', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'aacr-bench.yml'), 'utf8');
    expect(workflow).toContain('node .github/scripts/aacr-grid-compare.mjs --self-test');
    // **A job whose report is never uploaded is a job whose figure lives in a log line**, which is the §58.1 shape: the
    // artifact is the thing a later iteration can re-read.
    expect(workflow).toContain('name: aacr-grid-report');
    expect(workflow).toMatch(
      /grid-compare:[\s\S]{0,400}?if: \(inputs\.window \|\| 'off'\) == 'grid'/u,
    );
  });
});
