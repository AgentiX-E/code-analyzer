// **The error bar this repository spent two iterations finding was the error bar of one slice, and it was ten times too
// small.**
//
// §60 replaced a `0.04 measured at 170 goldens` anchor with `0.0017 measured by running one configuration twice on the
// same 98 pull requests`. That was a real measurement and it replaced a rumour, and it is still the wrong number for the
// question a registration asks: **it is the noise of the reviewer with the corpus held fixed, and a registration is a
// claim about a corpus.** Nothing in it prices the corpus.
//
// The corpus can be priced from the same artifact, because every artifact carries the figure per pull request. Resample
// the 98 rows with replacement four thousand times, recompute F1 from the resampled counts on each draw, and the spread
// of that distribution is what a second corpus of 98 pull requests would move the figure by. On R-31's two arms it is
// **0.0191, eleven times the 0.0017** - and the paired difference is [-0.052, +0.022] with `P(delta > 0) = 0.19`, which
// is the same verdict McNemar's 63:82 / p = 0.135 gives by a different route.
//
// **Two consequences, and the second is the dangerous one.** A registration whose bar sits under 0.0191 cannot be
// confirmed by any amount of evidence - that is R-32's 0.01, dispatched yesterday against a bar the instrument cannot
// see. And a bar of 0.0017 makes *every* registration confirmable, which is worse: it does not withhold verdicts, it
// publishes devices that are noise. **A resolution that is too coarse costs a verdict; one that is too fine costs the
// table.**
//
// **The field that flips the sign.** Each coverage row carries `emitted` and `shippedEmitted`, and `emitted` is the full
// emission before the cut - 1110 comments for the lanes arm against 638 actually posted. Reading the wrong one gives
// lanes 0.1523 and the reader arm 0.1752, **so the arm that lost on the shipped figures appears to win**, and it does so
// by counting the comments the budget discarded as false positives. This file pins `shippedEmitted` because a version of
// this analysis got it wrong first.

import { describe, expect, it } from 'vitest';

import {
  CORPUS_SAMPLING,
  MINIMUM_REGISTERED_GAIN,
  REGISTRATIONS,
  REPRODUCTION,
  registrationResolvable,
  resolutionFor,
  resolutionForPullRequests,
} from '../../../.github/scripts/aacr-ablation-compare.mjs';
import {
  clusterBootstrapDelta,
  corpusResolution,
  f1From,
  perPullRequestOutcome,
} from '../../../scripts/lib/corpus-resolution.mjs';

/**
 * **R-31's two arms, one row per pull request, as `goldens,covered,comments` twice** - lanes arm first, reader arm
 * second, in the order both artifacts agree on. Read out of `aacr-bench.json` from run `43839753881`, the 98 rows both
 * arms reviewed, with `comments` taken from `shippedEmitted` rather than `emitted`.
 */
const R31_ROWS =
  '5,3,11,1,6 10,1,12,2,11 16,0,11,0,7 4,0,12,1,10 4,0,7,0,5 18,1,12,4,12 11,3,12,3,11 7,3,7,1,5 ' +
  '5,0,1,0,0 13,3,12,2,11 5,1,1,0,1 18,4,12,3,12 4,0,6,1,5 10,2,6,1,3 18,5,9,5,10 6,2,5,2,6 ' +
  '1,1,2,0,4 1,0,6,0,0 4,1,4,0,2 2,0,4,1,4 2,1,2,1,3 2,1,12,1,6 3,1,1,1,3 9,4,12,4,12 ' +
  '11,1,7,3,8 5,1,2,1,5 4,1,2,2,4 5,1,3,2,4 5,1,5,1,9 6,2,5,3,5 4,0,1,0,0 5,2,2,1,2 ' +
  '5,1,12,2,7 4,2,12,3,8 8,3,7,0,0 9,0,12,0,12 10,1,12,0,10 7,1,8,1,4 2,1,1,1,1 5,1,6,1,10 ' +
  '6,2,4,2,3 16,4,12,4,10 1,0,0,0,0 4,1,2,2,3 3,1,1,0,1 2,1,1,0,3 1,0,0,0,0 3,1,12,1,3 ' +
  '24,3,12,4,11 3,0,10,1,5 14,1,5,0,3 13,3,7,2,9 5,2,10,0,6 7,0,2,0,2 16,0,2,0,1 5,1,3,1,3 ' +
  '19,5,9,4,11 2,0,5,0,6 28,4,12,3,8 9,2,10,2,3 6,0,7,1,7 6,1,4,0,4 6,1,4,2,5 10,1,9,1,8 ' +
  '8,3,7,0,2 2,1,8,0,2 6,1,8,2,7 3,1,7,1,6 8,4,7,0,6 12,3,12,4,9 2,0,2,0,0 1,0,0,0,0 ' +
  '3,1,3,1,3 3,1,2,0,2 21,2,12,0,6 13,5,7,3,10 12,1,6,7,10 2,1,12,0,12 6,1,4,1,5 21,3,12,1,8 ' +
  '2,0,1,0,3 4,1,9,1,7 2,0,1,0,0 14,4,7,2,11 5,1,5,2,7 8,3,10,1,12 2,0,12,0,4 2,0,2,0,0 ' +
  '11,1,12,0,10 1,0,0,0,0 6,0,3,0,4 2,0,4,1,3 8,2,4,3,11 4,1,3,1,6 1,0,1,0,2 19,7,12,3,12 ' +
  '5,1,12,1,11 14,0,12,0,12 ';

