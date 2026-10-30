// Long Code Arena — bug localisation, measured on the authors' own corpus.
//
// **The instrument this project needed and could not build itself.** Iteration 38 closed OWASP Benchmark at 1.0000 and
// said, in as many words, that the figure is the ceiling of *that* corpus: 2 740 generated servlets with one shape per
// case say whether a flow is followed, and nothing about whether a real repository's answer can be found. This file is
// the second instrument, and it is somebody else's:
//
//   Long Code Arena, bug localisation (Bogomolov et al., arXiv 2406.11612, NeurIPS 2024 D&B).
//   "Given an issue with the bug description and the repository code in the state where the issue is
//   reproducible, identify the files within the project that need to be modified."
//   Dataset: huggingface.co/datasets/JetBrains-Research/lca-bug-localization (Apache-2.0).
//   Metric: lca-baselines/bug_localization/src/baselines/metrics/quality_metrics.py, transcribed below unchanged.
//
// **Why this task and not another.** It is a natural-language question whose answer is a set of files in a real
// repository, in three languages (Python, Java, Kotlin), which is the shape requirement 5 asks about; the ground truth
// is the commit that fixed the issue, so nobody wrote it by hand; it needs no grader model, so the number does not move
// when a vendor changes a model; and **its published baselines include BM25 and `filepath_imports`** - the second is
// exactly the "give the model the paths and the import graph" strategy this project claims to improve on, so the
// comparison is like for like rather than an argument.
//
// **Two arms, both reported.**
//
// * `retrieval` - the fused list's files, cut at k. **No model involved**, so it is free, deterministic and a change in
//   it is a change in the retriever.
// * `answer` - the file set the model cited, scored with the corpus's own metric. Only when a provider is present.
//
// **What is not claimed.** The published baselines read the *whole* repository in the context composer or name every
// file path; this harness gives the model **the twelve blocks the retriever selected**, which is a different and much
// smaller prompt. So the answer arm is not the `filepath_imports` configuration reproduced - it is this product's
// configuration measured with the same ruler, and the artifact says so.
//
// **The corpus is never committed.** `LCA_DIR` points at a directory the workflow fills; without it this file skips,
// because a measurement that silently ran on a stale copy would be a measurement of the copy.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, posix, relative, sep } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { askCodebase } from '../qa/ask.js';
import { DeepSeekProvider } from '../review/llm/provider.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { PipelineContext } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Where the workflow put `py`, `java`, `kt` splits and the checkouts. **Unset means this file measured nothing.** */
const CORPUS_DIR = process.env['LCA_DIR'];
const CAN_ASK_A_MODEL = Boolean(process.env['DEEPSEEK_API_KEY']);
// **How many instances of each language split to measure. Twelve by default, and the artifact states it.**
//
// The published protocol is the whole test split - hundreds of instances per language - and **each instance needs its
// own checkout of its own repository at its own commit**, then a full analysis of that checkout: the first attempt at
// fifty per language exhausted a ninety-minute budget and produced no figure at all, which is the least useful outcome
// a measurement can have. Twelve is what a runner finishes, the row count is recorded in the artifact beside every
// figure, and raising it is one dispatch input rather than a code change.
const ROW_LIMIT = Number.parseInt(process.env['LCA_MAX_ROWS'] ?? '8', 10);

/**
 * The largest repository an instance may use, in files of the configuration's extension. **A cap, because an unbounded
 * instrument measures nothing.**
 *
 * The published protocol analyses whatever repository the issue came from, and some of them are enormous: three attempts
 * at this job - fifty instances a language, then twelve, then twelve again - were still running after ninety minutes,
 * after two and a half hours, and were cancelled, and none produced a figure. **An instance whose repository is larger
 * than this is skipped and counted rather than analysed**, because a measurement that excludes big repositories and
 * says how many it excluded is worth more than a measurement that never finishes. The number is recorded in the
 * artifact beside every figure.
 */
const FILE_CAP = Number.parseInt(process.env['LCA_MAX_FILES'] ?? '2000', 10);

