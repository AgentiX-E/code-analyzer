// @code-analyzer/intelligence — what the sample was, before any figure computed over it is read
//
// **The question this module exists to make answerable.** Iteration 70 published `MAP 0.3794`; the paper publishes
// `GPT-4 0.39`, `GTE 0.33`, `TF-IDF 0.27` over fifty instances per language. **Ours was a mean over twenty-four rows
// that survived a 2 000-file cap, and the eleven the cap removed are the large repositories** - which are the ones with
// the most candidates to rank, and therefore the hardest. A mean taken over the easy half of a corpus and printed
// beside a mean taken over all of it is not a comparison; it is two numbers in the same font.
//
// **Two things fix that, and neither of them is a sentence.** A control that runs on the instances the product cannot
// (`lca-baseline.ts`, BM25, one of the paper's own rows) turns an unpaired number into a paired one - the difference of
// two rankings of the same files of the same repository, in which size, language and difficulty cancel. And the sample
// itself has to be described: how many were attempted, how many were refused, **what the refusals were about**, and what
// the figure becomes when the strata are reweighted to the population they were drawn from.
//
// **The reweighting is the part that is easy to get wrong and impossible to fake.** Our per-stratum means are unbiased
// estimates of the per-stratum means of the corpus; a weighted mean of them, with the **attempted** counts as weights,
// estimates the mean over everything attempted even though the hardest strata contributed almost no measurements. Where
// a stratum contributed none, it cannot contribute a mean either - so the covered weight is published beside the figure
// rather than the missing stratum being quietly dropped.
//
// **Everything here is a pure function of the rows.** No filesystem, no network, no model: the numbers can be recomputed
// from the artifact by anyone holding it, which is the only sense in which a published figure is checkable.

import { mean } from './lca-instrument.js';

import type { LanguagePart, LcaRowScore } from './lca-merge.js';

/** One refusal sentence, and how many instances it stopped. **The sentence is quoted, never paraphrased into a code.** */
export interface RefusalCount {
  readonly because: string;
  readonly count: number;
}

/** How much of the intended sample exists. **A figure without this is a figure about an unknown population.** */
export interface SampleCoverage {
  /** Instances this run intended to examine: `min(rowLimit, split size)` less the ones it never reached. */
  readonly planned: number;
  /** Instances it examined - a checkout was fetched and an answer space listed. */
  readonly attempted: number;
  /** Instances that produced a ranking. **The denominator of every published mean.** */
  readonly measured: number;
  /** Instances the bounds refused, in up to four different ways. */
  readonly refused: number;
  /** Instances after the budget that were not examined at all, and therefore have nothing to say. */
  readonly unreached: number;
  /** `measured / attempted`, and **not** `measured / planned` - the second number is published as {@link ofPlanned}. */
  readonly ofAttempted: number;
  /** `measured / planned`: what share of the whole protocol this run saw. */
  readonly ofPlanned: number;
  /** The refusals, one entry per distinct sentence, in descending count. */
  readonly refusals: readonly RefusalCount[];
}

/**
 * Describe the sample.
 *
 * **`planned` is a parameter rather than `rows.length`**, because the rows that were never reached produce no row to
 * count: a run that examined thirty of fifty instances has thirty rows, and reporting `30 / 30` would be a coverage of
 * one hundred per cent of a sample that is sixty per cent of the protocol.
 */
export function sampleCoverage(
  rows: readonly LcaRowScore[],
  planned: number = rows.length,
): SampleCoverage {
  const measured = rows.filter((row) => row.skipped === null).length;
  const attempted = rows.length;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.skipped === null) continue;
    counts.set(row.skipped, (counts.get(row.skipped) ?? 0) + 1);
  }
  const refusals = [...counts.entries()]
    .map(([because, count]) => ({ because, count }))
    // **Descending by count, then by sentence**, so two runs that saw the same refusals print the same table.
    .sort((left, right) =>
      left.count === right.count
        ? left.because.localeCompare(right.because)
        : right.count - left.count,
    );
  const total = Math.max(planned, attempted);
  return {
    planned: total,
    attempted,
    measured,
    refused: attempted - measured,
    unreached: Math.max(0, total - attempted),
    ofAttempted: attempted === 0 ? 0 : measured / attempted,
    ofPlanned: total === 0 ? 0 : measured / total,
    refusals,
  };
}

