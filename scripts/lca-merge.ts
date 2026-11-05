#!/usr/bin/env node
// Combine the per-language parts of the Long Code Arena measurement into the one figure the gate reads.
//
// **One job per language, one artifact.** The harness is sharded because a single process analysing three splits never
// finished (see `packages/intelligence/src/benchmark/lca-merge.ts` for the measurement that explains it), so each job
// writes `benchmarks/lca-parts/<config>.json` and this script adds them up. **The addition is over rows, not over the
// per-language means**: a mean of means weights a language with two measured instances exactly as heavily as one with
// eight, which would make the combined figure a statement about the sample sizes rather than about the retriever.
//
// **A missing part does not stop the combination, and it is named in the artifact.** A job that dies on Kotlin should
// cost the Kotlin column, not the Python and Java ones - and the reader has to be able to see which column is missing
// from the artifact alone, because the log of a cancelled job is the one place that information usually lives.
//
// Usage: npx tsx scripts/lca-merge.ts [--parts benchmarks/lca-parts] [--out benchmarks/lca-bug-localization.json]

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BM25_B,
  BM25_K1,
  BM25_MAX_DOCUMENTS,
  BM25_MAX_FILE_BYTES,
} from '../packages/intelligence/src/benchmark/lca-baseline.js';
import { LCA_CONFIGS, mean } from '../packages/intelligence/src/benchmark/lca-instrument.js';
import { combineParts, costModels } from '../packages/intelligence/src/benchmark/lca-merge.js';
import {
  armComparison,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  pairedByLanguage,
  pairedComparison,
  publishedRank,
  rankDiagnosis,
  sampleCoverage,
  standardisedMap,
  stratify,
  worstCaseMap,
} from '../packages/intelligence/src/benchmark/lca-sample.js';
import { FILE_AGGREGATION } from '../packages/intelligence/src/search/file-ranking.js';
import { recordArtifact } from '../packages/shared/src/benchmark/artifact.js';

import type { LanguagePart } from '../packages/intelligence/src/benchmark/lca-merge.js';

/** A flag's value, or the default when the flag is absent. */
function argumentOf(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined ? fallback : value;
}

const PARTS_DIR = argumentOf('--parts', 'benchmarks/lca-parts');
const OUT = argumentOf('--out', 'benchmarks/lca-bug-localization.json');
const CUTS = [1, 3, 5, 10] as const;

/**
 * The published MAP table, **transcribed from the paper with the protocol it was measured under**.
 *
 * Retrieval baselines rank every file in the repository by cosine distance; the chat baselines name one to five files
 * from the issue and the whole path list. This product's single arm is a hybrid retriever over an indexed repository,
 * which is the retrieval shape - so the retrieval rows are the ones a reader should compare against, and the chat rows
 * are here because the table is public and leaving out the row that beats everything would be the dishonest edit.
 */
const PUBLISHED_BASELINES = {
  metric: 'MAP',
  source: 'arXiv:2406.11612 §2.5 (Long Code Arena, NeurIPS 2024 D&B)',
  conditions: {
    instancesPerLanguage: 50,
    languages: ['py', 'java', 'kt'],
    note:
      'Retrieval baselines rank every file in the repository by cosine distance; the chat baselines name 1-5 files ' +
      'from the issue and the whole path list, chunked when it does not fit the context.',
  },
  rows: [
    { name: 'GPT-4 (chat)', map: 0.39, kind: 'chat' },
    { name: 'GTE (embedding)', map: 0.33, kind: 'retrieval' },
    { name: 'Mistral (embedding)', map: 0.3, kind: 'retrieval' },
    { name: 'TF-IDF (BPE)', map: 0.27, kind: 'retrieval' },
    // **A bound rather than a figure**: the paper says "lower than 0.25" for the rest, BM25 among them.
    { name: 'BM25 and the remaining models', map: 0.25, kind: 'retrieval', bound: 'below' },
  ],
} as const;

/**
 * Where this measurement stands in that table, **as a rank over the published rows plus the caveats that bound it**.
 *
 * **The rank is computed from the numbers and not from a sentence**, because the previous version of this comparison
 * lived in prose and drifted: a figure moved, the sentence did not. The caveats travel with it, so a reader who quotes
 * the rank has to quote the conditions with it.
 */
