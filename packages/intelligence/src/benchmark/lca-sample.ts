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
import { FILE_AGGREGATION } from '../search/file-ranking.js';

import type { FileArmScore, LanguagePart, LcaRowScore } from './lca-merge.js';

/**
 * The aggregation the product ships, read from the module that owns the choice rather than restated here.
 *
 * **One constant in two places is two choices.** The armature compares against whatever `search/file-ranking.ts` says
 * the product does, so shipping a different default changes the control automatically instead of silently comparing the
 * other four arms against an arm nobody uses.
 */
const SHIPPED_AGGREGATION: string = FILE_AGGREGATION;

/** One refusal sentence, and how many instances it stopped. **The sentence is quoted, never paraphrased into a code.** */
/** One control's figure for a row, or `null`/`undefined` when it did not run on it. */
export type ControlReading = (row: LcaRowScore) => number | null | undefined;

/** The primary control's reading. **Named rather than inlined**, because a second control reads the same rows. */
export const BM25_MAP: ControlReading = (row) => row.bm25?.map;

/** The second control's reading, on the same rule. */
export const TFIDF_MAP: ControlReading = (row) => row.tfidf?.map;

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

/**
 * Two rankings' means over **the same rows**, and the difference that is therefore subtractable.
 *
 * **The bug this shape removes was a subtraction nobody performed and everybody could.** A band used to publish our
 * mean over the rows we measured beside the control's mean over every row of the band - refused rows included, and
 * refused rows are the large repositories where the control scores worst. The two numbers sat on one line, the reader
 * subtracts them, and the result is a comparison between two different samples. Every comparison in this module is now
 * an object that carries its own row count, so a mean over one sample cannot be printed beside a mean over another
 * without the two counts being visible.
 */
export interface PairedMeans {
  /** Rows where both terms exist. **The only rows this difference may use.** */
  readonly rows: number;
  readonly ours: number | null;
  readonly control: number | null;
  /** `ours - control`, on the same rows. **Never the difference of two means over different samples.** */
  readonly delta: number | null;
}

/** One band of the answer space's size, and what the rankings did inside it. */
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
  readonly ours: number | null;
  /**
   * The same rows, read with the declaration pool alone - **the arm `ours` was built from**, and the only figure on this
   * band that can be subtracted from `ours` to get the fusion's contribution.
   *
   * **This field exists because the report subtracted the wrong pair.** `ours` is a mean over the band's *measured* rows
   * and `fusion` is a mean over *every attempted* row of the band, so the difference between them is mostly the
   * difference between two denominators: on 200-500 files the two read 0.3880 and 0.3858, and that 0.0022 was published
   * as the fusion costing something on the band it was built for. The declaration arm on the same rows scores 0.2912,
   * so the fusion was gaining 0.0968 there. **A column whose partner is measured over other rows is a column nobody can
   * subtract.**
   */
  readonly declaration: number | null;
  /** How many of the band's measured rows carry a declaration-only figure. **`declaration` is a mean over these.** */
  readonly declarationRows: number;
  /** Our figure against the primary control, **on the rows both produced one**. */
  readonly vsBm25: PairedMeans;
  /** And against the second control, on the same rule. */
  readonly vsTfidf: PairedMeans;
  /**
   * The product's fallback over **every attempted row of the band**, and how many that was.
   *
   * **This is the column that makes a band's difficulty answerable.** `refused` says how much of the band the analyser
   * could not run; a fallback figure over the whole band says what the product would have scored there if it had
   * degraded instead of declining, which is the quantity the bounds are costing and the quantity a raise would buy.
   */
  readonly fallback: number | null;
  readonly fallbackRows: number;
  /**
   * **The product's fused ranking over every attempted row of the band**, and how many rows carried one.
   *
   * The column `fallback` cannot be: a fallback is what the product does *instead of* the analysis, while this is what
   * it does *with the file-level arm alongside* the analysis on the rows that ran. **`fusion` is not comparable with
   * `ours`**: `ours` is over the band's measured rows and this is over every attempted one, so their difference is a
   * denominator before it is anything else. The fusion's contribution is `ours - declaration`, which is why the
   * declaration arm publishes its own column on the same rows.
   */
  readonly fusion: number | null;
  readonly fusionRows: number;
  /** The primary control's mean average precision over **every** row of this band that has one. */
  readonly bm25: number | null;
  /** How many rows in this band carry a primary-control figure. */
  readonly bm25Rows: number;
  /**
   * **The second control's figure for the same band**, so the difficulty of a band is two measurements rather than one.
   *
   * A band that is easy for BM25 and hard for TF-IDF is a band whose difficulty is a property of a formula, and a band
   * both controls find easy is one the bounds really did remove. The two columns are never subtracted from each other:
   * the per-band claim is about our sample, and `paired` is where two rankings are compared.
   */
  readonly tfidf: number | null;
  /** How many rows in this band carry a second-control figure. */
  readonly tfidfRows: number;
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