/** One band of the answer space's size, and what the two rankings did inside it. */
export interface Stratum {
  /** How the band is printed, e.g. `201-500 files`. */
  readonly label: string;
  /** Inclusive lower bound on `corpusFiles`. */
  readonly from: number;
  /** Exclusive upper bound, `null` for the open band. */
  readonly to: number | null;
  readonly attempted: number;
  readonly measured: number;
  readonly refused: number;
  /** Our retriever's mean average precision over the measured rows of this band, or `null` when none was measured. */
  readonly map: number | null;
  /** The control's mean average precision over **every** row of this band that has one. */
  readonly bm25: number | null;
  /** How many rows in this band carry a control figure. */
  readonly bm25Rows: number;
}

/**
 * The default bands.
 *
 * **Chosen before the data, and coarse enough to survive it.** Thresholds at 50, 200, 500 and 2 000 files are the
 * natural landmarks of this corpus (200 is where a small package becomes a project, 2 000 is the harness's own cap),
 * and five bands over a hundred and fifty instances is thirty instances a band - enough to average, few enough to stay
 * legible. **A band chosen after seeing the figures could be chosen to make them look even**; these were not.
 */
export const DEFAULT_STRATA: readonly (readonly [number, number | null])[] = [
  [0, 50],
  [50, 200],
  [200, 500],
  [500, 2_000],
  [2_000, null],
];

/** The rows falling in one band. **Half-open, so no instance is counted twice and none falls between bands.** */
export function rowsInBand(
  rows: readonly LcaRowScore[],
  from: number,
  to: number | null,
): LcaRowScore[] {
  return rows.filter((row) => row.corpusFiles >= from && (to === null || row.corpusFiles < to));
}

/** Average precision of the control over the rows that produced one. **A row without it is excluded, not zeroed.** */
function bm25Of(rows: readonly LcaRowScore[]): { value: number | null; rows: number } {
  const values = rows
    .map((row) => row.bm25?.map)
    .filter((value): value is number => typeof value === 'number');
  return { value: values.length === 0 ? null : mean(values), rows: values.length };
}

/**
 * The sample, split by how large a repository it was.
 *
 * **This is the table that answers "is our sample easier".** The control's column is a measurement of difficulty that
 * does not depend on our retriever at all: if BM25 scores 0.31 on the instances we could run and 0.22 on the corpus as
 * a whole, then the instances we could run are easier **by nine hundredths of MAP**, and any comparison of our figure
 * with a published one has to account for that difference instead of being surprised by it.
 */
export function stratify(
  rows: readonly LcaRowScore[],
  bands: readonly (readonly [number, number | null])[] = DEFAULT_STRATA,
): Stratum[] {
  return bands.map(([from, to]) => {
    const band = rowsInBand(rows, from, to);
    const measured = band.filter((row) => row.skipped === null);
    const control = bm25Of(band);
    return {
      label: to === null ? `${String(from)}+ files` : `${String(from)}-${String(to)} files`,
      from,
      to,
      attempted: band.length,
      measured: measured.length,
      refused: band.length - measured.length,
      map: measured.length === 0 ? null : mean(measured.map((row) => row.map)),
      bm25: control.value,
      bm25Rows: control.rows,
    };
  });
}

/** A figure reweighted to the population it was drawn from, and how much of that population it covers. */
export interface Standardised {
  /** The weighted mean over the strata that produced both a weight and a measurement, or `null` when none did. */
  readonly value: number | null;
  /** The raw mean over the measured rows, for comparison. **The difference is the bias the reweighting removes.** */
  readonly raw: number | null;
  /** Share of the total attempted weight that the covered strata carry. **A figure over 60 % of the weight is a hint.** */
  readonly coveredShare: number;
}

