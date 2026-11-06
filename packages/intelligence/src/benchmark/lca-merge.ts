// @code-analyzer/intelligence — combining the per-language halves of one measurement
//
// **Why the measurement is written in pieces.** Long Code Arena publishes three language splits, and one job that
// analyses all three in one process has never finished: the harness's own probe measured V8 returning heap to itself
// and not to the operating system, so the run costs the high-water mark of every instance it has analysed rather than
// the largest one, and the job that was cancelled six times was cancelled by the sixth medium repository rather than by
// an enormous one. **One job per language is therefore the unit of work**, each with its own memory, and a language
// that dies costs its own rows instead of the whole figure.
//
// **The pieces have to add up to the same number a single run would have produced**, and that is the whole content of
// this module. The authors' metric is a mean over instances, so the mean of the pieces weighted by their instance
// counts is the mean over the union - **exactly, not approximately, provided the pooling happens over rows and not over
// rounded means.** That distinction is why a part carries one metrics record per instance per cut instead of the four
// rounded averages a single-language artifact would have shown: the merged figure is computed from the rows, and every
// figure in it is rounded once.

import { MEASURED_MB_PER_FILE, mean } from './lca-instrument.js';

import type { ControlResult } from './lca-baseline.js';
import type { FallbackResult } from './lca-fallback.js';
import type { FusionAtK, FusionResult } from './lca-fusion.js';

/** The seven figures the authors' `get_quality_metrics` produces, for one instance or as a mean. */
export interface ArmMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly fpr: number;
  readonly allCorrect: number;
  readonly atLeastOneCorrect: number;
  readonly allIncorrect: number;
}

/** An {@link ArmMetrics} aggregated over the instances that produced one. */
export interface ArmScore extends ArmMetrics {
  /** How many instances were averaged. **A mean over none is not a score**, and the gate refuses one. */
  readonly rows: number;
}

/** What one instance cost the runner, as the supervisor observed it. */
export interface InstanceCost {
  /** The largest resident set the parent sampled over the whole process group, in megabytes. */
  readonly peakRssMb: number;
  /** Wall clock, from spawn to close. */
  readonly elapsedMs: number;
}

