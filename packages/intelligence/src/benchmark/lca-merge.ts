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

import { mean } from './lca-instrument.js';

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
  /** The first ten of them, in the corpus's coordinate system. */
  readonly offeredPaths: readonly string[];
  /** The sentence that refused this instance, or `null` when it was measured. */
  readonly skipped: string | null;
  /**
   * Metrics at each cut, keyed `at1`, `at3`, ... **Absent on a skipped row.**
   *
   * **The artifact's own addresses**, because the gate, the documentation and the audit all quote
   * `retrieval.at10.recall`: a figure whose address moved between the part and the artifact is a figure with two names,
   * and the reader who greps for one of them finds nothing.
   */
  readonly retrieval: Readonly<Record<string, ArmMetrics>>;
  /** What the model cited, or `null` when no provider was present. */
  readonly answer: ArmMetrics | null;
}

/** One language split, as one job measured it. */
export interface LanguagePart {
  readonly config: string;
  readonly measuredAt: string;
  readonly rowLimit: number;
  /** Whether the answer arm ran at all in this part. */
  readonly answerArm: boolean;
  /** The bounds the run applied, carried through to the merged artifact. */
  readonly bounds: {
    readonly capFiles: number;
    /** The largest instance the remaining memory allowed when the part started. */
    readonly memoryFiles: number;
    readonly mbPerFile: number;
    readonly reserveMb: number;
    readonly budgetMs: number;
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

/** A cut's worth of an arm, plus what the sample size was. */
export interface LanguageSummary {
  readonly config: string;
  readonly rows: number;
  readonly measured: number;
  readonly skipped: number;
  readonly retrieval: Readonly<Record<string, ArmScore>>;
  readonly answer: ArmScore | null;
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
    answer: part.answerArm ? armScore(measured, (row) => row.answer) : null,
  };
}

/** What several parts add up to: the union of their rows, aggregated once. */
export interface Combined {
  /** The mean over every instance any part measured. **The figure the gate reads.** */
  readonly overall: {
    readonly rows: number;
    readonly measured: number;
    readonly skipped: number;
    readonly retrieval: Readonly<Record<string, ArmScore>>;
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
      measured: measured.length,
      skipped: allRows.length - measured.length,
      retrieval: retrievalOf(measured, cuts),
      answer,
    },
    byLanguage,
  };
}