/**
 * Post-stratify the measured mean to the attempted population.
 *
 * **Why this is the honest figure.** The measured rows are not a random sample of the attempted ones: they are the
 * small-repository stratum, almost completely, with a thin tail of the larger ones. A mean over them estimates the mean
 * over *small repositories*. Weighting each stratum's mean by how many instances the stratum actually holds estimates
 * the mean over **everything attempted**, which is the population the published table was drawn from - and it does so
 * without pretending that a stratum nobody measured has a mean.
 *
 * **`coveredShare` is the caveat, printed beside the figure.** A stratum with no measured rows contributes no mean and
 * therefore no weight, so a standardised figure over 55 % of the weight is a standardisation over the easy 55 % and it
 * says so.
 */
export function standardisedMap(strata: readonly Stratum[]): Standardised {
  const total = strata.reduce((sum, stratum) => sum + stratum.attempted, 0);
  const covered = strata.filter((stratum) => stratum.map !== null && stratum.attempted > 0);
  const coveredWeight = covered.reduce((sum, stratum) => sum + stratum.attempted, 0);
  const measuredRows = strata.reduce((sum, stratum) => sum + stratum.measured, 0);
  const measuredSum = strata.reduce(
    (sum, stratum) => sum + (stratum.map === null ? 0 : stratum.map * stratum.measured),
    0,
  );
  return {
    value:
      coveredWeight === 0
        ? null
        : covered.reduce((sum, stratum) => sum + stratum.map! * stratum.attempted, 0) /
          coveredWeight,
    raw: measuredRows === 0 ? null : measuredSum / measuredRows,
    coveredShare: total === 0 ? 0 : coveredWeight / total,
  };
}

/**
 * The worst case the sample permits: every refused instance scored zero.
 *
 * **A lower bound, and the only figure that cannot be accused of cherry-picking.** If our mean is 0.38 over 24 of 35
 * attempted, then a retriever that found *nothing at all* on the eleven it could not run would have scored
 * `0.38 × 24 / 35 = 0.26` - so 0.26 is a number nobody can argue with, and 0.38 is a number everybody should. Publishing
 * both makes the gap the statement, which is exactly right: **the gap is the cost of the bound and the reason to raise
 * it.**
 */
export function worstCaseMap(rows: readonly LcaRowScore[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((sum, row) => sum + (row.skipped === null ? row.map : 0), 0) / rows.length;
}

/** Two rankings of the same files, and what the difference between them is worth. */
export interface PairedComparison {
  /** Instances where both rankings exist. **The only rows this comparison may use.** */
  readonly rows: number;
  /** Instances where ours scored strictly higher. */
  readonly wins: number;
  /** Instances where the control scored strictly higher. */
  readonly losses: number;
  readonly ties: number;
  /** Mean of `ours - control` over the paired rows. **The difficulty-free estimate of the difference.** */
  readonly meanDelta: number;
  /** Percentile bootstrap bounds of that mean, at 95 %. */
  readonly lower: number;
  readonly upper: number;
  /** Exact two-sided sign test on wins against losses. **Assumption-free, which is why it is the one reported.** */
  readonly pValue: number;
  /** The RNG seed, so the interval is a function of the rows rather than of the run. */
  readonly seed: number;
  /** Resamples behind the interval. */
  readonly resamples: number;
}

/** The seed the interval is computed with. **Constant, and published, because a re-derivable interval is the point.** */
export const BOOTSTRAP_SEED = 20_241_106;

/** How many resamples. **Two thousand** is the smallest count at which the 2.5th percentile is not an observed extreme. */
export const BOOTSTRAP_RESAMPLES = 2_000;

/**
 * A deterministic uniform generator (mulberry32).
 *
 * **`Math.random` is not usable here.** A published interval that moves between two runs of the same commit is an
 * interval nobody can check, and the whole reason this module exists is that checkability is what a figure is missing.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The exact two-sided sign test.
 *
 * **The question it answers is narrow and that is why it is trusted.** Under the null hypothesis - our ranking and the
 * control's are equally good - each instance is a coin flip between "ours is better" and "the control is better", and
 * the number of wins is binomial with `p = 0.5`. It assumes nothing about the distribution of average precision, which
 * is bounded, heavily skewed and nowhere near normal; a t-test on twenty-four of these would be a claim about a
 * distribution nobody checked.
 *
 * **Ties leave the sample**, as they must: an instance both rankings scored identically carries no evidence either way.
 */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const tail = Math.max(wins, losses);
  // **Computed as a running product rather than with factorials**, because `150!` is not a number this program can
  // hold and `C(150, 75)` is.
  let probability = 0;
  let combination = 1;
  for (let index = 0; index <= n; index += 1) {
    if (index > 0) combination = (combination * (n - index + 1)) / index;
    if (index >= tail) probability += combination;
  }
  // **Doubled for two-sided, and capped at one**: two tails that sum past one are two tails that overlap.
  return Math.min(1, (2 * probability) / 2 ** n);
}