/** One instance, as the measurement recorded it. **Everything needed to explain a zero lives here.** */
export interface LcaRowScore {
  readonly id: number;
  readonly repo: string;
  /** How many files of the configuration's extension the checkout holds. */
  readonly corpusFiles: number;
  /** How many files the fixing commit changed. */
  readonly expectedFiles: number;
  /** How many of those fall outside the answer space - the ceiling the restriction puts on recall. */
  readonly expectedOutside: number;
  /** How many candidates the retriever offered inside the answer space. */
  readonly offered: number;
  /** How many of its candidates the answer space removed. **Published, never silently dropped.** */
  readonly outside: number;
  /**
   * Where the first fixing file sits in our own ranking, counting from one, or `null` when it is not in the list.
   *
   * **The diagnosis MAP cannot make.** `netflix/dgs-framework` scored 0.439 against a control at 1.000 with every
   * answer inside our list: not a retrieval failure, a ranking failure, and only this column says so. `null` on a
   * refused row, because a refused row produced no ranking to ask about.
   */
  readonly answerRank: number | null;
  /** The first ten of them, in the corpus's coordinate system. */
  readonly offeredPaths: readonly string[];
  /**
   * The bytes the answer space holds, or `null` when the instance never got as far as counting them.
   *
   * **Published because the bounds are calibrated against it.** Iteration 69 measured peak memory per corpus file
   * spanning 1.3 MB to 430 MB, which is what a `constant × files` estimate cannot express; the fit that replaces it
   * needs the quantity it regresses on, in the artifact, per row.
   */
  readonly corpusBytes: number | null;
  /** How many of the answer space's files could not be stat'ed. **A non-zero count excludes the row from the fit.** */
  readonly corpusUnreadable: number;
  /**
   * The bytes of every file the pipeline walked, or `null` when the instance never counted them.
   *
   * **The second predictor, and the reason there are two.** Peak memory regressed on the *answer space* explained 39 %
   * of the variance with a 2 113 MB worst miss: `appium/appium` has 52 Java files and 122 KB of them and cost 3 074 MB,
   * because the pipeline parses the whole checkout rather than the corpus's extension. Both columns are published so the
   * artifact can say which one the work actually tracks.
   */
  readonly checkoutBytes: number | null;
  /** How many of the checkout's files could not be stat'ed. */
  readonly checkoutUnreadable: number;
  /**
   * How many nodes the analysis put in the graph, or `null` when it never ran.
   *
   * **The third predictor, and the first mechanistic one.** The two byte totals failed: the checkout's bytes are
   * dominated by assets the pipeline never parses (`android/compose-samples` walks 126 MB and costs 674 MB, while
   * `square/leakcanary` walks 38 MB and costs 385 MB), and R² came out at 0.007. What resident memory actually holds
   * is the graph - one object per declaration, one per edge - so the count of those is the quantity to try, and it is
   * the quantity the analysis itself knows.
   */
  readonly graphNodes: number | null;
  /** How many edges the analysis put in the graph. */
  readonly graphEdges: number | null;
  /** What the instance cost, or `null` when it did not run (refused before the spawn). */
  readonly cost: InstanceCost | null;
  /**
   * The control's average precision on this instance, **or `null` when it could not be computed at all**.
   *
   * **Present on refused rows as well as measured ones, and that is the entire point.** The thirteen instances the bounds
   * refuse are the large repositories, which are the hardest - so a mean over the ones that ran is a mean over the easy
   * half of the corpus. BM25 needs no parser and no graph, so it ranks the checkout the product never got to parse,
   * and the difference between the two rankings on the instances where both exist is a comparison in which repository
   * size cannot be the explanation.
   *
   * **`null` means the control did not run**, which is different from a control that scored zero; `lca-sample.ts`
   * excludes the row from the paired comparison rather than pairing it against a zero.
   */
  readonly bm25: ControlResult | null;
  /**
   * **A second control over the same index**, so that the figure this project now optimises against is not one scorer's
   * opinion. `bm25` is the paper's own row and the comparator the shipped reading was chosen against; TF-IDF reads the
   * same documents with a different weighting, so it answers the question a reader is entitled to ask - **is the gap a
   * property of lexical retrieval, or of the one formula the choice was tuned against**.
   *
   * `null` under the same rule as `bm25`: the control did not run, which is not the same as a control that scored zero.
   */
  readonly tfidf: ControlResult | null;
  /**
   * **The product's file-level fallback: path and imports, ranked on every instance the run reached.**
   *
   * `bm25` and `tfidf` are controls and this is not one - it is what the product does when the checkout is too large for
   * the analyser, so it produces a figure where the product would otherwise produce a refusal. **It is the only column
   * whose denominator is every attempted instance**, which is what makes it the one number that can be placed beside a
   * published table measured over fifty instances per split.
   *
   * `null` only when the instance had no answer space to rank (the checkout could not be fetched), which is a different
   * fact from a fallback that scored zero.
   */
  readonly fallback: FallbackResult | null;
  /**
   * **The product's ranking as it actually returns it: the declaration arm fused with the file-level one.**
   *
   * `map` is the fused figure on a measured row and `0` on a refused one, because a refused row produced no ranking at
   * all; this field is the same quantity **on every instance the run reached**, obtained by declining to the file-level
   * arm where the analysis was refused. `fused` says which of the two produced it, per row, because a column that
   * averaged the two kinds together without saying so could be quoted as something it is not.
   */
  readonly fusion: FusionResult | null;
  /**
   * **The declaration arm alone**, on a measured row: the same pool and the same aggregation, with no second arm fused.
   *
   * The ablation of the fusion is this column subtracted from `map` on the same rows - a paired difference over one run
   * rather than a comparison between two commits, which is the only form in which "the fusion helped" is a measurement.
   * `null` on a refused row, like every other column that needs a pool.
   */
  readonly declarationMap: number | null;
  /**
   * Where the first fixing file sits **in that same declaration-only ranking**.
   *
   * The armature in `fileArms` reproduces the pool's ranking, and a reproduction that is checked on average precision
   * alone can be right about the figure and wrong about the order - two lists can share a mean precision while disagreeing
   * about which file comes first. This is the armature's second half, and it is the row's own column for the pool.
   */
  readonly declarationRank: number | null;
  /**
   * **The same two arms fused at every constant the ladder states**, on this instance.
   *
   * The figure the product publishes is one point on this curve. Publishing the curve costs four more reciprocal-rank
   * passes over a list of a couple of hundred paths - against an analysis measured in minutes - and it answers the one
   * question the shipped constant cannot: whether the shipped constant sits on a plateau or on a slope. **A constant chosen by the
   * best row of this corpus would be a constant fitted to it**, so the ladder is fixed in advance and the artifact
   * publishes every rung of it rather than the winner.
   *
   * Empty on a refused row, like every other column that needs a pool.
   */
  readonly fusionByK: readonly FusionAtK[];
  /**
   * The fused ranking, in full and to the metric's depth, **in the corpus's coordinate system**.
   *
   * Published rather than kept because two questions the artifact asks cannot be answered from a ten-entry preview: does
   * the fusion's gain come from the file-level arm promoting paths the pool never ranked, and does the answer sit in the
   * fused list at all. Empty on a refused row.
   */
  readonly rankedPaths: readonly string[];
  /** The sentence that refused this instance, or `null` when it was measured. */
  readonly skipped: string | null;
  /**
   * The same ranked pool read as a ranking of **files** under every aggregation the product knows how to apply.
   *
   * **The conversion from declarations to files is a choice, and a choice nobody measured is a second ranking
   * function.** The retrieval stage scores declarations; the corpus asks which files must change; the product has
   * always taken a file's position to be the position of its earliest declaration, which is the `max` of its scores
   * and nothing else about the file. `search/file-ranking.ts` states the alternatives and the armature publishes all of
   * them on **the same rows**, so the answer to "should a file be read as its best declaration or as the union of
   * them" is a paired difference on real instances rather than a preference.
   *
   * `null` on a refused row, because a refused row produced no pool to read.
   */
  readonly fileArms: readonly FileArmScore[] | null;
  /**
   * Metrics at each cut, keyed `at1`, `at3`, ... **Absent on a skipped row.**
   *
   * **The artifact's own addresses**, because the gate, the documentation and the audit all quote
   * `retrieval.at10.recall`: a figure whose address moved between the part and the artifact is a figure with two names,
   * and the reader who greps for one of them finds nothing.
   */
  readonly retrieval: Readonly<Record<string, ArmMetrics>>;
  /**
   * Average precision over the retriever's own pool, **the column the published baselines report**.
   *
   * `0` on a skipped row, which is excluded from every mean by `skipped !== null` and never averaged as a zero.
   */
  readonly map: number;
  /** What the model cited, or `null` when no provider was present. */
  readonly answer: ArmMetrics | null;
}