/** Average precision of one control over the rows that produced one. **A row without it is excluded, not zeroed.** */
function controlOf(
  rows: readonly LcaRowScore[],
  reading: ControlReading,
): { value: number | null; rows: number } {
  const values = rows
    .map((row) => reading(row))
    .filter((value): value is number => typeof value === 'number');
  return { value: values.length === 0 ? null : mean(values), rows: values.length };
}

/**
 * The product's fallback figure for a row.
 *
 * **Not a `ControlReading`**, because a fallback is not a control: it exists on every attempted row, so its mean is
 * taken over the attempted sample rather than over an intersection, and averaging it with the controls would hide the
 * one property that makes it worth publishing.
 */
export function fallbackMapOf(row: LcaRowScore): number | undefined {
  return row.fallback?.map;
}

/** The fallback's mean over the rows that carry one. **The coverage-bearing figure: its denominator is the run.** */
export function fallbackOf(rows: readonly LcaRowScore[]): { value: number | null; rows: number } {
  const values = rows
    .map(fallbackMapOf)
    .filter((value): value is number => typeof value === 'number');
  return { value: values.length === 0 ? null : mean(values), rows: values.length };
}

/**
 * The product's fused ranking for a row: **the declaration arm and the file-level arm where both ran, the file-level
 * arm alone where the analysis was refused.**
 *
 * Not `row.map`, which is zero on a refused row because there is no ranking to report - a zero that means "no ranking"
 * and a zero that means "ranked everything wrong" are the same number and different facts, and this selector is the one
 * that keeps them apart.
 */
export function fusionMapOf(row: LcaRowScore): number | undefined {
  return row.fusion?.map;
}

/** The fused figure's mean over the rows that carry one. **Every attempted row carries one**, which is its point. */
export function fusionOf(rows: readonly LcaRowScore[]): { value: number | null; rows: number } {
  const values = rows
    .map(fusionMapOf)
    .filter((value): value is number => typeof value === 'number');
  return { value: values.length === 0 ? null : mean(values), rows: values.length };
}

/** One rung of the constant sweep: the figure at one `k`, and how many rows stand behind it. */
export interface FusionRung {
  /** The rank constant, from `lca-fusion.ts`'s ladder. */
  readonly k: number;
  /** Mean average precision over the rows that carry this rung, or `null` when none does. */
  readonly map: number | null;
  readonly rows: number;
}

/** A row's figure at one constant, or `undefined` when the row has no rung there. **The general form of the sweep.** */
export function fusedAtK(k: number): RowReading {
  return (row) => row.fusionByK?.find((at) => at.k === k)?.map;
}

/**
 * **The sweep, aggregated.** One mean per constant over the instances the analysis measured.
 *
 * The rungs are sorted by constant rather than by the order the ladder was written in, so a figure read off this list is
 * in a coordinate a reader already has. A rung with no rows is dropped rather than published as a `null` mean: the
 * ladder is fixed in advance, but a part written before the ladder existed has no rung to average, and an empty rung
 * would read as a constant that scored nothing.
 */
export function fusedByKOf(rows: readonly LcaRowScore[]): FusionRung[] {
  const rungs = new Map<number, number[]>();
  for (const row of rows) {
    for (const at of row.fusionByK ?? []) {
      const values = rungs.get(at.k) ?? [];
      values.push(at.map);
      rungs.set(at.k, values);
    }
  }
  return [...rungs.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([k, values]) => ({ k, map: mean(values), rows: values.length }));
}

