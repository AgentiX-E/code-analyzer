/**
 * **What each term of the actionability score is worth, measured by removing it.**
 *
 * The score is eight weighted terms summed into [0, 1] and then used for exactly one decision: which twelve comments of a
 * pull request are posted. Every claim made about it so far has been about the sum. **A sum is not an explanation**, and
 * the attachment audited in iteration 147 supplies the discipline that turns one into the other - hold the corpus fixed,
 * toggle one asset, read the difference as that asset's contribution - which is the ablation method it uses on an
 * ontology layer this repository does not contain.
 *
 * Pointed at the score, the method answers the question the ranking debate has never settled: **does each term earn the
 * budget it reorders?** A term whose removal raises F1 was costing true positives; a term that fires on no row at all was
 * never tested, only assumed.
 *
 * Three guards, because this instrument prices things by rebuilding a number that already exists:
 *
 * 1. {@link recomputeScore} must reproduce every published row's score before a single term is priced, and
 *    {@link ScoreReproductionError} names the row that failed. The probe that skipped this in §144.4 reported **+0.027 of
 *    pure arithmetic error in the flattering direction**.
 * 2. The recall denominator is the **row set's** reference comments, passed in. A pull request whose comments a cut
 *    removed still owns its answer key.
 * 3. A term is removed by setting its weight to zero and re-running the same accumulation in the same order - not by
 *    subtracting it from the published score, because a score clamped at 1 does not lose what it never added.
 */

import { applyCut, matchingByPullRequest, parseCut, score } from './operating-point.mjs';
import { bootstrapF1Delta, DEFAULT_SEED, mcnemarExact } from './paired-difference.mjs';
import { OUR_SHIPPED_CUT } from './like-for-like.mjs';
import { SCORE_TERMS, SCORE_WEIGHTS_VERSION } from './score-weights.mjs';

/** The version of this arithmetic, recorded beside every figure it publishes. */
export const SCORE_ABLATION_VERSION = 'score-term-ablation-v1';

/** Raised when the weights do not rebuild the artifact, which makes every delta below meaningless. */
export class ScoreReproductionError extends Error {
  constructor(mismatches) {
    const first = mismatches[0];
    super(
      `the weights reproduce ${mismatches.length} row(s) that the artifact does not: ` +
        `${first.pr}#${first.index} published ${first.published}, recomputed ${first.recomputed}`,
    );
    this.name = 'ScoreReproductionError';
    this.mismatches = mismatches;
  }
}

const round4 = (x) => Math.round(x * 10_000) / 10_000;
const round6 = (x) => Math.round(x * 1_000_000) / 1_000_000;

/** The features an artifact row carries, in either shape a published row has had. */
function featuresOf(row) {
  if (row?.features) return row.features;
  const nested = row?.score;
  return (nested && typeof nested === 'object' && nested.features) || {};
}

/** The score a row published, in either shape. `NaN` rather than 0, because a missing score is not a perfect one. */
function publishedScore(row) {
  const value = row?.score;
  if (typeof value === 'number') return value;
  return Number(value?.score ?? Number.NaN);
}

/**
 * **One row's score, rebuilt from its features.**
 *
 * The accumulation order is the engine's, term for term, because floats are not associative and a reordered sum rounds
 * differently at the fourth decimal - which is exactly the digit every published figure is quoted to.
 */
export function recomputeScore(row, weights) {
  const features = featuresOf(row);
  const w = weights.actionability;
  let total = 0;
  if (features.grounded) total += w.grounded;
  if (features.proposesChange) total += w.proposesChange;
  if (features.quotesDiff) total += w.quotesDiff;
  if (features.namesSymbol) total += w.namesSymbol;

  // **A count the engine did not write is one lane, not zero** - the same rule the engine applies before dividing by 3.
  const agreement = Number.isFinite(features.agreement) ? Math.max(1, features.agreement) : 1;
  total += w.agreement * (Math.min(agreement, 3) / 3);

  const severity = weights.severity[features.severity];
  if (severity === undefined) {
    throw new Error(
      `severity ${JSON.stringify(features.severity ?? null)} has no weight, so this row cannot be priced`,
    );
  }
  total += w.severity * severity;

  // The engine's default of 0.5 for an unmapped lane is kept rather than tidied: it is the number the artifact used.
  total += w.lane * (weights.lane[features.lane ?? ''] ?? 0.5);

  if (features.hedged) total -= w.hedgePenalty;
  return round4(Math.max(0, Math.min(1, total)));
}