/** One file aggregation's figures on one instance. **The same pool, read five ways.** */
export interface FileArmScore {
  /** Which reading of a file's declarations produced this, from `search/file-ranking.ts`. */
  readonly aggregation: string;
  /** Average precision of the resulting file ranking, over the retriever's whole pool. */
  readonly map: number;
  /** Where the first fixing file sits in it, or `null` when the file is not in the ranking at all. */
  readonly answerRank: number | null;
  /**
   * The same reading of the pool **with the file-level arm fused into it**, which is the ranking the product returns.
   *
   * **Two readings, because the product has two arms and only one of them is the pool.** After iteration 77 the figure
   * the product publishes is a reciprocal-rank fusion of this arm with the file-level one, so an armature that published
   * only the pool's own average precision would describe a ranking nothing ships - and every comparison it printed
   * would be a comparison of four candidates and a control, none of which is the product. `map` stays the pool's figure
   * (it is the ablation of the fusion, and the aggregation question can be asked without it), and this is the figure the
   * product's own column must equal on every row.
   */
  readonly fusedMap: number;
  /** Where the first fixing file sits in the fused ranking, or `null` when it is not in it. */
  readonly fusedAnswerRank: number | null;
}

/** One language split, as one job measured it. */
export interface LanguagePart {
  readonly config: string;
  readonly measuredAt: string;
  readonly rowLimit: number;
  /**
   * How many instances this part intended to examine.
   *
   * **Separate from `rowLimit`, because a split can be shorter than the limit and a budget can be spent before the last
   * row is reached.** The two are the numerator and the denominator of two different claims - "we measured 24 of the 35
   * we examined" and "we examined 35 of the 50 the protocol asks for" - and a part that published only `rowLimit` would
   * make the second one unanswerable.
   */
  readonly planned: number;
  /** Whether the answer arm ran at all in this part. */
  readonly answerArm: boolean;
  /** The bounds the run applied, carried through to the merged artifact. */
  readonly bounds: {
    readonly capFiles: number;
    /** The largest instance the remaining memory allowed when the part started, **at {@link declarationsPerFile}**. */
    readonly memoryFiles: number;
    /**
     * The same bound in declarations, **which is what the memory actually pays for**.
     *
     * The round that added this had to: the artifact published a file bound computed at 3.7 MB per file, the run's own
     * regression scored that rate at `R² = -0.02`, and nothing in the part stated the quantity the fit found
     * (`R² = 0.77`, 22 KB per declaration, 515 MB fixed). A part that publishes a bound has to publish its units.
     */
    readonly memoryDeclarations?: number;
    /** The density the file bound was converted at. **A conversion whose rate is unstated cannot be rechecked.** */
    readonly declarationsPerFile?: number;
    readonly mbPerDeclaration?: number;
    readonly fixedMb?: number;
    readonly marginMb?: number;
    /** The file bound at every rung of the stated density ladder, **so the decision's sensitivity travels with it**. */
    readonly fileLadder?: ReadonlyArray<{
      readonly declarationsPerFile: number;
      readonly files: number;
    }>;
    /** The superseded rate, **retained because the report still scores it against the model that replaced it**. */
    readonly mbPerFile: number;
    readonly reserveMb: number;
    readonly budgetMs: number;
    /**
     * The resident ceiling a single instance's process may reach, **enforced by the supervisor**.
     *
     * Iteration 69 added this because every earlier bound was a statement about the machine while the analysis runs in
     * a process: `memoryFiles` was computed from sixteen gigabytes of runner and the process holding the result was
     * capped at four gigabytes of heap.
     */
    readonly instanceRssCapMb: number;
    /** The child's own heap flag, so a heap exhaustion is a named error rather than a kill. */
    readonly instanceHeapMb: number;
    /** How long one instance may run. */
    readonly instanceTimeoutMs: number;
  };
  readonly space: { readonly semantic: boolean; readonly reason: string };
  readonly configuration: Record<string, unknown>;
  readonly rows: readonly LcaRowScore[];
}

