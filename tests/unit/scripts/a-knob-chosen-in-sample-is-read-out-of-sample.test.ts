/**
 * **A knob chosen by reading a table has to be read again on a row it was not chosen on.**
 *
 * `registeredCuts` offers twenty-three cuts of one paid run's verdicts, and the campaign has published the best of them
 * twice. `drop test` was not chosen that way - it came from an argument and was registered before its run - but *which
 * category to remove next*, and *how large a per-pull-request cap to allow*, are choices a table invites. **A table is a
 * fitting procedure whether or not anybody calls it one**, and a fitted choice read only in sample is a number that will
 * not survive the next corpus.
 *
 * So the audit in `scripts/lib/selection-audit.mjs` leaves one pull request out at a time, chooses the knob on the other
 * forty-nine, and applies the choice to the one held out. Three properties are what make its answer worth reading:
 *
 * - **a corpus with no signal produces no gain, exactly** - not "a small gain", because a procedure that cannot decline
 *   prints a number for every corpus it is pointed at, including one where the categories are indistinguishable;
 * - **a corpus with a real signal is recovered out of sample**, or the audit is measuring its own pessimism rather than
 *   the corpus;
 * - **it prices selection among sentences a run paid for** and cannot invent one, so its emitted count can never exceed
 *   the artifact's pool.
 */
import { describe, expect, it } from 'vitest';

import {
  auditBudgets,
  auditCategories,
  emittedCategories,
  verdictOf,
} from '../../../scripts/lib/selection-audit.mjs';
import { score, type EmittedFinding } from '../../../scripts/lib/operating-point.mjs';

/**
 * **A row of the artifact this audit reads, taken from the artifact's own type rather than restated here**: the audit is
 * only as good as its agreement with the reader that produced these fields, and a fixture that declared its own shape
 * could pass while disagreeing with every real artifact.
 */
type Row = EmittedFinding & {
  readonly pr: string;
  readonly startLine: number;
  readonly category: string;
};

/** One pull request's worth of rows: `hits` of them carry a golden, the rest are noise in `noiseCategory`. */
function pullRequest(
  pr: number,
  {
    hits,
    noise,
    noiseCategory = 'architecture',
  }: { hits: number; noise: number; noiseCategory?: string },
): Row[] {
  const rows: Row[] = [];
  const push = (category: string, at: number, matched: boolean): void => {
    rows.push({
      pr: `pr-${pr}`,
      path: 'src/a.ts',
      startLine: 1 + rows.length * 10,
      category,
      score: 1 - at * 0.01,
      matchedGoldens: matched ? [pr * 100 + rows.length] : [],
    });
  };
  for (let at = 0; at < hits; at += 1) push('bug', at, true);
  for (let at = 0; at < noise; at += 1) push(noiseCategory, hits + at, false);
  return rows;
}

const creditOf = (finding: EmittedFinding): readonly number[] => finding.matchedGoldens ?? [];
const goldensOf = (findings: readonly Row[]): number =>
  new Set(findings.flatMap((finding) => [...creditOf(finding)])).size;

function corpus(
  count: number,
  shape: { hits: number; noise: number; noiseCategory?: string },
): Row[] {
  return Array.from({ length: count }, (_, at) => pullRequest(at, shape)).flat();
}