function comparisonOf(ours: number | null, label = 'measured'): Record<string, unknown> {
  if (ours === null) {
    return {
      metric: PUBLISHED_BASELINES.metric,
      ours: null,
      rank: null,
      why: 'no instance produced an average precision, so there is nothing to place in the table',
    };
  }
  // **A position, not a count, and the difference published a wrong claim.** This arithmetic used to live here and
  // returned the *number of rows beaten* under the name `rank`, so a figure that beat four of five rows published
  // `rank: 4` and was quoted as fourth when it was second. It is `publishedRank` in `lca-sample.ts` now, where it has
  // tests and where a table of known size can check a position.
  // **The table is transcribed with a `kind` and a `bound` string for the reader**, and `publishedRank` takes the two
  // fields it computes from - `bound` as a boolean, because a row published as "below 0.25" is a ceiling to be met
  // rather than a figure to be beaten.
  const placed = publishedRank(
    ours,
    PUBLISHED_BASELINES.rows.map((row) => ({
      name: row.name,
      map: row.map,
      ...('bound' in row ? { bound: true } : {}),
    })),
  );
  return {
    metric: PUBLISHED_BASELINES.metric,
    basis: label,
    ours,
    ...placed,
    caveats: [
      'The published figures are over all fifty instances per split; this one is over the rows the runner reached, ' +
        'and the measured count is beside it.',
      "Average precision here reads the retriever's own pool of two hundred candidates, which can only lose credit.",
      'The answer arm is not the chat baselines reproduced: it cites from the blocks the retriever selected rather ' +
        'than from the whole path list.',
    ],
  };
}

function readParts(): { parts: LanguagePart[]; missing: string[]; malformed: string[] } {
  const parts: LanguagePart[] = [];
  const missing: string[] = [];
  const malformed: string[] = [];
  const present = existsSync(PARTS_DIR) ? readdirSync(PARTS_DIR) : [];
  for (const config of LCA_CONFIGS) {
    const file = join(PARTS_DIR, `${config}.json`);
    if (!present.includes(`${config}.json`)) {
      missing.push(config);
      continue;
    }
    try {
      parts.push(JSON.parse(readFileSync(file, 'utf8')) as LanguagePart);
    } catch {
      // **A part that cannot be parsed is not a part that is absent**, and the artifact distinguishes them: one is a
      // job that did not run, the other is a job that ran and wrote something unreadable, and those want different
      // fixes.
      malformed.push(config);
    }
  }
  return { parts, missing, malformed };
}