/** One arm, aggregated: the instances averaged, and the mean of each figure over them. */
export interface ArmAggregate extends ArmScore {
  /** Instances the part examined, measured or skipped. */
  readonly examined: number;
  /** Instances the bound refused. */
  readonly skipped: number;
}

/** A row that was not measured, **with the sentence that refused it** - the two are written together or not at all. */
export function skippedRow(input: {
  id: number;
  repo: string;
  corpusFiles: number;
  expectedFiles: number;
  because: string;
  /** The bytes the answer space held, when the caller counted them before refusing. */
  corpusBytes?: number | null;
  corpusUnreadable?: number;
  checkoutBytes?: number | null;
  checkoutUnreadable?: number;
  graphNodes?: number | null;
  graphEdges?: number | null;
  /** The control's figure, **which a refused instance can have even though it has no ranking of ours**. */
  bm25?: ControlResult | null;
  /** The second control's figure, on the same rule. */
  tfidf?: ControlResult | null;
  /** The product's fallback ranking, **which a refused instance has by construction**. */
  fallback?: FallbackResult | null;
  /** The product's ranking on these instances: **the file-level arm alone, because the declaration arm was refused**. */
  fusion?: FusionResult | null;
  /** What the instance cost before it was stopped, when it was stopped rather than refused up front. */
  cost?: InstanceCost | null;
}): LcaRowScore {
  return {
    id: input.id,
    repo: input.repo,
    corpusFiles: input.corpusFiles,
    expectedFiles: input.expectedFiles,
    expectedOutside: 0,
    offered: 0,
    outside: 0,
    answerRank: null,
    offeredPaths: [],
    corpusBytes: input.corpusBytes ?? null,
    corpusUnreadable: input.corpusUnreadable ?? 0,
    checkoutBytes: input.checkoutBytes ?? null,
    checkoutUnreadable: input.checkoutUnreadable ?? 0,
    graphNodes: input.graphNodes ?? null,
    graphEdges: input.graphEdges ?? null,
    cost: input.cost ?? null,
    bm25: input.bm25 ?? null,
    tfidf: input.tfidf ?? null,
    fallback: input.fallback ?? null,
    fusion: input.fusion ?? null,
    declarationMap: null,
    declarationRank: null,
    fusionByK: [],
    rankedPaths: [],
    skipped: input.because,
    fileArms: null,
    retrieval: {},
    map: 0,
    answer: null,
  };
}