/**
 * Compare our ranking with the control on the same instances.
 *
 * **The pairing is the whole argument.** Repository size, language, issue length, the number of files the commit
 * touched - every one of them is shared by the two terms of the difference, so none of them can explain it. What is
 * left is the ranking, which is the only thing that differs.
 *
 * **`rows` is the intersection** and it is published: a run that measured twenty-four instances and produced a control
 * on all thirty-five has twenty-four paired observations, and saying so is cheaper than defending a number computed
 * over the wrong denominator.
 */
export function pairedComparison(
  rows: readonly LcaRowScore[],
  options: { readonly seed?: number; readonly resamples?: number } = {},
): PairedComparison | null {
  const deltas: number[] = [];
  for (const row of rows) {
    if (row.skipped !== null) continue;
    const control = row.bm25?.map;
    if (typeof control !== 'number') continue;
    deltas.push(row.map - control);
  }
  if (deltas.length === 0) return null;

  const seed = options.seed ?? BOOTSTRAP_SEED;
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const delta of deltas) {
    // **An exact comparison, because the values are four-place means of exact ratios.** A tie is a tie to the digit the
    // artifact publishes, which is the digit a reader would compare.
    if (Math.abs(delta) < 1e-9) ties += 1;
    else if (delta > 0) wins += 1;
    else losses += 1;
  }

  const random = seeded(seed);
  const means: number[] = [];
  for (let round = 0; round < resamples; round += 1) {
    let sum = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      sum += deltas[Math.floor(random() * deltas.length)]!;
    }
    means.push(sum / deltas.length);
  }
  means.sort((left, right) => left - right);
  const at = (quantile: number): number =>
    means[Math.min(means.length - 1, Math.floor(quantile * means.length))]!;

  return {
    rows: deltas.length,
    wins,
    losses,
    ties,
    meanDelta:
      Math.round((deltas.reduce((sum, value) => sum + value, 0) / deltas.length) * 10000) / 10000,
    lower: Math.round(at(0.025) * 10000) / 10000,
    upper: Math.round(at(0.975) * 10000) / 10000,
    pValue: Math.round(signTest(wins, losses) * 10000) / 10000,
    seed,
    resamples,
  };
}

/**
 * One row of somebody else's published table, **with whether its number is a figure or a bound**.
 *
 * `bound` exists because the paper publishes one row as *"BM25 and the remaining models: below 0.25"* - a ceiling rather
 * than a measurement. A bound is met rather than beaten: a figure of exactly 0.25 is not above the BM25 row, it is at
 * the top of it.
 */
export interface PublishedRow {
  readonly name: string;
  readonly map: number;
  readonly bound?: boolean;
}

/** Where a figure stands in a published table. **A position, and the count it was derived from.** */
export interface PublishedRank {
  /** 1 means nothing in the table is above us. **Includes us**, so a table of five gives a position between 1 and 6. */
  readonly rank: number;
  /** The table's size with us in it. */
  readonly of: number;
  readonly beaten: readonly string[];
  readonly notBeaten: readonly string[];
}

/**
 * Place a figure in somebody else's table.
 *
 * **A position is not a count, and publishing one as the other is a claim nobody checks.** The first version of this
 * arithmetic returned the *number of rows beaten*, so a figure that beat four of five rows published `rank: 4` and was
 * quoted in a report as *fourth* - when it was second. The two differ by `rows + 1`, both are small integers, and the
 * artifact's shape could not tell them apart; a test that asserts a position against a table of known size can.
 */