interface CoverageRow {
  goldens: number;
  covered: number[];
  shippedEmitted: number;
}

/**
 * **One cell is one pull request read by two arms**, so the parse returns two lists rather than a list of pairs.
 *
 * The first version built the pairs inside a `reduce` over `[[], []]` and indexed the accumulator, which under
 * `noUncheckedIndexedAccess` is `undefined`-able - and the assertion operator that silences it would have silenced the
 * next real bug in the same expression. **Two `map`s over one parsed cell say the same thing with no index at all**, and
 * a malformed cell is refused rather than averaged: `Number(undefined)` is `NaN`, and a `NaN` reaching the bootstrap
 * would be read as a row and reported as a standard deviation.
 */
function readCell(cell: string): { lanes: CoverageRow; reader: CoverageRow } {
  const cells = cell.split(',').map(Number);
  if (cells.length !== 5 || cells.some((value) => !Number.isFinite(value)))
    throw new Error(`the fixture cell ${JSON.stringify(cell)} is not five counts`);
  const [goldens, coveredA, commentsA, coveredB, commentsB] = cells as [
    number,
    number,
    number,
    number,
    number,
  ];
  const row = (covered: number, shipped: number): CoverageRow => ({
    goldens,
    covered: Array.from({ length: covered }, (_, index) => index),
    shippedEmitted: shipped,
  });
  return { lanes: row(coveredA, commentsA), reader: row(coveredB, commentsB) };
}

function parse(table: string): [CoverageRow[], CoverageRow[]] {
  const cells = table.trim().split(/\s+/).map(readCell);
  return [cells.map((cell) => cell.lanes), cells.map((cell) => cell.reader)];
}

const [LANES, READER] = parse(R31_ROWS);