/**
 * What resident memory costs per byte of source, fitted rather than assumed.
 *
 * **The number this replaces was a constant, and the evidence against it is a spread of 330×.** Every bound in the
 * harness was `constant × files`: a 2 000-file cap, a `3.7 MB per file` memory estimate, and a `ms per file` clock.
 * Measured over the 23 instances that produced a peak, memory per corpus file ranged from 1.3 MB to 430 MB, and the
 * clock was eighteen times its own estimate on `microsoft/deepspeed`. **A constant cannot be recalibrated into a
 * model**; what replaces it is a line fitted to the rows that ran, published with its residual so that its own accuracy
 * is a number in the artifact instead of a claim in a comment.
 */
export interface CostFit {
  /** Rows the fit was computed over. **A line through fewer than three points is a line through noise.** */
  readonly rows: number;
  /** Resident megabytes an instance of zero bytes costs - the runtime, before any source is read. */
  readonly interceptMb: number;
  /** Resident megabytes per byte of source. **Multiply by `corpusBytes` and add the intercept.** */
  readonly mbPerByte: number;
  /** Mean absolute distance from the line, in megabytes. */
  readonly meanResidualMb: number;
  /** The worst single miss, in megabytes - **the number that says whether the ceiling can be trusted**. */
  readonly maxResidualMb: number;
  /** The spread the constant could not express: MB per corpus file, over the same rows. */
  readonly mbPerFile: { readonly min: number; readonly median: number; readonly max: number };
  /** The same for the clock: milliseconds per corpus file. */
  readonly msPerFile: { readonly min: number; readonly median: number; readonly max: number };
  /**
   * How much of the variation the predictor explains, **and it is published because it decides whether the line may
   * set a ceiling**.
   *
   * A constant times the file count scored **-0.395** on these instances: worse than predicting the mean, which is what
   * a model has to beat before it is trusted with a bound. A fit at 0.9 is a ceiling; a fit at 0.4 is a hint.
   */
  readonly r2: number;
  /**
   * The R² of the model that ships today - `3.7 MB × corpusFiles` - evaluated on the same rows.
   *
   * **A fixed model can score below zero and a fitted one cannot**, so this is the only negative figure the artifact
   * will publish, and it is the bar the fit has to clear: on the 24 instances measured, the constant scored **-0.395**,
   * which is worse than predicting the average cost of every instance.
   */
  readonly constantR2: number;
  /** Which quantity the fit regressed on, so the number is not read without its variable. */
  readonly predictor: 'answerSpaceBytes' | 'checkoutBytes' | 'graphNodes';
}