export function publishedRank(ours: number, table: readonly PublishedRow[]): PublishedRank {
  const beaten = table
    .filter((row) => (row.bound === true ? ours >= row.map : ours > row.map))
    .map((row) => row.name);
  const notBeaten = table
    .filter((row) => (row.bound === true ? ours < row.map : ours <= row.map))
    .map((row) => row.name);
  return {
    rank: table.length + 1 - beaten.length,
    of: table.length + 1,
    beaten,
    notBeaten,
  };
}

/**
 * How often each list contains the answer, and how deep it had to go.
 *
 * **The diagnosis that a mean cannot make.** Both halves of the comparison publish a MAP column, and on the Kotlin split
 * the difference between them was **not** that the control found answers the product could not: the answers were in
 * both lists, at different depths - `netflix/dgs-framework` 0.439 against 1.000, every fixing file present, one of them
 * first for the control and fifth for us. A report that publishes the medians and the first-place counts can say which
 * defect a low figure means, and a reader can check it from the rows.
 *
 * **Only rows that produced both a ranking and a control are counted**, which is the same intersection
 * `pairedComparison` uses: a refused row has a control and no ranking, and including it here would rebuild the
 * asymmetry this function exists to expose.
 */
export interface RankDiagnosis {
  /** The intersection: measured rows that also carry a control. */
  readonly rows: number;
  /** Rows whose own list contains at least one fixing file. */
  readonly oursFound: number;
  /** Rows whose control list does. */
  readonly controlFound: number;
  /** Rows where the answer was our first entry. **The figure the corpus's `at1` column reads.** */
  readonly oursFirst: number;
  readonly controlFirst: number;
  /** Median position of the first answer over the rows that have one, or `null` when none does. */
  readonly oursMedian: number | null;
  readonly controlMedian: number | null;
}

/** Median of the values, rounded to two places so that a half-integer does not read as precision. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
  return Math.round(value * 100) / 100;
}

/** Both rankings' answer positions on the same instances. */
export function rankDiagnosis(rows: readonly LcaRowScore[]): RankDiagnosis {
  const ours: number[] = [];
  const control: number[] = [];
  for (const row of rows) {
    if (row.skipped !== null) continue;
    if (typeof row.bm25?.map !== 'number') continue;
    if (row.answerRank !== null) ours.push(row.answerRank);
    if (row.bm25.rank !== null) control.push(row.bm25.rank);
  }
  return {
    rows: rows.filter((row) => row.skipped === null && typeof row.bm25?.map === 'number').length,
    oursFound: ours.length,
    controlFound: control.length,
    oursFirst: ours.filter((rank) => rank === 1).length,
    controlFirst: control.filter((rank) => rank === 1).length,
    oursMedian: median(ours),
    controlMedian: median(control),
  };
}

/** One language split's paired means. **The same rows on both sides, or the difference is not a difference.** */
export interface LanguagePairing {
  readonly config: string;
  /** Rows where both terms exist. */
  readonly rows: number;
  readonly ours: number | null;
  readonly control: number | null;
  readonly delta: number | null;
}

/**
 * The per-language comparison, over the intersection rather than over each side's own coverage.
 *
 * **The bug this replaces published a win that was an artefact of subtraction.** The merge took ours as the mean over
 * the rows the child measured and the control's as the mean over every row that carried one - refused rows included,
 * and refused rows are the large repositories where the control scores worst. Printed on one line, the two figures
 * invited `ours - control`, so the Java leg of iteration 71 reported **a 0.0037 win** and the paired difference on the
 * same rows says **a 0.102 loss**. A per-language table can only subtract two numbers that were averaged over the same
 * instances, which is what this function computes.
 */
export function pairedByLanguage(parts: readonly LanguagePart[]): LanguagePairing[] {
  return parts.map((part) => {
    const paired = part.rows.filter(
      (row) => row.skipped === null && typeof row.bm25?.map === 'number',
    );
    if (paired.length === 0) {
      return { config: part.config, rows: 0, ours: null, control: null, delta: null };
    }
    const ours = mean(paired.map((row) => row.map));
    const control = mean(paired.map((row) => row.bm25!.map));
    return {
      config: part.config,
      rows: paired.length,
      ours,
      control,
      delta: Math.round((ours - control) * 10000) / 10000,
    };
  });
}