describe('a bar for a corpus is not a bar for one slice of it', () => {
  it('reads the comments that were posted, not the ones the budget discarded', () => {
    // `emitted` is the full emission before the cut; `shippedEmitted` is what reached the pull request. A row that
    // carries both, with a budget that threw most of it away, is the only fixture that can tell them apart.
    const outcome = perPullRequestOutcome({
      goldens: 4,
      covered: [0, 1],
      emitted: 100,
      shippedEmitted: 5,
    });
    expect(outcome).toEqual({ tp: 2, fp: 3, fn: 2 });
    // **And the wrong field is not a rounding error, it is a different verdict**: 98 of 100 comments counted as false
    // positives make the arm that posted fewer comments look precise.
    const wrong = perPullRequestOutcome({ goldens: 4, covered: [0, 1], emitted: 100 });
    expect(wrong.estimated).toBe(true);
    expect(wrong.fp).toBe(98);
  });

  it('recomputes both arms exactly as their artifacts published them', () => {
    const totals = (rows: ReturnType<typeof parse>[number]) =>
      rows.reduce(
        (sum, row) => {
          const { tp, fp, fn } = perPullRequestOutcome(row);
          return { tp: sum.tp + tp, fp: sum.fp + fp, fn: sum.fn + fn };
        },
        { tp: 0, fp: 0, fn: 0 },
      );
    const lanes = totals(LANES);
    expect(lanes).toEqual({ tp: 139, fp: 499, fn: 576 });
    expect(f1From(lanes.tp, lanes.fp, lanes.fn)).toBeCloseTo(0.2055, 4);
    const reader = totals(READER);
    expect(reader).toEqual({ tp: 120, fp: 436, fn: 595 });
    expect(f1From(reader.tp, reader.fp, reader.fn)).toBeCloseTo(0.1888, 4);
  });

  it('prices the corpus, and gets eleven times the repeat', () => {
    const resolution = corpusResolution(READER, LANES, { resamples: 4000, seed: 20260816 });
    // **The number the repository did not have**: a second corpus of 98 pull requests moves the figure by about 0.019,
    // not by the 0.0017 two runs of one configuration differ by. The window is wide because a bootstrap standard
    // deviation is itself estimated - 4000 draws put it within about one percent, and this file does not want to pin a
    // digit that a different generator would move.
    expect(resolution).toBeGreaterThan(0.015);
    expect(resolution).toBeLessThan(0.023);
    expect(resolution).toBeGreaterThan(5 * REPRODUCTION.f1Delta);
    // **And the constant is this computation, not a number written down beside it**: the published anchor has to be
    // reproducible from the artifact's own rows, or it is a memory with a decimal point.
    expect(resolution).toBeCloseTo(CORPUS_SAMPLING.deltaSd, 2);
  });

  it('gives the paired difference an interval that straddles zero', () => {
    const delta = clusterBootstrapDelta(READER, LANES, { resamples: 4000, seed: 20260816 });
    expect(delta.pullRequests).toBe(98);
    expect(delta.lower).toBeLessThan(0);
    expect(delta.upper).toBeGreaterThan(0);
    // **The reader arm is behind on its own rows and the test will not sign it**, which is what McNemar's 63:82 at
    // p = 0.135 said from the golden-level pairs. Two instruments, one verdict.
    expect(delta.positiveRate).toBeLessThan(0.3);
    expect(delta.mean).toBeLessThan(0);
  });

  it('has no noise to report on a corpus where nothing varies', () => {
    // A bootstrap that returns a positive spread on identical rows would be reporting its own generator, and every
    // number in this file would then be a property of the seed.
    const flat = Array.from({ length: 20 }, () => ({
      goldens: 4,
      covered: [0, 1],
      shippedEmitted: 3,
    }));
    const delta = clusterBootstrapDelta(flat, flat, { resamples: 200, seed: 7 });
    expect(delta.sd).toBe(0);
    expect(delta.lower).toBe(0);
    expect(delta.upper).toBe(0);
  });

  it('repeats itself for one seed and settles for another', () => {
    const once = clusterBootstrapDelta(READER, LANES, { resamples: 500, seed: 11 });
    const twice = clusterBootstrapDelta(READER, LANES, { resamples: 500, seed: 11 });
    expect(twice).toEqual(once);
    // **A resampling instrument whose answer depends on the seed is not an instrument**, so a second seed has to land
    // on the same figure within the width of its own estimation error.
    const other = clusterBootstrapDelta(READER, LANES, { resamples: 500, seed: 12 });
    expect(Math.abs(other.sd - once.sd)).toBeLessThan(0.2 * once.sd);
  });

  it('scales with the corpus, and says how much corpus 0.01 would cost', () => {
    // A standard error falls with the square root of the sample: 98 rows resolve 0.0191, 392 rows resolve half of it.
    expect(resolutionForPullRequests(98)).toBeCloseTo(CORPUS_SAMPLING.deltaSd, 4);
    expect(resolutionForPullRequests(392)).toBeCloseTo(CORPUS_SAMPLING.deltaSd / 2, 3);
    // **So a 0.01 bar needs a 358-row corpus**, which is the honest answer to "why not just register a smaller gain".
    expect(resolutionForPullRequests(358)).toBeLessThan(0.0105);
    expect(resolutionForPullRequests(98)).toBeGreaterThan(0.0105);
  });

  it('puts the repeat and the corpus side by side, because they answer different questions', () => {
    expect(CORPUS_SAMPLING.pullRequests).toBe(98);
    expect(CORPUS_SAMPLING.goldens).toBe(715);
    expect(CORPUS_SAMPLING.deltaSd).toBeCloseTo(0.0191, 3);
    // The reviewer twice on one corpus - §60's measurement, kept and labelled.
    expect(CORPUS_SAMPLING.samplingBar).toBeCloseTo(REPRODUCTION.f1Delta, 4);
    expect(CORPUS_SAMPLING.deltaSd).toBeGreaterThan(CORPUS_SAMPLING.samplingBar);
  });

  it('refuses to accept a bar under the corpus resolution as answerable', () => {
    // **The bar the instrument can see.**
    expect(MINIMUM_REGISTERED_GAIN).toBeGreaterThanOrEqual(CORPUS_SAMPLING.deltaSd);
    expect(resolutionFor(715)).toBeCloseTo(CORPUS_SAMPLING.deltaSd, 4);
    // R-32's 0.01 was dispatched against a bar eleven times finer than this corpus can resolve, so its result can only
    // ever be a point estimate. Recording that is the point: the run is paid for either way.
    const second = registrationResolvable(REGISTRATIONS.secondConcern, 715);
    expect(second.resolvable).toBe(false);
    expect(second.reason).toMatch(/unfalsifiable/);
    // **And R-31's 0.02 clear sit above it**, which is why a falsified reader arm is a verdict and not a rumour.
    expect(REGISTRATIONS.ensemble.registeredGain).toBeGreaterThanOrEqual(CORPUS_SAMPLING.deltaSd);
    expect(registrationResolvable(REGISTRATIONS.ensemble, 715).resolvable).toBe(true);
  });

  it('does not buy a verdict with a single credit', () => {
    // One golden is 0.0013 of F1 at 715. The corpus moves the figure by 0.0191 by itself, so **fourteen credits are
    // the smallest visible difference** - and a document that reports one credit as a result is reading its own noise.
    const oneGolden = f1From(140, 499, 575) - f1From(139, 499, 576);
    expect(oneGolden).toBeLessThan(CORPUS_SAMPLING.deltaSd / 10);
  });
});