/**
 * Whether the answer arm runs. **Off unless asked for.**
 *
 * It costs one completion per instance against a real endpoint, and a completion that reaches its timeout costs the
 * whole budget - thirty-six of those is most of an hour spent on the slower half of the same measurement. The retrieval
 * arm needs no model, is deterministic to the digit, and is the arm the published baselines are comparable with.
 */
const ANSWER_ARM = process.env['LCA_ANSWER_ARM'] === '1';
const CONFIGS = ['py', 'java', 'kt'] as const;
/** The cuts the retrieval arm reports. **Fixed in advance**, because a cut chosen after seeing the answer is a fit. */
const CUTS = [1, 3, 5, 10] as const;
/** What a checkout is allowed to take before the row is reported as skipped rather than failed. */
const FETCH_TIMEOUT_MS = 240_000;

type ConfigName = (typeof CONFIGS)[number];

interface LcaRow {
  id: number;
  text_id: string;
  repo_owner: string;
  repo_name: string;
  base_sha: string;
  issue_title: string;
  issue_body: string;
  changed_files: string[];
}

// ---------------------------------------------------------------------------
// The corpus's own metric, transcribed
// ---------------------------------------------------------------------------

/**
 * The authors' `get_quality_metrics`, field for field.
 *
 * **Transcribed rather than paraphrased**, because a re-derived F1 that rounds differently is a number that cannot be
 * compared with the table it is meant to compare against. The only change is types.
 */
export function lcaQualityMetrics(
  allFiles: string[],
  expectedFiles: string[],
  actualFiles: string[],
): {
  allFilesCount: number;
  expectedCount: number;
  actualCount: number;
  percentOfBugFiles: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  allCorrect: number;
  atLeastOneCorrect: number;
  allIncorrect: number;
} {
  const all = new Set(allFiles);
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);

  const truePositives = [...expected].filter((file) => actual.has(file)).length;
  const falsePositives = [...actual].filter((file) => !expected.has(file)).length;
  const falseNegatives = [...expected].filter((file) => !actual.has(file)).length;
  const trueNegatives = [...all].filter((file) => !expected.has(file) && !actual.has(file)).length;

  const precision =
    truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall =
    truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0;
  const fpr =
    falsePositives + trueNegatives > 0 ? falsePositives / (falsePositives + trueNegatives) : 0;

  return {
    allFilesCount: all.size,
    expectedCount: expected.size,
    actualCount: actual.size,
    percentOfBugFiles: all.size > 0 ? actual.size / all.size : 0,
    precision,
    recall,
    f1,
    fpr,
    allCorrect: actual.size === expected.size && truePositives === expected.size ? 1 : 0,
    atLeastOneCorrect: truePositives > 0 ? 1 : 0,
    // **The authors' definition**, which counts an empty answer as neither correct nor incorrect rather than as all
    // incorrect: `len(actual_set) > 0` is part of the condition.
    allIncorrect: truePositives === 0 && actual.size > 0 ? 1 : 0,
  };
}

/** Mean of a numeric field over the rows that produced one. **Rounded to four places, as the corpus's tables are.** */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return (
    Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10000) / 10000
  );
}

// ---------------------------------------------------------------------------
// Which files the corpus counts
// ---------------------------------------------------------------------------

/**
 * Whether a path is a test file, by the rule the baseline applies with `ignore_tests`.
 *
 * **Stated rather than imported**, because the authors' helper is Python and this is not; the cases it has to cover are
 * the three languages in the corpus, and the effect of getting it wrong is visible in `allFilesCount` in the artifact.
 */
export function isTestPath(path: string): boolean {
  const segments = path.split('/');
  const fileName = segments.at(-1) ?? '';
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => /^(tests?|testing|specs?|__tests__)$/i.test(segment)))
    return true;
  return (
    /^test_/i.test(fileName) ||
    /_test\./i.test(fileName) ||
    /\.(test|spec)\./i.test(fileName) ||
    /Tests?\.(java|kt)$/.test(fileName)
  );
}

