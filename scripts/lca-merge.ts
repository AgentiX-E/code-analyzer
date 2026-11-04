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

import { LCA_CONFIGS } from '../packages/intelligence/src/benchmark/lca-instrument.js';
import { combineParts } from '../packages/intelligence/src/benchmark/lca-merge.js';
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
function comparisonOf(ours: number | null): Record<string, unknown> {
  if (ours === null) {
    return {
      metric: PUBLISHED_BASELINES.metric,
      ours: null,
      rank: null,
      why: 'no instance produced an average precision, so there is nothing to place in the table',
    };
  }
  const beaten = PUBLISHED_BASELINES.rows.filter((row) =>
    'bound' in row ? ours >= row.map : ours > row.map,
  ).length;
  return {
    metric: PUBLISHED_BASELINES.metric,
    ours,
    // **Rank 1 means nothing in the table is above us**; a bound row counts as beaten only when it is met.
    rank: beaten,
    of: PUBLISHED_BASELINES.rows.length,
    beaten: PUBLISHED_BASELINES.rows
      .filter((row) => ('bound' in row ? ours >= row.map : ours > row.map))
      .map((row) => row.name),
    notBeaten: PUBLISHED_BASELINES.rows
      .filter((row) => ('bound' in row ? ours < row.map : ours <= row.map))
      .map((row) => row.name),
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
    answerArm: parts.some((part) => part.answerArm),
    cuts: CUTS.join(', '),
    configuration: first.configuration,
    space: first.space,
    overall: combined.overall,
    byLanguage: combined.byLanguage,
    /** **Where this figure stands against the published table**, computed rather than asserted. */
    comparison: comparisonOf(combined.overall.map?.value ?? null),
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