/** The declaration arm alone, **which exists only where the analysis produced a pool**. */
export const DECLARATIONS: RowReading = (row) => row.declarationMap;

/**
 * Two rankings over **the same rows**, which is what makes their difference a difference.
 *
 * **One function for every grouping.** The per-language table and the per-band table asked the same question and the
 * per-band one answered it wrongly for two iterations - ours over the rows we measured, the control over every row of
 * the band - because the arithmetic was written twice. It is written once here and both tables call it.
 */
export function pairedMeans(
  rows: readonly LcaRowScore[],
  control: ControlReading = BM25_MAP,
): PairedMeans {
  return pairedBetween(rows, OURS, control);
}

/** A figure read off a row, or `null`/`undefined` when the row has none. **The general form of a pairing.** */
export type RowReading = (row: LcaRowScore) => number | null | undefined;

/**
 * Our own ranking, **which exists only on rows the analysis produced**.
 *
 * A refused row's `map` is a zero that means "no ranking", and pairing it against a control that did produce one would
 * turn a refusal into a loss - which is a claim about the bounds wearing the name of a claim about the ranking.
 */
export const OURS: RowReading = (row) => (row.skipped === null ? row.map : null);

/**
 * Two readings over the rows **both** produced a figure, whatever the pair is.
 *
 * **The general form exists because there are now three pairs and one of them is not against a control.** The product's
 * fallback ranks a checkout the analysis refused, so it has a figure on rows our own ranking does not; and on the rows
 * where both exist the comparison between them is the mechanism test - *is a path and its imports a better document
 * than the whole analyser's pool* - which is a question about our two instruments and not about a competitor.
 */