/** Which column of a row a cost fit reads, and how many of its files could not be read. */
export interface CostPredictor {
  readonly name: CostFit['predictor'];
  readonly of: (row: LcaRowScore) => { readonly x: number | null; readonly unreadable: number };
}

/** The answer space: what the corpus scores, and **not** what the pipeline reads. */
export const ANSWER_SPACE_BYTES: CostPredictor = {
  name: 'answerSpaceBytes',
  of: (row) => ({ x: row.corpusBytes, unreadable: row.corpusUnreadable }),
};

/** The whole checkout: what the pipeline reads, and **not** what the corpus scores. */
export const CHECKOUT_BYTES: CostPredictor = {
  name: 'checkoutBytes',
  of: (row) => ({ x: row.checkoutBytes, unreadable: row.checkoutUnreadable }),
};

/**
 * The graph the analysis built: **the first predictor that names the thing memory actually holds**.
 *
 * A byte total is a proxy for the work. A node count is the work: every declaration and every edge in the graph is an
 * object the process keeps until it closes, and a run that costs three gigabytes has three gigabytes of objects rather
 * than three gigabytes of source. `unreadable` is always zero because a count of objects is either known or absent.
 */
export const GRAPH_NODES: CostPredictor = {
  name: 'graphNodes',
  of: (row) => ({ x: row.graphNodes, unreadable: 0 }),
};

/** The median of a non-empty list, averaging the two middles of an even one. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Fit resident memory and wall clock against the size of the answer space.
 *
 * **Least squares over the rows that have all three numbers**, which is a smaller set than the rows that ran: a row
 * with an unreadable file has a byte count that is short by an unknown amount, and a row with no cost never ran. The
 * two exclusions are stated in `rows` rather than applied silently.
 *
 * **`null` under three rows.** A line through two points passes through both of them and has no residual to publish, so
 * reporting one would be reporting a perfect fit that proves nothing.
 */
export function fitCost(
  rows: readonly LcaRowScore[],
  predictor: CostPredictor = ANSWER_SPACE_BYTES,
): CostFit | null {
  // **Only the rows that finished, because a stopped instance is a censored observation.** A row killed at the resident
  // ceiling has `peakRssMb` equal to the ceiling rather than to its cost, and a row killed at the clock has
  // `elapsedMs` equal to the clock: both are lower bounds, and fitting a line through them would pull it down by
  // exactly the amount the bound clipped. The refusals are not lost - each carries the sentence that stopped it - but
  // they cannot be points in a regression that is used to choose the bound.
  const usable = rows.filter((row) => {
    if (row.skipped !== null || row.cost === null) return false;
    const read = predictor.of(row);
    return read.x !== null && read.unreadable === 0;
  });
  if (usable.length < 3) return null;

  const xs = usable.map((row) => predictor.of(row).x!);
  const ys = usable.map((row) => row.cost!.peakRssMb);
  const n = xs.length;
  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < n; index += 1) {
    covariance += (xs[index]! - meanX) * (ys[index]! - meanY);
    variance += (xs[index]! - meanX) ** 2;
  }
  // **A vertical line has no slope and no useful answer**: every instance read the same number of bytes, which is a
  // sample that cannot say what a byte costs. Reporting the mean as an intercept would be a fit that claims one.
  if (variance === 0) return null;
  const mbPerByte = covariance / variance;
  const interceptMb = meanY - mbPerByte * meanX;

  const residuals = usable.map((_, index) =>
    Math.abs(interceptMb + mbPerByte * xs[index]! - ys[index]!),
  );
  // **`R²` against the mean, because that is the bar a model has to clear to be a model.** A negative figure means the
  // line is worse than predicting the average cost of every instance, which is what the constant it replaces scores.
  const totalSum = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const residualSum = usable.reduce(
    (sum, _, index) => sum + (interceptMb + mbPerByte * xs[index]! - ys[index]!) ** 2,
    0,
  );
  const perFile = usable.map((row) => row.cost!.peakRssMb / Math.max(row.corpusFiles, 1));
  const perFileMs = usable.map((row) => row.cost!.elapsedMs / Math.max(row.corpusFiles, 1));

  return {
    rows: n,
    interceptMb,
    mbPerByte,
    meanResidualMb: residuals.reduce((sum, value) => sum + value, 0) / n,
    maxResidualMb: Math.max(...residuals),
    mbPerFile: { min: Math.min(...perFile), median: median(perFile), max: Math.max(...perFile) },
    msPerFile: {
      min: Math.min(...perFileMs),
      median: median(perFileMs),
      max: Math.max(...perFileMs),
    },
    // **A sample with no variation in the outcome has nothing to explain**, and `0/0` is reported as no explanation
    // rather than as a perfect one.
    r2: totalSum === 0 ? 0 : 1 - residualSum / totalSum,
    constantR2:
      totalSum === 0
        ? 0
        : 1 -
          usable.reduce(
            (sum, row) => sum + (MEASURED_MB_PER_FILE * row.corpusFiles - row.cost!.peakRssMb) ** 2,
            0,
          ) /
            totalSum,
    predictor: predictor.name,
  };
}