/** How many rows a term was non-zero on, which is the difference between priced and assumed. */
function firedOn(term, rows) {
  let count = 0;
  for (const row of rows) {
    const features = featuresOf(row);
    if (term === 'hedgePenalty') {
      if (features.hedged) count += 1;
    } else if (term === 'agreement') {
      count += 1;
    } else if (term === 'severity' || term === 'lane') {
      count += 1;
    } else if (features[term]) {
      count += 1;
    }
  }
  return count;
}

/**
 * **One arm's point, computed one way.**
 *
 * The headline and the ablation have to read the same function or they are two arithmetics about one number, and the F1
 * a term is priced against would not be the F1 the artifact published.
 */
function pointAt(rows, steps, creditOf, goldens) {
  return { goldens, ...score(applyCut(rows, steps), creditOf, goldens) };
}

/**
 * Price every term by removing it, on one row set, against one cut.
 *
 * @param findings  the artifact's published rows, with `features`, `score`, `pr` and `matchedGoldens`.
 * @param goldens   the row set's reference-comment count - **not** the number the cut happened to match.
 * @param weights   the tables from {@link readScoreWeights}.
 * @param cut       the operating point to price against; the shipped policy by default.
 */
export function ablateScoreTerms({ findings, goldens, weights, cut = OUR_SHIPPED_CUT }) {
  const creditOf = (finding) => finding?.matchedGoldens ?? [];
  const steps = parseCut(cut);

  const mismatches = [];
  for (const [index, row] of findings.entries()) {
    const recomputed = recomputeScore(row, weights);
    const published = publishedScore(row);
    if (!(Math.abs(recomputed - published) <= 5e-5)) {
      mismatches.push({ index, pr: String(row?.pr ?? ''), published, recomputed });
    }
  }
  if (mismatches.length > 0) throw new ScoreReproductionError(mismatches);

  const at = (rows) => pointAt(rows, steps, creditOf, goldens);
  const baseline = at(findings);

  const terms = SCORE_TERMS.map((term) => {
    const muted = {
      actionability: { ...weights.actionability, [term]: 0 },
      severity: weights.severity,
      lane: weights.lane,
    };
    const rescored = findings.map((row) => ({ ...row, score: recomputeScore(row, muted) }));
    const point = at(rescored);
    return {
      term,
      weight: weights.actionability[term],
      firedOn: firedOn(term, findings),
      dead: firedOn(term, findings) === 0,
      without: point,
      delta: round6(point.f1 - baseline.f1),
      /** Positive when removing the term helps, which is the reading a reader gets wrong when only `delta` is printed. */
      costsTruePositives: point.truePositives - baseline.truePositives,
    };
  });

  return {
    version: SCORE_ABLATION_VERSION,
    weightsVersion: SCORE_WEIGHTS_VERSION,
    cut,
    rows: findings.length,
    goldens,
    baseline,
    terms,
  };
}

/** A fixed-width line table, because every figure above is read in comparison with the row before it. */
export function ablationTable(result) {
  const header = 'term              weight  fired   tp   emitted      F1     delta';
  const line = (cells) =>
    `${cells.term.padEnd(16)}${String(cells.weight).padStart(7)}${String(cells.firedOn).padStart(7)}` +
    `${String(cells.without.truePositives).padStart(5)}${String(cells.without.emitted).padStart(10)}` +
    `${cells.without.f1.toFixed(4).padStart(9)}${cells.delta.toFixed(4).padStart(9)}`;
  return [
    header,
    line({ term: '(all terms)', weight: '', firedOn: '', without: result.baseline, delta: 0 }),
    ...result.terms.map(line),
  ].join('\n');
}

/**
 * **The one arm's points, pull request by pull request, with the identities behind the count.**
 *
 * The count is what F1 reads and the identities are what the paired test reads, and they come from one call to
 * {@link matchingByPullRequest} so they cannot disagree. **A pull request with no emission is entered with zero emitted
 * and its own reference comments**, because it is still in the row set - the §141 rule that a cut does not remove an
 * answer key, applied at the level of the loop.
 */
function pointsByPullRequest(rows, steps, creditOf, goldensOf, pullRequests) {
  const kept = applyCut(rows, steps);
  const emitted = new Map();
  for (const row of kept) {
    const pr = String(row?.pr ?? '');
    emitted.set(pr, (emitted.get(pr) ?? 0) + 1);
  }

  const matched = matchingByPullRequest(kept, creditOf);
  /**
   * **Every key the caller named gets an entry, including the pull request that posted nothing.**
   *
   * That is what puts a silenced pull request's reference comments in the denominator, and it is why the caller passes the
   * union of keys down rather than reading them back off this map: a map that only held pull requests with emission would
   * make the two arms disagree about which rows exist, and the difference between two different row sets is the arithmetic
   * §140.5 removed.
   */
  return new Map(
    pullRequests.map((pr) => {
      const holder = matched.get(pr);
      return [
        pr,
        {
          truePositives: holder?.size ?? 0,
          emitted: emitted.get(pr) ?? 0,
          goldens: goldensOf.get(pr) ?? 0,
          covered: new Set([...(holder?.keys() ?? [])].map((golden) => `${pr}\u0000${golden}`)),
        },
      ];
    }),
  );
}

