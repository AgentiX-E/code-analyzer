/**
 * **A budget is a purchase, and the purchase has to be readable as one.**
 *
 * §95.4 chose twelve findings per pull request by keeping the best F1 of four replays, and **F1 alone cannot decide a
 * budget**: it rises, flattens and falls while the bill only rises. The claim this file guards is narrower and sharper -
 * **past twelve, the run's own tail spends tokens and matches goldens it already had.**
 *
 * Three ways of reading the curve are wrong in the direction that flatters an expensive budget, and each is a case below:
 *
 * - **counting findings instead of distinct goldens** turns a second finding that repeats a first one into a true
 *   positive, and the precision it reports is one the protocol never computes (§96.1 makes the same point);
 * - **scoring a cap above the run's own configuration** reads as "a bigger budget would have found more", when all it
 *   can do is re-rank the findings that budget emitted;
 * - **reading the shipped budget off a constant** would let the engine and this measurement drift apart silently, which is
 *   the defect `the-budget-the-benchmark-runs-is-the-budget-the-engine-ships` was written for.
 *
 * The last two cases read the committed artifact rather than a fixture, because **the number that decides what the next
 * arm costs is the number in the file**.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PULL_REQUEST_BUDGET } from '../../../packages/intelligence/src/review/llm/llm-review-engine.js';
import { buildFrontier } from '../../../scripts/budget-frontier.mjs';

const REPO = join(__dirname, '..', '..', '..');
const OURS = JSON.parse(
  readFileSync(join(REPO, 'benchmarks/aacr-bench.json'), 'utf8'),
) as Parameters<typeof buildFrontier>[0];
const ARTIFACT = JSON.parse(
  readFileSync(join(REPO, 'benchmarks/budget-frontier.json'), 'utf8'),
) as ReturnType<typeof buildFrontier>;

/** One pull request's findings, in the shape the artifact writes them. */
function bench(
  findings: Array<{ score: number; text: string; goldens?: string[] }>,
  corpusGoldens: number,
  runBudget = 16,
) {
  return {
    measuredAt: '2026-11-19T00:00:00.000Z',
    configuration: { pullRequestBudget: runBudget },
    coverage: { byPullRequest: [{ goldens: corpusGoldens }] },
    rankedFindings: findings.map((finding) => ({
      pr: 'https://example.test/pull/1',
      actionable: true,
      score: finding.score,
      text: finding.text,
      matchedGoldens: finding.goldens ?? [],
    })),
  };
}

describe('the budget frontier', () => {
  it('scores the highest-F1 budget, and it is the one the engine ships', () => {
    // **Three numbers that must agree and cannot see each other otherwise**: what this curve says is best (12), what
    // §95.4's replay said was best (12), and the constant the engine actually uses. The artifact was produced at 16, so
    // `runBudgetSitsAtBestF1` is *false* and that is the finding rather than a defect - **the run that produced the
    // artifact is the run whose budget this curve says to shorten.**
    expect(ARTIFACT.verdict.bestF1Budget).toBe(DEFAULT_PULL_REQUEST_BUDGET);
    expect(ARTIFACT.runBudget).toBe(16);
    expect(ARTIFACT.verdict.runBudgetSitsAtBestF1).toBe(false);
  });

  it('names the budget that spent tokens and matched no golden it did not already have', () => {
    // **Fourteen is that budget on this corpus**, and the number is a row in the artifact rather than an argument about
    // diminishing returns: 289 findings match 96 goldens where 273 findings matched 96.
    expect(ARTIFACT.verdict.firstBudgetThatBoughtNothing).toBe(14);
    const fourteen = ARTIFACT.rows.find((row) => row.budget === 14)!;
    expect(fourteen.matched).toBe(ARTIFACT.rows.find((row) => row.budget === 12)!.matched);
    expect(fourteen.kept).toBeGreaterThan(ARTIFACT.rows.find((row) => row.budget === 12)!.kept);
  });

  it('states what everything above the best budget bought, in one row', () => {
    const above = ARTIFACT.verdict.aboveBest;
    expect(above.findingsAdded).toBeGreaterThan(20);
    expect(above.goldensAdded).toBeLessThan(3);
    expect(above.tokensAdded).toBeGreaterThan(0);
    // **The tail is long and nearly flat**: a golden per two thousand tokens of finding text is not a budget increase.
    expect(above.goldensAdded / above.tokensAdded).toBeLessThan(0.001);
  });

  it('reads the run budget off the artifact rather than from a constant of its own', () => {
    const shifted = buildFrontier(bench([{ score: 1, text: 'x' }], 1, 8));
    expect(shifted.runBudget).toBe(8);
    expect(shifted.verdict.runBudgetSitsAtBestF1).toBe(false);
  });

  it('counts distinct goldens, so a repeat of a matched complaint is a false positive', () => {
    const frontier = buildFrontier(
      bench(
        [
          { score: 2, text: 'abcd', goldens: ['g1'] },
          { score: 1, text: 'abcd', goldens: ['g1'] },
        ],
        1,
      ),
    );
    const atFour = frontier.rows.find((row) => row.budget === 2)!;
    expect(atFour.kept).toBe(2);
    expect(atFour.matched).toBe(1);
    expect(atFour.precision).toBe(0.5);
    expect(atFour.recall).toBe(1);
    // **F1 of precision 0.5 and recall 1**, which is the arithmetic a count of findings would report as 1.0.
    expect(atFour.f1).toBeCloseTo(2 / 3, 3);
  });

  it('keeps the top of the ranking, which is the only set a budget can change', () => {
    const frontier = buildFrontier(
      bench(
        [
          { score: 3, text: 'aaaa' },
          { score: 2, text: 'bbbb' },
          { score: 1, text: 'cccc', goldens: ['g1'] },
        ],
        1,
      ),
    );
    // **A budget of two keeps the two findings that match nothing**, because the budget keeps the top of the ranking
    // and the only matched finding sits third; from four upwards the whole set is in and recall is 1.
    expect(frontier.rows.map((row) => row.matched)).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
    // **The bottom finding is the one that matched**, so the small budgets are the empty ones - which is exactly why a
    // budget cannot be read off recall alone.
    expect(frontier.rows[0]!.kept).toBe(2);
  });

  it('models the cost as characters over four, on both sides of every ratio', () => {
    const frontier = buildFrontier(bench([{ score: 1, text: 'x'.repeat(400) }], 1));
    const atTwo = frontier.rows.find((row) => row.budget === 2)!;
    expect(atTwo.characters).toBe(400);
    expect(atTwo.tokens).toBe(100);
    expect(atTwo.goldensPerThousandTokens).toBe(0);
  });

  it('ignores a finding the gate would not have raised, because it was never part of the bill', () => {
    const gated = bench(
      [
        { score: 2, text: 'aaaa', goldens: ['g1'] },
        { score: 1, text: 'aaaa' },
      ],
      1,
    );
    gated.rankedFindings[1]!.actionable = false;
    const frontier = buildFrontier(gated);
    expect(frontier.rows.find((row) => row.budget === 2)!.kept).toBe(1);
    expect(frontier.rows.find((row) => row.budget === 2)!.matched).toBe(1);
  });

  it('agrees with the committed artifact, so the document and the table cannot drift', () => {
    expect(buildFrontier(OURS)).toEqual(ARTIFACT);
  });
});