describe('a knob read in sample and out of sample', () => {
  it('finds no gain, exactly, when the categories are indistinguishable', () => {
    // **Ten pull requests, every row the same shape**: no category is noise, so no removal can pay. The procedure must
    // return the shipped cut untouched rather than a fitted improvement, and `''` is a candidate precisely so that
    // "remove nothing" is reachable - a procedure that cannot decline cannot be falsified.
    const findings = corpus(10, { hits: 2, noise: 2, noiseCategory: 'bug' });
    const goldens = goldensOf(findings);
    const shipped = score(findings, creditOf, goldens);
    const audited = auditCategories(findings, creditOf, goldens, []);

    expect(audited.heldOut.emitted).toBe(shipped.emitted);
    expect(audited.heldOut.f1).toBeCloseTo(shipped.f1, 10);
    expect([...audited.choices.keys()]).toEqual(['']);
    // **And the in-sample column agrees**, which is the audit's own consistency check: a tie cannot produce a winner.
    const best = [...audited.inSample].sort((left, right) => right.point.f1 - left.point.f1)[0];
    expect(best?.category).toBe('');
  });

  it('recovers a category that is pure noise, out of sample', () => {
    // **The signal is real and it is large**: one category never holds a golden, so a procedure that removes it should
    // beat the shipped cut on rows it did not train on. If it cannot, the audit is measuring itself.
    const findings = corpus(12, { hits: 2, noise: 4, noiseCategory: 'architecture' });
    const goldens = goldensOf(findings);
    const shipped = score(findings, creditOf, goldens);
    const audited = auditCategories(findings, creditOf, goldens, []);

    expect(audited.choices.get('architecture')).toBe(12);
    expect(audited.heldOut.f1).toBeGreaterThan(shipped.f1);
    // Precision is where the gain is: the removed rows were never goldens.
    expect(audited.heldOut.precision).toBeGreaterThan(shipped.precision);
    // **And no golden leaves with them**, because none was there.
    expect(audited.heldOut.truePositives).toBe(shipped.truePositives);
  });

  it("finds nothing when each pull request's noise lives in a category of its own", () => {
    // **The case that separates a held-out reading from a leaked one.** Each pull request puts its noise in a category no
    // other pull request uses, so dropping "the noisiest category" is only informative about the pull request it was
    // learned on. A procedure that trained on all rows would report a gain here; one that holds the row out cannot,
    // because the category it would choose has no rows on the row it is deciding about.
    const findings = Array.from({ length: 12 }, (_, pr) =>
      pullRequest(pr, { hits: 2, noise: 3, noiseCategory: `noise-${pr}` }),
    ).flat();
    const goldens = goldensOf(findings);
    const shipped = score(findings, creditOf, goldens);
    const audited = auditCategories(findings, creditOf, goldens, []);

    expect(audited.heldOut.f1).toBeCloseTo(shipped.f1, 10);
    expect(audited.heldOut.emitted).toBe(shipped.emitted);
  });

  it('never emits a row the artifact did not carry', () => {
    const findings = corpus(8, { hits: 3, noise: 6 });
    const goldens = goldensOf(findings);
    const audited = auditCategories(findings, creditOf, goldens, []);
    const budgets = auditBudgets(findings, creditOf, goldens, [], [1, 2, 4, 16]);
    expect(audited.heldOut.emitted).toBeLessThanOrEqual(findings.length);
    expect(budgets.heldOut.emitted).toBeLessThanOrEqual(findings.length);
  });

  it('reports a cap as a policy when F1 is still rising at it', () => {
    // **The budget half answers a different question**: not which category is noise, but whether the shipped cap is a
    // measured optimum or a policy. Here every row is a golden, so a larger cap is strictly better and the audit must
    // say so by choosing the largest one on held-out rows.
    const findings = Array.from({ length: 10 }, (_, pr) =>
      pullRequest(pr, { hits: 4, noise: 0 }),
    ).flat();
    const goldens = goldensOf(findings);
    const audited = auditBudgets(findings, creditOf, goldens, [], [1, 2, 3, 4]);
    expect(audited.choices.get(4)).toBe(10);
    expect(audited.heldOut.f1).toBeGreaterThan(score(findings, creditOf, goldens).f1 * 0.99);
  });

  it("will not call a gain a gain inside the campaign's own noise band", () => {
    // **A delta below two per cent of the published F1 is not a delta**: §106.7 measured two runs of one configuration
    // 1.9 % apart, so a procedure that returns the shipped cut unchanged must be reported as unearned rather than as a
    // zero-gain success.
    const shipped = {
      emitted: 300,
      truePositives: 80,
      falsePositives: 220,
      falseNegatives: 372,
      precision: 0.2667,
      recall: 0.177,
      f1: 0.2122,
    };
    const verdict = verdictOf({
      shipped,
      audited: { heldOut: { ...shipped, f1: shipped.f1 + 0.002 } },
      budgetAudited: { heldOut: shipped },
    } as never);
    expect(verdict.categoriesEarned).toBe(false);
    expect(verdict.noiseBand).toBeCloseTo(0.004244, 6);
  });

  it('orders the categories by weight, so a printed table starts where the mass is', () => {
    const findings = corpus(3, { hits: 1, noise: 3, noiseCategory: 'style' });
    findings.push({ ...findings[0]!, category: 'security' });
    expect(emittedCategories(findings)[0]).toBe('style');
  });
});