/**
 * The median of the eight terms' standard errors, which is the resolution quoted for a corpus rather than for one term.
 *
 * Eight is even by construction - it is `SCORE_TERMS.length` - so this averages the two middle readings and does not carry
 * an odd-length branch nothing can reach.
 */
function medianOfEight(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * **Every term, priced twice: by ΔF1 with an interval, and by which reference comments changed hands.**
 *
 * The second reading is the one that matters at this corpus size. ΔF1 is a ratio of two sums over 452 reference comments
 * and 305 comments, so a two-comment move lands at 0.005 and the interval on it spans zero; the discordant-pair count is
 * the same move in the unit the move actually happened in, and eight comments all one way is **p = 0.0078** where the
 * F1 interval is uninformative.
 *
 * `resolution` is the corpus's, not a term's: the median of the eight paired standard errors, turned into the smallest
 * difference this many pull requests could show at 5 % and 80 % power. **A device worth less than that cannot be reported
 * as working, however true it is.**
 */
export function pairedTermComparison({
  findings,
  goldensByPullRequest,
  weights,
  cut = OUR_SHIPPED_CUT,
  rounds = 2000,
  seed = DEFAULT_SEED,
}) {
  const creditOf = (finding) => finding?.matchedGoldens ?? [];
  const steps = parseCut(cut);
  const goldensOf = new Map(
    goldensByPullRequest.map((entry) => [String(entry.pr), Number(entry.goldens ?? 0)]),
  );
  const goldens = [...goldensOf.values()].reduce((total, count) => total + count, 0);

  const mismatches = [];
  for (const [index, row] of findings.entries()) {
    const recomputed = recomputeScore(row, weights);
    const published = publishedScore(row);
    if (!(Math.abs(recomputed - published) <= 5e-5)) {
      mismatches.push({ index, pr: String(row?.pr ?? ''), published, recomputed });
    }
  }
  if (mismatches.length > 0) throw new ScoreReproductionError(mismatches);

  const baseline = pointAt(findings, steps, creditOf, goldens);
  /** **One key set, computed once, passed to both arms** - so the two maps cannot describe different row sets. */
  const pullRequests = [
    ...new Set([...goldensOf.keys(), ...findings.map((row) => String(row?.pr ?? ''))]),
  ].sort();
  const base = pointsByPullRequest(findings, steps, creditOf, goldensOf, pullRequests);

  const terms = SCORE_TERMS.map((term) => {
    const muted = {
      actionability: { ...weights.actionability, [term]: 0 },
      severity: weights.severity,
      lane: weights.lane,
    };
    const rescored = findings.map((row) => ({ ...row, score: recomputeScore(row, muted) }));
    const alt = pointsByPullRequest(rescored, steps, creditOf, goldensOf, pullRequests);
    const without = pointAt(rescored, steps, creditOf, goldens);

    const perPullRequest = pullRequests.map((pr) => ({ base: base.get(pr), alt: alt.get(pr) }));
    const interval = bootstrapF1Delta({ perPullRequest, rounds, seed });

    let onlyBase = 0;
    let onlyAlt = 0;
    for (const pr of pullRequests) {
      const before = base.get(pr).covered;
      const after = alt.get(pr).covered;
      for (const key of before) if (!after.has(key)) onlyBase += 1;
      for (const key of after) if (!before.has(key)) onlyAlt += 1;
    }

    return {
      term,
      weight: weights.actionability[term],
      firedOn: firedOn(term, findings),
      dead: firedOn(term, findings) === 0,
      without,
      delta: interval.observed,
      interval,
      onlyBase,
      onlyAlt,
      /** Exact McNemar on the reference comments that changed hands. */
      p: mcnemarExact(onlyBase, onlyAlt),
    };
  });

  return {
    version: SCORE_ABLATION_VERSION,
    weightsVersion: SCORE_WEIGHTS_VERSION,
    cut,
    rows: findings.length,
    goldens,
    pullRequests: pullRequests.length,
    baseline,
    resolution: {
      sd: medianOfEight(terms.map((term) => term.interval.sd)),
      mde: medianOfEight(terms.map((term) => term.interval.mde)),
    },
    terms,
  };
}