/** Both predictors, and which one the artifact recommends - **the choice is made by `R²`, not by preference**. */
export interface CostModels {
  readonly byAnswerSpace: CostFit | null;
  readonly byCheckout: CostFit | null;
  readonly byGraphNodes: CostFit | null;
  /** The fit with the highest `R²`, or `null` when none could be computed. **Ties go to the later predictor**, because
   * a mechanistic quantity is worth more than a proxy that happened to fit. */
  readonly recommended: CostFit | null;
}

/** Fit both predictors over the same rows, so the artifact can say which one tracks the work. */
export function costModels(rows: readonly LcaRowScore[]): CostModels {
  const byAnswerSpace = fitCost(rows, ANSWER_SPACE_BYTES);
  const byCheckout = fitCost(rows, CHECKOUT_BYTES);
  const byGraphNodes = fitCost(rows, GRAPH_NODES);
  let recommended: CostFit | null = null;
  for (const fit of [byAnswerSpace, byCheckout, byGraphNodes]) {
    if (fit === null) continue;
    if (recommended === null || fit.r2 >= recommended.r2) recommended = fit;
  }
  return { byAnswerSpace, byCheckout, byGraphNodes, recommended };
}

/** A cut's worth of an arm, plus what the sample size was. */
export interface LanguageSummary {
  readonly config: string;
  readonly rows: number;
  readonly measured: number;
  readonly skipped: number;
  readonly retrieval: Readonly<Record<string, ArmScore>>;
  /** Mean average precision over the instances that produced one, `null` when none did. */
  readonly map: MapScore | null;
  readonly answer: ArmScore | null;
}

/** Mean average precision, with the count it was averaged over. **A mean over none is not a score.** */
export interface MapScore {
  readonly rows: number;
  readonly value: number;
}

/**
 * Average one column over the rows that produced it.
 *
 * **A skipped row has no ranking**, so it is excluded rather than counted as zero: a zero that means "the runner
 * refused this instance" and a zero that means "the retriever found nothing" are different facts, and only the second
 * belongs in a mean.
 */
export function mapScore(rows: readonly LcaRowScore[]): MapScore | null {
  const measured = rows.filter((row) => row.skipped === null);
  if (measured.length === 0) return null;
  return { rows: measured.length, value: mean(measured.map((row) => row.map)) };
}

/**
 * Average one arm over the rows that produced it, **over rows rather than over pre-rounded means**.
 *
 * A skipped row has no metrics and is excluded; a row whose arm is `null` (no provider, so nothing was cited) is
 * excluded and the count says so. The two exclusions are different questions - "the runner refused this instance" and
 * "this arm did not run" - and both are answered by {@link ArmScore.rows} rather than by a silently smaller sample.
 */