/** The extension a configuration restricts the diff to. **`mixed` is not measured here and is not accepted.** */
const CONFIG_EXTENSION: Record<ConfigName, string> = { py: '.py', java: '.java', kt: '.kt' };

/** Every file in a checkout that the corpus would count, as workspace-relative POSIX paths. */
export function corpusFiles(root: string, extension: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(extension)) continue;
      const path = relative(root, full).split(sep).join(posix.sep);
      if (isTestPath(path)) continue;
      found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

// ---------------------------------------------------------------------------
// Checkouts
// ---------------------------------------------------------------------------

/** A checkout at one commit, fetched shallowly. **Cached per repository**, because a split reuses repositories. */
function ensureCheckout(cacheRoot: string, row: LcaRow): string | null {
  const repoDir = join(cacheRoot, `${row.repo_owner}__${row.repo_name}`);
  const git = (args: string[], cwd: string): void => {
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      timeout: FETCH_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  };

  try {
    if (!existsSync(join(repoDir, '.git'))) {
      mkdirSync(repoDir, { recursive: true });
      execFileSync('git', ['init', '--quiet'], { cwd: repoDir, stdio: 'pipe' });
      git(
        ['remote', 'add', 'origin', `https://github.com/${row.repo_owner}/${row.repo_name}`],
        repoDir,
      );
      git(['config', 'core.sparseCheckout', 'false'], repoDir);
    }
    // **The commit, not the branch**: the corpus records the state in which the issue is reproducible, and a tag that
    // moved is a different repository.
    git(['fetch', '--quiet', '--depth', '1', 'origin', row.base_sha], repoDir);
    git(['checkout', '--quiet', '--force', 'FETCH_HEAD'], repoDir);
    return repoDir;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

interface RowOutcome {
  id: number;
  repo: string;
  files: number;
  expected: number;
  /** Files the retriever named at each cut. */
  retrieval: Record<string, string[]>;
  /** Files the model cited, when one was available. */
  answer: string[] | null;
  skipped: string | null;
}

interface ArmScore {
  rows: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  allCorrect: number;
  atLeastOneCorrect: number;
  allIncorrect: number;
}

/** Aggregate one arm over the rows that produced an answer. **Skipped rows are excluded and counted separately.** */
function scoreArm(
  outcomes: RowOutcome[],
  pick: (outcome: RowOutcome) => string[] | null,
  allFilesOf: Map<number, string[]>,
  expectedOf: Map<number, string[]>,
): ArmScore {
  const scores: Array<ReturnType<typeof lcaQualityMetrics>> = [];
  for (const outcome of outcomes) {
    const actual = pick(outcome);
    const all = allFilesOf.get(outcome.id);
    const expected = expectedOf.get(outcome.id);
    if (actual === null || !all || !expected) continue;
    scores.push(lcaQualityMetrics(all, expected, actual));
  }
  return {
    rows: scores.length,
    precision: mean(scores.map((score) => score.precision)),
    recall: mean(scores.map((score) => score.recall)),
    f1: mean(scores.map((score) => score.f1)),
    fpr: mean(scores.map((score) => score.fpr)),
    allCorrect: mean(scores.map((score) => score.allCorrect)),
    atLeastOneCorrect: mean(scores.map((score) => score.atLeastOneCorrect)),
    allIncorrect: mean(scores.map((score) => score.allIncorrect)),
  };
}

describe.skipIf(!CORPUS_DIR)('Long Code Arena — bug localisation', () => {
  it('measures the retriever and the answer on the corpus the benchmark publishes', async () => {
    const root = CORPUS_DIR!;
    const cacheRoot = join(root, 'checkouts');
    mkdirSync(cacheRoot, { recursive: true });

    const provider =
      CAN_ASK_A_MODEL && ANSWER_ARM ? new DeepSeekProvider({ timeout: 45_000 }) : null;
    const perConfig: Record<string, unknown> = {};
    const allOutcomes: RowOutcome[] = [];
    const allFilesOf = new Map<number, string[]>();
    const expectedOf = new Map<number, string[]>();

    for (const config of CONFIGS) {
      const splitFile = join(root, config, 'test.jsonl');
      if (!existsSync(splitFile)) {
        perConfig[config] = { reason: `${config}/test.jsonl is absent from the corpus directory` };
        continue;
      }
      const rows = readFileSync(splitFile, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as LcaRow)
        .slice(0, ROW_LIMIT);

      const outcomes: RowOutcome[] = [];
      const filesOf = new Map<number, string[]>();
      const expectedFilesOf = new Map<number, string[]>();

      for (const row of rows) {
        const checkout = ensureCheckout(cacheRoot, row);
        if (!checkout) {
          outcomes.push({
            id: row.id,
            repo: `${row.repo_owner}/${row.repo_name}`,
            files: 0,
            expected: row.changed_files.length,
            retrieval: {},
            answer: null,
            skipped: 'the commit could not be fetched',
          });
          continue;
        }
        if (!existsSync(join(checkout, '.git')) || statSync(checkout).size === 0) {
          outcomes.push({
            id: row.id,
            repo: `${row.repo_owner}/${row.repo_name}`,
            files: 0,
            expected: row.changed_files.length,
            retrieval: {},
            answer: null,
            skipped: 'the checkout is empty',
          });
          continue;
        }

        const allFiles = corpusFiles(checkout, CONFIG_EXTENSION[config]);
        // **The size bound, applied before any analysis**: an analysis that would not finish is not a measurement of
        // anything, and the skip is recorded so the artifact can say what the bound cost the sample.
        if (allFiles.length > FILE_CAP) {
          outcomes.push({
            id: row.id,
            repo: `${row.repo_owner}/${row.repo_name}`,
            files: allFiles.length,
            expected: row.changed_files.length,
            retrieval: {},
            answer: null,
            skipped: `the repository holds ${String(allFiles.length)} files, above the cap of ${String(FILE_CAP)}`,
          });
          continue;
        }

        const ctx = {
          projectId: `${row.repo_owner}/${row.repo_name}`,
          rootPath: checkout,
          config: getDefaultConfig(),
          signal: new AbortController().signal,
          metadata: {},
        } as unknown as PipelineContext;

        const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
        const store = new InMemoryGraphStore();
        const storeIdOf = new Map<number, number>();
        for (const node of pipeline.graph.nodes.values()) {
          storeIdOf.set(node.id, store.insertNode(node));
        }
        for (const edge of pipeline.graph.edges.values()) {
          const source = storeIdOf.get(edge.sourceId);
          const target = storeIdOf.get(edge.targetId);
          if (source === undefined || target === undefined) continue;
          store.insertEdge({
            projectId: edge.projectId,
            sourceId: source,
            targetId: target,
            type: edge.type,
            properties: edge.properties,
            weight: edge.weight,
          });
        }

        const search = new HybridSearchEngine(store);
        search.initialize();

        const question = `${row.issue_title}\n\n${row.issue_body}`.trim();
        const result = await askCodebase({
          question,
          store,
          search,
          ...(provider ? { provider } : {}),
          options: { generate: Boolean(provider), rerank: Boolean(provider), maxBlocks: 40 },
        });

        // **The two halves of this comparison are recorded in different coordinate systems, and the first run of this
        // instrument scored 0.0000 because of it.** The pipeline writes `filePath` as an absolute path - it is given a
        // root and it joins - while the corpus records `changed_files` as repository-relative. Comparing them directly
        // matched nothing in three languages, and the figure that came out was a property of the units rather than of
        // the retriever. **Every retrieved path is therefore reduced to the corpus's own form before it is scored**,
        // which is the only step in this file that touches the product's output.
        const relativePath = (file: string): string =>
          relative(checkout, isAbsolute(file) ? file : join(checkout, file))
            .split(sep)
            .join(posix.sep);
        const retrieved = result.retrievedFiles.map(relativePath);
        const answered = result.files.map(relativePath);

        const retrieval: Record<string, string[]> = {};
        for (const cut of CUTS) retrieval[String(cut)] = retrieved.slice(0, cut);

        outcomes.push({
          id: row.id,
          repo: `${row.repo_owner}/${row.repo_name}`,
          files: allFiles.length,
          expected: row.changed_files.length,
          retrieval,
          answer: provider ? answered : null,
          skipped: null,
        });
        filesOf.set(row.id, allFiles);
        expectedFilesOf.set(row.id, row.changed_files);
        store.close();
      }

      const scored = outcomes.filter((outcome) => outcome.skipped === null);
      const retrievalArms: Record<string, ArmScore> = {};
      for (const cut of CUTS) {
        retrievalArms[`at${String(cut)}`] = scoreArm(
          scored,
          (outcome) => outcome.retrieval[String(cut)] ?? [],
          filesOf,
          expectedFilesOf,
        );
      }
      perConfig[config] = {
        rows: rows.length,
        measured: scored.length,
        skipped: outcomes.filter((outcome) => outcome.skipped !== null).length,
        retrieval: retrievalArms,
        answer: provider
          ? scoreArm(scored, (outcome) => outcome.answer, filesOf, expectedFilesOf)
          : { reason: 'DEEPSEEK_API_KEY is absent, so no file set was cited by a model' },
      };

      allOutcomes.push(...outcomes);
      for (const [id, files] of filesOf) allFilesOf.set(id, files);
      for (const [id, files] of expectedFilesOf) expectedOf.set(id, files);
    }

    const measured = allOutcomes.filter((outcome) => outcome.skipped === null);
    const overallRetrieval: Record<string, ArmScore> = {};
    for (const cut of CUTS) {
      overallRetrieval[`at${String(cut)}`] = scoreArm(
        measured,
        (outcome) => outcome.retrieval[String(cut)] ?? [],
        allFilesOf,
        expectedOf,
      );
    }

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
      ],
      dataset: {
        name: 'JetBrains-Research/lca-bug-localization',
        configurations: [...CONFIGS],
        split: 'test',
        licence: 'Apache-2.0',
        metricSource:
          'github.com/JetBrains-Research/lca-baselines · bug_localization/src/baselines/metrics/quality_metrics.py',
      },
      measuredAt: new Date().toISOString().slice(0, 10),
      rowLimit: ROW_LIMIT,
      fileCap: FILE_CAP,
      answerArm: ANSWER_ARM,
      cuts: CUTS.join(', '),
      space: {
        semantic: false,
        reason:
          'the indexing pipeline was run without an embedding backend in this job, so the fused list is the lexical list',
      },
      overall: {
        rows: allOutcomes.length,
        measured: measured.length,
        skipped: allOutcomes.length - measured.length,
        retrieval: overallRetrieval,
        answer: provider
          ? scoreArm(measured, (outcome) => outcome.answer, allFilesOf, expectedOf)
          : { reason: 'DEEPSEEK_API_KEY is absent' },
      },
      byLanguage: perConfig,
    };

    const recorded = recordArtifact('benchmarks/lca-bug-localization.json', artifact);
    if (!recorded.written) {
      // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
      console.log(`LCA-BUG-LOC artifact ${recorded.because}`);
    }

    const at10 = overallRetrieval['at10']!;
    // The summary line **is** the interface: the workflow greps it into the job summary.
    // eslint-disable-next-line no-console
    console.log(
      `LCA-BUG-LOC rows=${String(measured.length)}/${String(allOutcomes.length)} ` +
        `retrieval@10 P=${String(at10.precision)} R=${String(at10.recall)} F1=${String(at10.f1)} ` +
        `retrieval@1 R=${String(overallRetrieval['at1']!.recall)} ` +
        (provider
          ? `answer F1=${String((artifact.overall.answer as ArmScore).f1)}`
          : 'answer=none'),
    );

    // **The only claim this file can make on its own**: the product finds the fixing file at all on somebody else's
    // corpus. Whether the number is good is what the published baselines are for.
    expect(measured.length).toBeGreaterThan(0);
    expect(at10.recall).toBeGreaterThan(0);
  }, 10_200_000);
});