export function pairedBetween(
  rows: readonly LcaRowScore[],
  left: RowReading = OURS,
  right: RowReading = BM25_MAP,
): PairedMeans {
  const paired: { ours: number; control: number }[] = [];
  for (const row of rows) {
    const first = left(row);
    const second = right(row);
    if (typeof first !== 'number' || typeof second !== 'number') continue;
    paired.push({ ours: first, control: second });
  }
  if (paired.length === 0) return { rows: 0, ours: null, control: null, delta: null };
  const ours = mean(paired.map((pair) => pair.ours));
  const controlMean = mean(paired.map((pair) => pair.control));
  return {
    rows: paired.length,
    ours,
    control: controlMean,
    delta: Math.round((ours - controlMean) * 10000) / 10000,
  };
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
    const control = controlOf(band, BM25_MAP);
    const second = controlOf(band, TFIDF_MAP);
    const fallback = fallbackOf(band);
    const fused = fusionOf(band);
    const declarations = measured
      .map((row) => row.declarationMap)
      .filter((value): value is number => typeof value === 'number');
    return {
      label: to === null ? `${String(from)}+ files` : `${String(from)}-${String(to)} files`,
      from,
      to,
      attempted: band.length,
      measured: measured.length,
      refused: band.length - measured.length,
      ours: measured.length === 0 ? null : mean(measured.map((row) => row.map)),
      declaration: declarations.length === 0 ? null : mean(declarations),
      declarationRows: declarations.length,
      vsBm25: pairedMeans(band, BM25_MAP),
      vsTfidf: pairedMeans(band, TFIDF_MAP),
      fallback: fallback.value,
      fallbackRows: fallback.rows,
      fusion: fused.value,
      fusionRows: fused.rows,
      bm25: control.value,
      bm25Rows: control.rows,
      tfidf: second.value,
      tfidfRows: second.rows,
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
  const covered = strata.filter((stratum) => stratum.ours !== null && stratum.attempted > 0);
  const coveredWeight = covered.reduce((sum, stratum) => sum + stratum.attempted, 0);
  const measuredRows = strata.reduce((sum, stratum) => sum + stratum.measured, 0);
  const measuredSum = strata.reduce(
    (sum, stratum) => sum + (stratum.ours === null ? 0 : stratum.ours * stratum.measured),
    0,
  );
  return {
    value:
      coveredWeight === 0
        ? null
        : covered.reduce((sum, stratum) => sum + stratum.ours! * stratum.attempted, 0) /
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

/** How a pairing is computed. **The control is a parameter**, so the same arithmetic serves both comparisons. */
export interface PairingOptions {
  readonly seed?: number;
  readonly resamples?: number;
  /** Which control's figure to pair against. **Defaults to the primary one**, which is the paper's own row. */
  readonly control?: ControlReading;
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
  options: PairingOptions = {},
): PairedComparison | null {
  const reading = options.control ?? BM25_MAP;
  const deltas: number[] = [];
  for (const row of rows) {
    if (row.skipped !== null) continue;
    const control = reading(row);
    if (typeof control !== 'number') continue;
    deltas.push(row.map - control);
  }
  if (deltas.length === 0) return null;

  const counts = countOf(deltas);
  const interval = bootstrapOf(deltas, options);
  return {
    rows: deltas.length,
    ...counts,
    meanDelta: round4(deltas.reduce((sum, value) => sum + value, 0) / deltas.length),
    lower: interval.lower,
    upper: interval.upper,
    pValue: round4(signTest(counts.wins, counts.losses)),
    seed: options.seed ?? BOOTSTRAP_SEED,
    resamples: options.resamples ?? BOOTSTRAP_RESAMPLES,
  };
}

/** Four places, because the artifact publishes four and a comparison against it has to be made at that precision. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Wins, losses and ties over a list of paired differences. **A tie is exact**, since both terms are means of exact ratios. */
function countOf(deltas: readonly number[]): { wins: number; losses: number; ties: number } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const delta of deltas) {
    if (Math.abs(delta) < 1e-9) ties += 1;
    else if (delta > 0) wins += 1;
    else losses += 1;
  }
  return { wins, losses, ties };
}

/**
 * The percentile bootstrap of the mean of a list of paired differences.
 *
 * **The interval is the only thing here that needs randomness, and the randomness is seeded.** A published interval
 * that moves between two runs of the same commit is an interval nobody can check.
 */
function bootstrapOf(
  deltas: readonly number[],
  options: { readonly seed?: number; readonly resamples?: number },
): { lower: number; upper: number } {
  const random = seeded(options.seed ?? BOOTSTRAP_SEED);
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES;
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
  return { lower: round4(at(0.025)), upper: round4(at(0.975)) };
}

/** One way of reading a file off the declarations it holds, and what it would have been worth. */
export interface ArmComparison {
  /** The aggregation, from `search/file-ranking.ts`. */
  readonly aggregation: string;
  /** Rows where this arm and the shipped arm both produced a figure. **The paired intersection.** */
  readonly rows: number;
  /** This arm's mean average precision over those rows. */
  readonly map: number | null;
  /** The shipped arm's mean over **the same rows**, so the two are subtractable. */
  readonly control: number | null;
  /** `map - control`, on the same rows. **What changing the rule would have been worth, in MAP.** */
  readonly delta: number | null;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly lower: number | null;
  readonly upper: number | null;
  readonly pValue: number | null;
  /** Rows whose first entry is a fixing file under this arm. */
  readonly firstPlaced: number;
  /** Rows whose ranking contains a fixing file at all. */
  readonly found: number;
}

/**
 * Which of an arm's two figures a comparison is about.
 *
 * `pool` is the file ranking the pool's own declarations produce - the instrument the product shipped before iteration
 * 77, and still the right reading for the question "which aggregation rule", because it is the only reading in which
 * the aggregation is the sole difference. `fused` is that ranking with the file-level arm fused into it, which is what
 * the product returns: the same five aggregations, each answering on the ranking a user actually gets.
 */
export type FileArmReading = 'pool' | 'fused';

/**
 * What each way of turning declarations into files would have scored, on the instances the run actually measured.
 *
 * **The question this answers is a choice the product made without measuring it.** A declaration ranking becomes a file
 * ranking; the product took a file's position to be its earliest declaration's, and `search/file-ranking.ts` states four
 * other readings of the same pool. A choice between five functions is not settled by an argument about which is more
 * natural - it is settled by the paired difference on the same rows, which is what this computes, and the sign test is
 * the one reported because average precision over a hundred rows is bounded, skewed and not normal.
 *
 * **The shipped arm is compared against itself and must publish exactly zero.** That row is the armature's control: an
 * arm that disagrees with the product's own column is a wiring mistake, not a measurement, and the gate refuses an
 * artifact where `max`'s own delta is anything but zero.
 *
 * **`shipped` is an argument with a default rather than a literal read from the rows**, because a run that published no
 * `max` arm at all (an older part merged beside a newer one) has to fail this comparison loudly rather than quietly
 * compare two other arms and label one of them the product.
 *
 * **`reading` is an argument for the same reason one step further out.** The artifact publishes this comparison twice -
 * once on the pool's own ranking and once on the fused ranking the product returns - and the difference between those
 * two blocks is the fusion's contribution to every aggregation at once. A single block would have to choose, and the
 * choice would be invisible in the numbers.
 */
export function armComparison(
  rows: readonly LcaRowScore[],
  options: {
    readonly shipped?: string;
    readonly seed?: number;
    readonly resamples?: number;
    readonly reading?: FileArmReading;
  } = {},
): ArmComparison[] {
  const shipped = options.shipped ?? SHIPPED_AGGREGATION;
  const fused = options.reading === 'fused';
  // **The two readings differ only in which field is read**, and they are read through one pair of accessors so that a
  // comparison cannot accidentally pair one arm's pool figure with another arm's fused one.
  const figure = (arm: FileArmScore): number | null => (fused ? arm.fusedMap : arm.map);
  const position = (arm: FileArmScore): number | null =>
    fused ? arm.fusedAnswerRank : arm.answerRank;
  const present: string[] = [];
  for (const row of rows) {
    for (const arm of row.fileArms ?? []) {
      if (!present.includes(arm.aggregation)) present.push(arm.aggregation);
    }
  }

  return present.map((aggregation) => {
    const deltas: number[] = [];
    const arms: number[] = [];
    const controls: number[] = [];
    let firstPlaced = 0;
    let found = 0;
    for (const row of rows) {
      if (row.skipped !== null) continue;
      const arm = row.fileArms?.find((entry) => entry.aggregation === aggregation);
      if (arm === undefined) continue;
      const own = figure(arm);
      // **A row without the requested figure is not a row with a zero.** Rows written before the fused reading existed
      // are excluded here rather than counted as a ranking that found nothing.
      if (own === null || typeof own !== 'number') continue;
      const rank = position(arm);
      if (rank !== null && rank !== undefined) found += 1;
      if (rank === 1) firstPlaced += 1;
      const control = row.fileArms?.find((entry) => entry.aggregation === shipped);
      if (control === undefined) continue;
      const controlFigure = figure(control);
      if (controlFigure === null || typeof controlFigure !== 'number') continue;
      arms.push(own);
      controls.push(controlFigure);
      deltas.push(own - controlFigure);
    }

    if (deltas.length === 0) {
      return {
        aggregation,
        rows: 0,
        map: null,
        control: null,
        delta: null,
        wins: 0,
        losses: 0,
        ties: 0,
        lower: null,
        upper: null,
        pValue: null,
        firstPlaced,
        found,
      };
    }

    const counts = countOf(deltas);
    const interval = bootstrapOf(deltas, options);
    return {
      aggregation,
      rows: deltas.length,
      map: mean(arms),
      control: mean(controls),
      delta: round4(mean(deltas)),
      ...counts,
      lower: interval.lower,
      upper: interval.upper,
      pValue: round4(signTest(counts.wins, counts.losses)),
      firstPlaced,
      found,
    };
  });
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
export interface LanguagePairing extends PairedMeans {
  readonly config: string;
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
export function pairedByLanguage(
  parts: readonly LanguagePart[],
  control: ControlReading = BM25_MAP,
): LanguagePairing[] {
  return parts.map((part) => ({ config: part.config, ...pairedMeans(part.rows, control) }));
}