export function armScore(
  rows: readonly LcaRowScore[],
  pick: (row: LcaRowScore) => ArmMetrics | null,
): ArmScore {
  const picked: ArmMetrics[] = [];
  for (const row of rows) {
    if (row.skipped !== null) continue;
    const metrics = pick(row);
    if (metrics !== null) picked.push(metrics);
  }
  return {
    rows: picked.length,
    precision: mean(picked.map((metrics) => metrics.precision)),
    recall: mean(picked.map((metrics) => metrics.recall)),
    f1: mean(picked.map((metrics) => metrics.f1)),
    fpr: mean(picked.map((metrics) => metrics.fpr)),
    allCorrect: mean(picked.map((metrics) => metrics.allCorrect)),
    atLeastOneCorrect: mean(picked.map((metrics) => metrics.atLeastOneCorrect)),
    allIncorrect: mean(picked.map((metrics) => metrics.allIncorrect)),
  };
}

/** Every cut the measurement reports, as arm scores over one set of rows, keyed as the artifact addresses them. */
function retrievalOf(
  rows: readonly LcaRowScore[],
  cuts: readonly number[],
): Record<string, ArmScore> {
  const arms: Record<string, ArmScore> = {};
  for (const cut of cuts)
    arms[`at${String(cut)}`] = armScore(rows, (row) => row.retrieval[`at${String(cut)}`] ?? null);
  return arms;
}

/** Aggregate one part on its own, which is what its own log line and the per-language table report. */
export function summarisePart(part: LanguagePart, cuts: readonly number[]): LanguageSummary {
  const measured = part.rows.filter((row) => row.skipped === null);
  return {
    config: part.config,
    rows: part.rows.length,
    measured: measured.length,
    skipped: part.rows.length - measured.length,
    retrieval: retrievalOf(measured, cuts),
    map: mapScore(measured),
    answer: part.answerArm ? armScore(measured, (row) => row.answer) : null,
  };
}

/** What several parts add up to: the union of their rows, aggregated once. */
export interface Combined {
  /** The mean over every instance any part measured. **The figure the gate reads.** */
  readonly overall: {
    readonly rows: number;
    /** How many instances the parts intended to examine, **the denominator of the protocol's own coverage**. */
    readonly planned: number;
    readonly measured: number;
    readonly skipped: number;
    readonly retrieval: Readonly<Record<string, ArmScore>>;
    readonly map: MapScore | null;
    readonly answer: ArmScore | null;
  };
  /** Each part on its own, keyed by its configuration, so a reader can see which language moved. */
  readonly byLanguage: Readonly<Record<string, LanguageSummary>>;
}

/**
 * Combine the parts into one figure.
 *
 * **The rows are concatenated and the mean is taken once.** That is the only way the combined figure can equal the
 * figure a single run would have produced, and it is why the parts carry per-instance metrics: averaging three
 * four-place means weights a language with two instances exactly as heavily as one with eight.
 */
export function combineParts(parts: readonly LanguagePart[], cuts: readonly number[]): Combined {
  const byLanguage: Record<string, LanguageSummary> = {};
  for (const part of parts) byLanguage[part.config] = summarisePart(part, cuts);

  const allRows = parts.flatMap((part) => part.rows);
  const measured = allRows.filter((row) => row.skipped === null);
  // **The answer arm exists only if some part ran it.** A part without a provider contributes no metrics rather than a
  // zero, which is the difference between "the model cited nothing" and "no model was asked".
  const answer = parts.some((part) => part.answerArm)
    ? armScore(measured, (row) => row.answer)
    : null;

  return {
    overall: {
      rows: allRows.length,
      planned: parts.reduce((sum, part) => sum + part.planned, 0),
      measured: measured.length,
      skipped: allRows.length - measured.length,
      retrieval: retrievalOf(measured, cuts),
      map: mapScore(measured),
      answer,
    },
    byLanguage,
  };
}