function main(): void {
  const { parts, missing, malformed } = readParts();
  if (parts.length === 0) {
    console.error(
      `lca merge: no part could be read from ${PARTS_DIR} (absent: ${missing.join(', ') || 'none'}; ` +
        `unreadable: ${malformed.join(', ') || 'none'}) - there is nothing to combine and inventing a figure is not ` +
        'one of the options',
    );
    process.exit(1);
  }

  const combined = combineParts(parts, CUTS);
  const first = parts[0]!;
  const rowLimit = Math.max(...parts.map((part) => part.rowLimit));
  const allRows = parts.flatMap((part) => part.rows);

  // **The sample, described before any figure computed over it is published.** `planned` is what the run intended to
  // examine, `attempted` is what it reached, `measured` is what produced a ranking - three different denominators and
  // the only honest way to say "MAP over 24 rows" is with the other two beside it.
  const coverage = sampleCoverage(allRows, combined.overall.planned);
  const strata = stratify(allRows);
  const standardised = standardisedMap(strata);
  const paired = pairedComparison(allRows);
  // **The control over every row that has one**, which is a superset of the rows we measured: BM25 ranks the checkouts
  // the supervisor refused, so the control's coverage is not the product's coverage and the two are published apart.
  const controlRows = allRows
    .map((row) => row.bm25?.map)
    .filter((value): value is number => typeof value === 'number');
  // **One pair of means per language, over one set of rows.** This used to take ours over the measured rows and the
  // control's over every row that carried one, refused rows included - and refused rows are the large repositories,
  // which are the ones the control scores worst on. The Java leg of iteration 71 published **a 0.0037 win** from that
  // subtraction; over the same rows it is **a 0.102 loss**. `pairedByLanguage` is the repair, and the two figures it
  // returns are subtracted by the code rather than by the reader.
  const pairing = pairedByLanguage(parts);
  const controlByLanguage = Object.fromEntries(
    pairing.map((entry) => [
      entry.config,
      { rows: entry.rows, map: entry.control, ours: entry.ours, delta: entry.delta },
    ]),
  );
  // **Whether a small figure is a ranking problem or a missing answer.** Published for the same intersection the
  // pairing uses, because the two defects need different repairs and a MAP column reports them identically.
  const diagnosis = rankDiagnosis(allRows);
  // **The conversion from declarations to files, measured rather than chosen.** Five readings of the same pool, paired
  // on the same rows, with the shipped one first - and its own delta is zero by construction, which is the armature's
  // wiring check rather than a result.
  const fileRanking = { shipped: FILE_AGGREGATION, arms: armComparison(allRows) };
  const worst = worstCaseMap(allRows);
  // **Our mean restricted to the rows the control also scored**, because a paired difference printed beside an unpaired
  // mean invites the reader to subtract two numbers measured on different sets.
  const pairedOurs = allRows
    .filter((row) => row.skipped === null && typeof row.bm25?.map === 'number')
    .map((row) => row.map);

  const artifact = {
    comment: [
      "Bug localisation on **Long Code Arena** (Bogomolov et al., arXiv 2406.11612), the authors' own test split.",
      '',
      '**What the task is.** Given an issue and the repository at the commit where it reproduces, name the files that',
      'must change. **The ground truth is the fixing commit**, so nobody wrote it by hand.',
      '',
      "**The metric is the authors' own**, transcribed unchanged from",
      '`lca-baselines/bug_localization/src/baselines/metrics/quality_metrics.py`: set-based precision, recall, F1, FPR,',
      'all-correct, at-least-one-correct, all-incorrect, averaged over the instances that were measured.',
      '',
      '**Two arms.** `retrieval` is the fused list cut at k with **no model involved** - free, deterministic, and a',
      'change in it is a change in the retriever. `answer` is the file set the model *cited*, which is only produced',
      'when a provider is present; it is the same ruler applied to a different thing.',
      '',
      '**This is not the `filepath_imports` baseline reproduced.** That configuration shows the model every file path',
      'and the import graph; this product shows it the blocks a hybrid retriever selected. The published baselines and',
      'this figure answer the same question with different amounts of context, and the artifact reports the',
      'configuration rather than implying equivalence.',
      '',
      '**Why the retrieval arm leads with k and not with a chosen set size.** A set size picked after seeing the',
      'ground truth is a fit. The cuts are fixed in advance and all of them are published.',
      '',
      '**Why the figure is combined from parts.** One job measures one language split, because an analysis of a real',
      'checkout costs megabytes of resident memory per file and V8 does not return reclaimed pages to the operating',
      'system - three splits in one process was three times the accumulation, and that job never finished. **The',
      'combination is a mean over the pooled rows**, so it equals what a single run would have produced, and',
      '`byLanguage` shows which language moved.',
      '',
      '**The published baselines are a MAP table, so a MAP column is published beside the cuts.** The paper reports',
      '`GTE` 0.33, `Mistral` 0.30, `TF-IDF` 0.27, `BM25` under 0.25 and `GPT-4` 0.39, averaged over the same',
      'three splits - so `overall.map` is the only column here that can be placed beside them without a conversion',
      'somebody invented. **Two differences are stated rather than smoothed**: their figures are over all fifty',
      'instances per split and this one is over the rows a runner reached, and average precision here reads the',
      "retriever's own pool of two hundred candidates, which can only lose credit.",
    ],
    dataset: {
      name: 'JetBrains-Research/lca-bug-localization',
      configurations: [...LCA_CONFIGS],
      split: 'test',
      licence: 'Apache-2.0',
      metricSource:
        'github.com/JetBrains-Research/lca-baselines · bug_localization/src/baselines/metrics/quality_metrics.py',
      /** **Bogomolov et al. 2024, §2.5.** Transcribed with the sentence each number came from, because a table copied
       * without its protocol is a table nobody can check. */
      publishedBaselines: PUBLISHED_BASELINES,
    },
    measuredAt: new Date().toISOString().slice(0, 10),
    rowLimit,
    /** **Which parts this figure is made of**, because a column that is quietly missing reads like a column that was fine. */
    parts: {
      combined: parts.map((part) => part.config),
      absent: missing,
      unreadable: malformed,
    },
    fileCap: {
      files: first.bounds.capFiles,
      appliedTo: 'every file in the checkout except .git',
      memory: {
        mbPerFile: first.bounds.mbPerFile,
        reserveMb: first.bounds.reserveMb,
        budgetFilesAtStart: Object.fromEntries(
          parts.map((part) => [part.config, part.bounds.memoryFiles]),
        ),
        timeBudgetMs: first.bounds.budgetMs,
        instanceRssCapMb: first.bounds.instanceRssCapMb,
        instanceHeapMb: first.bounds.instanceHeapMb,
        instanceTimeoutMs: first.bounds.instanceTimeoutMs,
        note:
          'An instance is skipped when its checkout is above the stated cap, above what the remaining memory allows, ' +
          "or would end past the job's time budget; the row records which of the three refused it. **A measured " +
          'instance ran in its own process**, which is killed at `instanceRssCapMb` and `instanceTimeoutMs`, so a ' +
          'refusal names the ceiling that fired rather than the runner disappearing.',
      },
    },
    /** **The bound's own accuracy, measured rather than assumed.** Peak resident memory and wall clock, fitted against
     * the size of the answer space over the instances that ran. The refuse rules above are still `constant × files`,
     * and this block exists because the instances that ran show that constant is wrong in both directions: memory per
     * corpus file spans two orders of magnitude, and the clock was eighteen times its own estimate on one repository.
     * **The fit is published before the rule is changed**, so the change can be argued from the artifact. */
    costModel: {
      /** **Which quantity the work tracks**, decided by `R²` rather than by preference: the answer space the corpus scores
       * or the checkout the pipeline reads. */
      ...costModels(parts.flatMap((part) => part.rows)),
      note:
        'Least squares of peak resident megabytes on the bytes of the answer space, over the rows that ran, counted ' +
        'their bytes, and could read every file of them. `rows` is that sample rather than the row count. ' +
        '`mbPerFile` and `msPerFile` are the spread the constant could not express. **A row without `cost` never ran** ' +
        'and a row with `corpusUnreadable` above zero has a byte count short by an unknown amount, so neither is in ' +
        'the fit.',
    },
    /**
     * **What the sample was, before the figure over it is read.**
     *
     * The published table is a mean over fifty instances per split. This figure is a mean over the rows a runner
     * reached, and **the rows it did not reach are systematically the large repositories** - which are the ones with the
     * most candidates to rank and therefore the hardest. A number quoted without this block is a number about an
     * unknown population, which is the defect iteration 71 exists to close.
     */
    sample: {
      ...coverage,
      /** The measured mean with **every refused instance scored zero** - the lower bound nobody can argue with. */
      worstCaseMap: worst,
      /** The measured mean reweighted to the attempted population, and how much of that population the weights cover. */
      standardised,
      note:
        '`planned` is what the run intended to examine, `attempted` what it reached, `measured` what produced a ' +
        'ranking. **`ofAttempted` is the share of reached instances that were measured and `ofPlanned` the share of ' +
        'the protocol**; both are published because a refusal and a row the run never reached are different facts. ' +
        '`worstCaseMap` scores every refusal as zero, so it is a floor on what a run with no bounds at all would have ' +
        'scored, and `standardised` reweights the per-size-band means by the attempted counts so the figure estimates ' +
        'the population it was drawn from rather than the part of it that fitted.',
    },
    /**
     * **The control.** BM25 is one of the paper's own baseline rows, and it is the one thing here that can rank a
     * checkout the analysis was killed on: no parser, no graph, no model, just term counts over the answer space.
     *
     * **It is a control and it is not a reproduction.** The paper's BM25 row is their tokeniser over their index; this
     * one states its own parameters in `configuration` so the difference is a number in the artifact rather than an
     * assumption in a sentence. What it buys is `paired`: two rankings of the same files of the same repository at the
     * same commit, where repository size, language and issue difficulty cancel because both terms share them.
     */
    baseline: {
      name: 'BM25',
      configuration: {
        k1: BM25_K1,
        b: BM25_B,
        maxFileBytes: BM25_MAX_FILE_BYTES,
        maxDocuments: BM25_MAX_DOCUMENTS,
        tokeniser:
          'lower case, split on non-alphanumerics, then split at camel-case boundaries; tokens shorter than two ' +
          'characters and a stated list of function words are dropped',
        document: 'the answer space file, with its repository-relative path prefixed to its text',
        tieBreak:
          'path ascending, so the ranking is a function of the corpus rather than of the directory order',
      },
      overall: {
        rows: controlRows.length,
        map: controlRows.length === 0 ? null : mean(controlRows),
        /** Our own mean over exactly the rows the control scored, **so the two means are subtractable**. */
        oursPaired: pairedOurs.length === 0 ? null : mean(pairedOurs),
        oursPairedRows: pairedOurs.length,
      },
      byLanguage: controlByLanguage,
      note:
        'A control variate, not a reproduction of the paper’s BM25 row. Its value is that it measures the instances our ' +
        'analysis cannot run, so the difficulty of the unmeasured half of the corpus is a figure rather than a worry.',
    },
    /**
     * **The paired comparison**, which is the only figure here in which repository size cannot be the explanation.
     *
     * Wins and losses are counted per instance, the interval is a percentile bootstrap over instances with the seed
     * published, and the p-value is the **exact two-sided sign test** - an assumption-free test, which is the right one
     * for a bounded, skewed, twenty-four-point sample that no t-test should be pointed at.
     */
    paired,
    diagnosis,
    /**
     * **The same ranked pool read as a ranking of files five ways**, which is a choice the product made without
     * measuring it. `max` is what it ships and is listed first, so its delta is zero by construction and a non-zero one
     * is a wiring mistake the gate refuses; the other four are the alternatives, paired on the same rows.
     */
    fileRanking,
    /** The same comparison, split by how large a repository the instance was. **This is the table that answers
     * "is our sample easier than theirs".** */
    stratified: strata,
    answerArm: parts.some((part) => part.answerArm),
    cuts: CUTS.join(', '),
    configuration: first.configuration,
    space: first.space,
    overall: combined.overall,
    byLanguage: combined.byLanguage,
    /** **Where this figure stands against the published table**, computed rather than asserted. */
    comparison: comparisonOf(combined.overall.map?.value ?? null, 'measured'),
    /**
     * **The same ranking computed on the floor rather than on the mean.**
     *
     * If the ranking at the floor is the same as the ranking at the mean, the figure's position in the published table
     * does not depend on which half of the corpus the bounds let through - which is the strongest statement this
     * artifact can make, and it is made by arithmetic rather than by an assurance.
     */
    comparisonWorstCase: comparisonOf(worst, 'worstCase'),
    /** One entry per instance, so that a zero can be explained from the artifact alone. */
    rows: parts.flatMap((part) =>
      part.rows.map((row) => ({
        config: part.config,
        id: row.id,
        repo: row.repo,
        corpusFiles: row.corpusFiles,
        expectedFiles: row.expectedFiles,
        expectedOutside: row.expectedOutside,
        offered: row.offered,
        outside: row.outside,
        offeredPaths: row.offeredPaths,
        /** Where the first fixing file sits in our list, and in the control's. **One number each, same instance.** */
        answerRank: row.answerRank,
        /** Every reading of the pool, so a reader can recompute `fileRanking` from the rows. */
        fileArms: row.fileArms,
        bm25Rank: row.bm25 === null ? null : row.bm25.rank,
        bm25Top: row.bm25 === null ? null : row.bm25.ranked,
        corpusBytes: row.corpusBytes,
        corpusUnreadable: row.corpusUnreadable,
        checkoutBytes: row.checkoutBytes,
        checkoutUnreadable: row.checkoutUnreadable,
        graphNodes: row.graphNodes,
        graphEdges: row.graphEdges,
        bm25Map: row.bm25 === null ? null : row.bm25.map,
        bm25Documents: row.bm25 === null ? null : row.bm25.documents,
        peakRssMb: row.cost === null ? null : row.cost.peakRssMb,
        elapsedMs: row.cost === null ? null : row.cost.elapsedMs,
        map: row.map,
        skipped: row.skipped,
      })),
    ),
  };

  const recorded = recordArtifact(OUT, artifact);
  if (!recorded.written) {
    console.error(`lca merge: ${OUT} not written - ${recorded.because}`);
  }

  const at10 = combined.overall.retrieval['at10']!;
  const at1 = combined.overall.retrieval['at1']!;
  const oursMap = combined.overall.map;
  const summary =
    `LCA-BUG-LOC rows=${String(combined.overall.measured)}/${String(combined.overall.rows)} ` +
    `parts=${parts.map((part) => part.config).join('+')}` +
    `${missing.length > 0 ? ` missing=${missing.join(',')}` : ''} ` +
    `retrieval@10 P=${String(at10.precision)} R=${String(at10.recall)} F1=${String(at10.f1)} ` +
    `retrieval@1 R=${String(at1.recall)} ` +
    `map=${oursMap === null ? 'none' : String(oursMap.value)} ` +
    (combined.overall.answer === null
      ? 'answer=none'
      : `answer F1=${String(combined.overall.answer.f1)}`);
  console.log(summary);
  if (oursMap !== null) {
    // **The comparison as a line a reader can quote**, with the count it rests on beside it and the best published row
    // named, so the rank is not the only thing that travels.
    const best = PUBLISHED_BASELINES.rows.reduce((a, b) => (b.map > a.map ? b : a));
    console.log(
      `LCA-MAP ours=${String(oursMap.value)} rows=${String(oursMap.rows)} ` +
        `bestPublished=${best.name}@${String(best.map)} of=${String(PUBLISHED_BASELINES.rows.length)}`,
    );
  }
  // **The per-language pairing and the rank diagnosis on their own lines**, because these are the two figures the next
  // iteration is planned from: a language whose paired delta is negative has a ranking defect, and a language whose
  // medians are both deep has a corpus the text does not reach.
  for (const entry of pairing) {
    console.log(
      `LCA-PAIR ${entry.config} rows=${String(entry.rows)} ` +
        `ours=${entry.ours === null ? 'none' : entry.ours.toFixed(4)} ` +
        `control=${entry.control === null ? 'none' : entry.control.toFixed(4)} ` +
        `delta=${entry.delta === null ? 'none' : entry.delta.toFixed(4)}`,
    );
  }
  console.log(
    `LCA-RANK rows=${String(diagnosis.rows)} oursFound=${String(diagnosis.oursFound)} ` +
      `controlFound=${String(diagnosis.controlFound)} oursFirst=${String(diagnosis.oursFirst)} ` +
      `controlFirst=${String(diagnosis.controlFirst)} ` +
      `oursMedian=${diagnosis.oursMedian === null ? 'none' : String(diagnosis.oursMedian)} ` +
      `controlMedian=${diagnosis.controlMedian === null ? 'none' : String(diagnosis.controlMedian)}`,
  );
  // **The conversion from declarations to files, one line per reading of it.** `shipped` comes first and its delta is
  // the armature's control: a number other than zero there means the armature and the product disagree about what the
  // product does, which is a defect in the instrument rather than a finding about the retriever.
  for (const arm of fileRanking.arms) {
    console.log(
      `LCA-ARM ${arm.aggregation === fileRanking.shipped ? '*' : ' '}${arm.aggregation} ` +
        `rows=${String(arm.rows)} map=${arm.map === null ? 'none' : arm.map.toFixed(4)} ` +
        `shipped=${arm.control === null ? 'none' : arm.control.toFixed(4)} ` +
        `delta=${arm.delta === null ? 'none' : arm.delta.toFixed(4)} ` +
        `ci=[${arm.lower === null ? 'none' : arm.lower.toFixed(4)},` +
        `${arm.upper === null ? 'none' : arm.upper.toFixed(4)}] p=${arm.pValue === null ? 'none' : String(arm.pValue)} ` +
        `wins=${String(arm.wins)} losses=${String(arm.losses)} ties=${String(arm.ties)} ` +
        `first=${String(arm.firstPlaced)} found=${String(arm.found)}`,
    );
  }
  // **The cost model on its own line**, because a fit nobody reads is a fit nobody can act on: the slope, the residual
  // that says whether the ceiling can be trusted, and the spread that condemns the constant.
  for (const [name, fit] of [
    ['answerSpace', artifact.costModel.byAnswerSpace],
    ['checkout', artifact.costModel.byCheckout],
    ['graphNodes', artifact.costModel.byGraphNodes],
  ] as const) {
    if (fit === null) {
      console.log(`LCA-COST ${name} none`);
      continue;
    }
    console.log(
      `LCA-COST ${name} rows=${String(fit.rows)} r2=${fit.r2.toFixed(3)} constantR2=${fit.constantR2.toFixed(3)} ` +
        `intercept=${fit.interceptMb.toFixed(0)}MB mbPerByte=${fit.mbPerByte.toFixed(7)} ` +
        `residual=${fit.meanResidualMb.toFixed(0)}/${fit.maxResidualMb.toFixed(0)}MB ` +
        `mbPerFile=${fit.mbPerFile.min.toFixed(1)}/${fit.mbPerFile.median.toFixed(1)}/${fit.mbPerFile.max.toFixed(1)}`,
    );
  }
  console.log(`LCA-COST recommended=${artifact.costModel.recommended?.predictor ?? 'none'}`);

  // **The sample on its own line, before the figure.** Three denominators, because "MAP over 24" is only a statement
  // when the reader can see that 24 is of 35 examined and 35 is of 150 asked for.
  console.log(
    `LCA-SAMPLE attempted=${String(coverage.attempted)}/${String(coverage.planned)} ` +
      `measured=${String(coverage.measured)} ofAttempted=${coverage.ofAttempted.toFixed(3)} ` +
      `ofPlanned=${coverage.ofPlanned.toFixed(3)} refused=${String(coverage.refused)} ` +
      `worstCase=${worst === null ? 'none' : worst.toFixed(4)} ` +
      `standardised=${standardised.value === null ? 'none' : standardised.value.toFixed(4)} ` +
      `covered=${standardised.coveredShare.toFixed(3)}`,
  );
  for (const refusal of coverage.refusals) {
    console.log(`LCA-REFUSAL n=${String(refusal.count)} because=${refusal.because}`);
  }
  for (const stratum of strata) {
    console.log(
      `LCA-STRATUM ${stratum.label} attempted=${String(stratum.attempted)} measured=${String(stratum.measured)} ` +
        `ours=${stratum.map === null ? 'none' : stratum.map.toFixed(4)} ` +
        `bm25=${stratum.bm25 === null ? 'none' : stratum.bm25.toFixed(4)}`,
    );
  }
  // **The paired comparison on one line**, because it is the figure that survives the sampling objection and the one a
  // reader should quote: the difference between two rankings of the same files, with its interval and its test.
  console.log(
    paired === null
      ? 'LCA-PAIRED none'
      : `LCA-PAIRED rows=${String(paired.rows)} delta=${paired.meanDelta.toFixed(4)} ` +
          `ci=[${paired.lower.toFixed(4)},${paired.upper.toFixed(4)}] ` +
          `W/L/T=${String(paired.wins)}/${String(paired.losses)}/${String(paired.ties)} ` +
          `p=${paired.pValue.toFixed(4)} seed=${String(BOOTSTRAP_SEED)} resamples=${String(BOOTSTRAP_RESAMPLES)}`,
  );
  const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
  if (stepSummary !== undefined && stepSummary !== '') {
    appendFileSync(stepSummary, `\n${summary}\n`);
  }

  // **Each language on its own line as well**, because a combined figure that hides which split regressed is the reason
  // this benchmark has three splits.
  for (const [config, language] of Object.entries(combined.byLanguage)) {
    const languageAt10 = language.retrieval['at10'];
    console.log(
      `LCA-LANGUAGE ${config} measured=${String(language.measured)}/${String(language.rows)} ` +
        `R@10=${String(languageAt10 === undefined ? 0 : languageAt10.recall)} ` +
        `F1@10=${String(languageAt10 === undefined ? 0 : languageAt10.f1)} ` +
        `map=${language.map === null ? 'none' : String(language.map.value)}`,
    );
  }
}

main();
