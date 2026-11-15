/**
 * **The point the product ships is a row of the table that prices it, and the two implementations of the cut agree.**
 *
 * §54 of `docs/EVAL-CONTRACT.md` prices twenty-three cuts of one paid run's verdicts and finds the published point
 * (F1 0.1823) dominated by one this repository had never shipped (`drop test, budget 12`: F1 0.2121, precision 0.2236,
 * 148 fewer comments). Moving that cut into the product created exactly the failure this repository has already paid for
 * twice: **two implementations of one cut, one read by the command that posts comments and one by the harness that
 * measures them.** They agree today. The test is what makes them agree tomorrow.
 *
 * Three properties, each a way the shipped figure could stop describing the product:
 *
 * - **the label** the command prints and the row the table prints are one string, so a figure filed under the label is
 *   the price of that row;
 * - **the kept sets are equal**, on a fixture with ties, an empty pull-request key and a category the drop removes;
 * - **the table's own row for that label scores what this policy's output scores**, so the 0.2121 attached to the label
 *   is the 0.2121 of the twelve comments per pull request this policy actually keeps.
 */
import { describe, expect, it } from 'vitest';

import {
  SHIPPED_EMISSION_STEPS,
  applyEmissionPolicy,
  describeEmissionSteps,
} from '../../../packages/intelligence/src/review/emission-policy.js';
import {
  applyCut,
  describeCut,
  operatingPointTable,
  score,
} from '../../../scripts/lib/operating-point.mjs';

const creditOf = (finding: { matchedGoldens?: readonly number[] }) => finding.matchedGoldens ?? [];

/** Two pull requests, one of them with a test finding at the top of its ranking and one without. */
function artifact() {
  const finding = (pr: string, at: number, matchedGoldens: number[], category = 'bug') => ({
    pr,
    filePath: 'a.ts',
    startLine: at,
    endLine: at,
    category,
    score: 100 - at,
    actionable: true,
    matchedGoldens,
  });
  const numbered = (pr: string, category: string, count: number, first: number) =>
    Array.from({ length: count }, (_, at) =>
      finding(pr, first + at, at === 0 ? [at % 2] : [], category),
    );
  const findings = [
    ...numbered('o/r#1', 'bug', 9, 0),
    ...numbered('o/r#1', 'test', 6, 20),
    ...numbered('o/r#2', 'bug', 4, 40),
    ...numbered('o/r#2', 'architecture', 3, 50),
  ];
  return { rankedFindings: findings, truePositives: 3, falseNegatives: 5 };
}

describe('the shipped emission policy and the table', () => {
  it('prints the same label as the cut it is', () => {
    expect(describeEmissionSteps(SHIPPED_EMISSION_STEPS)).toBe(describeCut(SHIPPED_EMISSION_STEPS));
    // **And the row exists**, so the label is not a sentence this file invented: a table without it means the shipped
    // point is priced by nothing.
    const table = operatingPointTable(artifact().rankedFindings, 8);
    expect(table.map((row: { cut: string }) => row.cut)).toContain(
      describeEmissionSteps(SHIPPED_EMISSION_STEPS),
    );
  });

  it('keeps exactly the findings the harness keeps', () => {
    const findings = artifact().rankedFindings;
    const product = applyEmissionPolicy(findings).kept.map(
      (entry) => `${entry.pr}:${String(entry.startLine)}`,
    );
    const harness = applyCut(findings, SHIPPED_EMISSION_STEPS).map(
      (entry: { pr?: string; startLine?: number }) => `${String(entry.pr)}:${String(entry.startLine)}`,
    );
    // **Order too**, because a budget that kept the same set in a different order is a reviewer whose comments arrive
    // in a different order on the two sides.
    expect(product).toEqual(harness);
  });

  it('scores what the table prices that row at', () => {
    const findings = artifact().rankedFindings;
    const kept = applyEmissionPolicy(findings).kept;
    const row = operatingPointTable(findings, 8).find(
      (entry: { cut: string }) => entry.cut === describeEmissionSteps(SHIPPED_EMISSION_STEPS),
    );
    if (row === undefined) throw new Error('the shipped policy is not a row of the table');
    const fromPolicy = score(kept, creditOf, 8);
    expect(row.f1).toBeCloseTo(fromPolicy.f1, 10);
    expect(row.truePositives).toBe(fromPolicy.truePositives);
    expect(row.emitted).toBe(fromPolicy.emitted);
  });

  it('agrees with the harness on a pull request with no key and on a tie', () => {
    // The command reviews one pull request and its findings carry no key; the harness always has one. Both must keep
    // twelve of the same fifteen, and the same twelve when three of them are tied.
    const unkeyed = Array.from({ length: 15 }, (_, at) => ({
      startLine: at,
      category: at < 3 ? 'test' : 'bug',
      score: at < 3 ? 99 : 5,
    }));
    const product = applyEmissionPolicy(unkeyed).kept.map((entry) => entry.startLine);
    const harness = applyCut(unkeyed, SHIPPED_EMISSION_STEPS).map(
      (entry: { startLine?: number }) => entry.startLine,
    );
    expect(product).toEqual(harness);
    expect(product).toHaveLength(12);
    expect(product).not.toContain(0);
  });
});
