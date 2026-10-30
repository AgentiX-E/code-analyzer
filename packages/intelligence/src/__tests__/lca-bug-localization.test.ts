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
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_EXTENSION,
  LCA_CONFIGS,
  corpusFiles,
  lcaQualityMetrics,
  mean,
  dedupePreservingOrder,
  outsideUniverse,
  restrictToUniverse,
  toCorpusPath,
} from '../benchmark/lca-instrument.js';
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
/** The cuts the retrieval arm reports. **Fixed in advance**, because a cut chosen after seeing the answer is a fit. */
const CUTS = [1, 3, 5, 10] as const;
/** What a checkout is allowed to take before the row is reported as skipped rather than failed. */
const FETCH_TIMEOUT_MS = 240_000;

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
  /** How many files the corpus counts in this checkout. */
  files: number;
  /** How many files the fixing commit changed. */
  expected: number;
  /** Files the retriever named at each cut, in the corpus's coordinate system and inside its answer space. */
  retrieval: Record<string, string[]>;
  /** Files the model cited, when one was available. */
  answer: string[] | null;
  skipped: string | null;
  /** The retriever's file ranking restricted to the corpus's answer space, in the retriever's order. */
  offered: string[];
  /**
   * The same ranking **before** the answer space was applied.
   *
   * **This is the field whose absence cost a third run.** The second run reported `offered: 0, outside: 10..17` on
   * every instance - the retriever had returned files and every one of them had fallen outside the universe - and the
   * artifact kept only the filtered list, so the paths that would have named the cause in one line were gone.
   */
  offeredRaw: string[];
  /** How many of those the corpus does not count. **Published**, because a filter that hides its own removals is a fit. */
  outside: number;
  /** How many of the expected files fall outside the answer space - the ceiling the restriction puts on recall. */
  expectedOutside: number;
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

    for (const config of LCA_CONFIGS) {
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
            offered: [],
            offeredRaw: [],
            outside: 0,
            expectedOutside: 0,
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
            offered: [],
            offeredRaw: [],
            outside: 0,
            expectedOutside: 0,
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
            offered: [],
            offeredRaw: [],
            outside: 0,
            expectedOutside: 0,
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

        // **The budget is stated rather than inherited from a default.** Forty blocks is what a caller asking for
        // evidence gets, and a candidate pool of two hundred is what makes the cuts at three, five and ten different
        // from each other instead of three views of the same four files. Both numbers are recorded in the artifact,
        // because a figure measured under an unstated budget is a figure about the budget.
        const question = `${row.issue_title}\n\n${row.issue_body}`.trim();
        const result = await askCodebase({
          question,
          store,
          search,
          ...(provider ? { provider } : {}),
          options: {
            generate: Boolean(provider),
            rerank: Boolean(provider),
            maxBlocks: 40,
            retrieveLimit: 200,
          },
        });

        // **The two halves of this comparison are recorded in different coordinate systems, and the first published
        // run of this instrument scored 0.0000 in three languages because of it.** The pipeline writes `filePath` as an
        // absolute path - it is given a root and it joins - while the corpus records `changed_files` as
        // repository-relative, so the set intersection was empty on every instance and the figure was a property of
        // the units rather than of the retriever. `toCorpusPath` is the conversion and it has its own tests, because a
        // conversion that lives inside one `it()` block can only be tested with a corpus.
        //
        // **The second conversion is the answer space.** The corpus counts the non-test files of the configuration's
        // extension and the published baselines rank exactly that set, so a `History.md` our retriever offers is not a
        // candidate that lost - it was never in the running. Restricting to that set is a filter that preserves the
        // retriever's order, and the count of what it removed is published beside the figure rather than dropped.
        const universe = new Set(allFiles);
        const offeredRaw = dedupePreservingOrder(
          result.retrievedFiles.map((file) => toCorpusPath(checkout, file)),
        );
        const candidates = restrictToUniverse(offeredRaw, universe);
        const answered = restrictToUniverse(
          result.files.map((file) => toCorpusPath(checkout, file)),
          universe,
        );

        const retrieval: Record<string, string[]> = {};
        for (const cut of CUTS) retrieval[String(cut)] = candidates.slice(0, cut);

        outcomes.push({
          id: row.id,
          repo: `${row.repo_owner}/${row.repo_name}`,
          files: allFiles.length,
          expected: row.changed_files.length,
          retrieval,
          answer: provider ? answered : null,
          skipped: null,
          offered: candidates,
          offeredRaw,
          outside: outsideUniverse(offeredRaw, universe),
          expectedOutside: row.changed_files.filter((file) => !universe.has(file)).length,
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
        configurations: [...LCA_CONFIGS],
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
      configuration: {
        maxBlocks: 40,
        retrieveLimit: 200,
        excerptChars: null,
        rerank: Boolean(provider),
        generate: Boolean(provider),
        note:
          'The context budget the measurement asked for. **Stated because a figure measured under an unstated budget ' +
          'is a figure about the budget**: a pool of twenty candidates makes the cuts at three, five and ten into ' +
          'three views of the same four files.',
        units: [
          "Retrieved paths are reduced to the corpus's own coordinate system (repository-relative POSIX) before they " +
            'are scored; the product reports absolute paths because the pipeline is given a root and joins.',
          "Candidates are restricted to the corpus's answer space - non-test files of the configuration's extension, " +
            "which is the set the published baselines rank. **The filter preserves the retriever's order** and the " +
            'count it removed is in every row as `outside`.',
        ],
      },
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
      /**
       * One entry per instance, so that a zero can be explained from the artifact alone.
       *
       * **This is the field whose absence cost two runs.** The first published figure was 0.0000 with nothing beside it
       * saying whether the index was empty, the paths were in another coordinate system, or the retriever had missed -
       * and the three have nothing in common except the number they produce. Every row now carries what was expected,
       * what was offered, and how much of each fell outside the answer space.
       */
      rows: allOutcomes.map((outcome) => ({
        id: outcome.id,
        repo: outcome.repo,
        corpusFiles: outcome.files,
        expectedFiles: outcome.expected,
        expectedOutside: outcome.expectedOutside,
        offered: outcome.offered.length,
        outside: outcome.outside,
        offeredPaths: outcome.offeredRaw.slice(0, 10),
        skipped: outcome.skipped,
      })),
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
        `offered=${String(mean(measured.map((outcome) => outcome.offered.length)))} ` +
        `outside=${String(mean(measured.map((outcome) => outcome.outside)))} ` +
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
