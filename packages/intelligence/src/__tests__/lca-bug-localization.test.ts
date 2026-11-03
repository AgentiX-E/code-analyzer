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
//
// **One language split per `it()`, and that is a change of architecture rather than of style.** The job this file runs
// in had never once finished: eleven attempts, all ending in `The runner has received a shutdown signal` and exit 143,
// at a hundredth of the scope as well as at the full sample. The cause was measured rather than guessed - see
// `MEASURED_MB_PER_FILE` in `benchmark/lca-instrument.ts`: an analysis of 568 files costs 2 088 MB of *resident* memory,
// and V8 returns reclaimed heap pages to itself and not to the operating system, so a run costs the high-water mark of
// every instance it has analysed. Three splits in one process was three times the accumulation. **Now the workflow runs
// one job per language, each `it()` writes its own part of the artifact, and `lca-merge.ts` adds the parts up over rows
// so the combined figure is the one a single run would have produced.** A language that dies now costs its own rows
// instead of the whole figure.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join, resolve } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_EXTENSION,
  MEASURED_MB_PER_FILE,
  MS_PER_FILE,
  RUNNER_RESERVE_MB,
  analysableFileBudget,
  checkoutFileCount,
  corpusFiles,
  decideInstance,
  dedupePreservingOrder,
  lcaQualityMetrics,
  limitedTotalMb,
  mean,
  outsideUniverse,
  parseLanguages,
  restrictToUniverse,
  toCorpusPath,
} from '../benchmark/lca-instrument.js';
import { summarisePart } from '../benchmark/lca-merge.js';
import { askCodebase } from '../qa/ask.js';
import { DeepSeekProvider } from '../review/llm/provider.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { ArmMetrics, LcaRowScore, LanguagePart } from '../benchmark/lca-merge.js';
import type { PipelineContext } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Where the workflow put `py`, `java`, `kt` splits and the checkouts. **Unset means this file measured nothing.** */
const CORPUS_DIR = process.env['LCA_DIR'];
const CAN_ASK_A_MODEL = Boolean(process.env['DEEPSEEK_API_KEY']);

/**
 * Which splits this job measures. **One job per language is the unit of work**, and the workflow's matrix sets this.
 *
 * Absent means all three, which is what a local run wants and what the file did before it was sharded.
 */
const LANGUAGES = parseLanguages(process.env['LCA_LANGUAGES']);

// **A specification that names nothing valid is a configuration error, not an empty run.** `parseLanguages` answers with
// an empty list rather than with all three, because silently measuring every split is a ninety-minute job nobody asked
// for; here that answer becomes the sentence that says so, at import time, instead of a file that reports "no tests".
if (CORPUS_DIR !== undefined && LANGUAGES.length === 0) {
  throw new Error(
    `LCA_LANGUAGES names no configuration of the corpus (${String(process.env['LCA_LANGUAGES'])}); ` +
      'the three are py, java and kt',
  );
}

/**
 * How many instances of one language split to measure. **Twelve by default, and the part states it.**
 *
 * The published protocol is the whole test split - hundreds of instances per language - and **each instance needs its
 * own checkout of its own repository at its own commit**, then a full analysis of that checkout. **Twelve is what one
 * runner finishes**; the row count is recorded beside every figure, and every instance the bounds refused is recorded
 * with the sentence that refused it, so the sample is smaller than the protocol rather than pretending to be it.
 */
const ROW_LIMIT = Number.parseInt(process.env['LCA_MAX_ROWS'] ?? '8', 10);

/**
 * The hard ceiling on a checkout, in files. **A stated cap, because an unbounded instrument measures nothing.**
 *
 * The bound that actually bites is the memory one ({@link analysableFileBudget}), which shrinks as the run accumulates
 * resident pages; this number is the promise to the reader that no instance above it is measured even on a huge runner.
 * Both are recorded in the part, and a skipped row quotes whichever refused it.
 */
const FILE_CAP = Number.parseInt(process.env['LCA_MAX_FILES'] ?? '2000', 10);

/**
 * How long one language job may spend analysing, in milliseconds. **Stated rather than inherited from the job's own
 * timeout**, so that a run that runs out of time still writes a part: the rows it did not reach are recorded as skipped
 * with the arithmetic that skipped them, and the artifact exists. A job cancelled from outside writes nothing.
 */
const BUDGET_MS = Number.parseInt(process.env['LCA_BUDGET_MS'] ?? String(45 * 60_000), 10);

/**
 * A directory of bare mirrors named `<owner>__<name>.git`, used instead of GitHub. **For reproducing the harness
 * offline**, which is how the measurement was developed: the corpus itself is never committed, but a checkout that
 * cannot be fetched makes a run report nothing, and a harness nobody can run is a harness nobody can check.
 */
const MIRROR_DIR = process.env['LCA_GIT_MIRROR'];

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
// The machine
// ---------------------------------------------------------------------------

/** The memory this job may spend, in megabytes, **read from the cgroup when there is one**. */
function machineTotalMb(): number {
  const read = (path: string): string | null => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  return limitedTotalMb(
    read('/sys/fs/cgroup/memory.max') ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    totalmem(),
  );
}

const TOTAL_MB = machineTotalMb();

const residentMb = (): number => Math.round(process.memoryUsage().rss / 1_048_576);

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
      // **A mirror when one is named, GitHub otherwise.** The fallback is not a convenience: the corpus cannot be
      // committed, so an offline reproduction is the only way anybody can run this harness on the repository it is
      // about without downloading a hundred checkouts.
      const mirror = MIRROR_DIR
        ? resolve(MIRROR_DIR, `${row.repo_owner}__${row.repo_name}.git`)
        : `https://github.com/${row.repo_owner}/${row.repo_name}`;
      git(['remote', 'add', 'origin', mirror], repoDir);
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

/** The seven figures, from the authors' metric. */
function metricsOf(allFiles: string[], expected: string[], actual: string[]): ArmMetrics {
  const score = lcaQualityMetrics(allFiles, expected, actual);
  return {
    precision: score.precision,
    recall: score.recall,
    f1: score.f1,
    fpr: score.fpr,
    allCorrect: score.allCorrect,
    atLeastOneCorrect: score.atLeastOneCorrect,
    allIncorrect: score.allIncorrect,
  };
}

/** A row that was not measured, **with the sentence that refused it** - the two are written together or not at all. */
function skippedRow(row: LcaRow, corpusFileCount: number, because: string): LcaRowScore {
  return {
    id: row.id,
    repo: `${row.repo_owner}/${row.repo_name}`,
    corpusFiles: corpusFileCount,
    expectedFiles: row.changed_files.length,
    expectedOutside: 0,
    offered: 0,
    outside: 0,
    offeredPaths: [],
    skipped: because,
    retrieval: {},
    answer: null,
  };
}

/** Analyse one checkout, ask the question, and score both arms. **The only place the product is exercised.** */
async function measureOne(
  row: LcaRow,
  checkout: string,
  allFiles: string[],
  provider: DeepSeekProvider | null,
): Promise<LcaRowScore> {
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

  // **The budget is stated rather than inherited from a default.** Forty blocks is what a caller asking for evidence
  // gets, and a candidate pool of two hundred is what makes the cuts at three, five and ten different from each other
  // instead of three views of the same four files. Both numbers are recorded in the part, because a figure measured
  // under an unstated budget is a figure about the budget.
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

  // **The two halves of this comparison are recorded in different coordinate systems, and the first published run of
  // this instrument scored 0.0000 in three languages because of it.** The pipeline writes `filePath` as an absolute
  // path - it is given a root and it joins - while the corpus records `changed_files` as repository-relative, so the
  // set intersection was empty on every instance and the figure was a property of the units rather than of the
  // retriever. `toCorpusPath` is the conversion and it has its own tests.
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

  const retrieval: Record<string, ArmMetrics> = {};
  for (const cut of CUTS) {
    retrieval[`at${String(cut)}`] = metricsOf(
      allFiles,
      row.changed_files,
      candidates.slice(0, cut),
    );
  }

  store.close();

  return {
    id: row.id,
    repo: `${row.repo_owner}/${row.repo_name}`,
    corpusFiles: allFiles.length,
    expectedFiles: row.changed_files.length,
    expectedOutside: row.changed_files.filter((file) => !universe.has(file)).length,
    offered: candidates.length,
    outside: outsideUniverse(offeredRaw, universe),
    offeredPaths: offeredRaw.slice(0, 10),
    skipped: null,
    retrieval,
    answer: provider ? metricsOf(allFiles, row.changed_files, answered) : null,
  };
}

/** The configuration every part carries, so the merged artifact can state it once. */
function configurationOf(provider: DeepSeekProvider | null): Record<string, unknown> {
  return {
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
  };
}

describe.skipIf(!CORPUS_DIR)('Long Code Arena — bug localisation', () => {
  for (const config of LANGUAGES) {
    it(`measures the ${config} split and writes its part`, async () => {
      const root = CORPUS_DIR!;
      const cacheRoot = join(root, 'checkouts');
      mkdirSync(cacheRoot, { recursive: true });

      const startedAt = Date.now();
      const provider =
        CAN_ASK_A_MODEL && ANSWER_ARM ? new DeepSeekProvider({ timeout: 45_000 }) : null;
      const splitFile = join(root, config, 'test.jsonl');
      const rows: LcaRow[] = existsSync(splitFile)
        ? readFileSync(splitFile, 'utf8')
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as LcaRow)
            .slice(0, ROW_LIMIT)
        : [];

      // **The bound at the start of the part**, recorded rather than recomputed later, because a reader comparing
      // `measured` against `capFiles` needs to know what the machine could afford when the job began.
      const memoryFilesAtStart = analysableFileBudget({
        totalMb: TOTAL_MB,
        residentMb: residentMb(),
        reserveMb: RUNNER_RESERVE_MB,
        mbPerFile: MEASURED_MB_PER_FILE,
      });

      const scores: LcaRowScore[] = [];

      for (const row of rows) {
        const checkout = ensureCheckout(cacheRoot, row);
        if (checkout === null || !existsSync(join(checkout, '.git'))) {
          scores.push(skippedRow(row, 0, 'the commit could not be fetched'));
          continue;
        }
        if (statSync(checkout).size === 0) {
          scores.push(skippedRow(row, 0, 'the checkout is empty'));
          continue;
        }

        const allFiles = corpusFiles(checkout, CONFIG_EXTENSION[config]);
        // **The bound is on the checkout and not on the corpus's own extension.** `ccxt/ccxt` holds 686 Python files
        // and tens of thousands of others: it passed a bound computed from `corpusFiles` and the analysis of the
        // whole directory is what took the runner down six minutes later. The pipeline is handed the directory, so
        // the directory is what has to be bounded.
        const walked = checkoutFileCount(checkout);
        const resident = residentMb();
        const bounds = {
          capFiles: FILE_CAP,
          budgetFiles: analysableFileBudget({
            totalMb: TOTAL_MB,
            residentMb: resident,
            reserveMb: RUNNER_RESERVE_MB,
            mbPerFile: MEASURED_MB_PER_FILE,
          }),
          elapsedMs: Date.now() - startedAt,
          budgetMs: BUDGET_MS,
          residentMb: resident,
          reserveMb: RUNNER_RESERVE_MB,
        };
        const verdict = decideInstance(walked, bounds);

        // **One line per instance, and it carries the three numbers that decide the next one** - resident memory, the
        // room that leaves, and the time spent. A killed process leaves this line written (`stdbuf -oL` in the
        // workflow), so the next failure is a location rather than a mystery: eleven runs of this job died with a
        // block-buffered log that showed the vitest banner and nothing else.
        // eslint-disable-next-line no-console -- the workflow greps this, and a killed process needs it written.
        console.log(
          `LCA-INSTANCE ${config} id=${String(row.id)} ${row.repo_owner}/${row.repo_name} ` +
            `files=${String(allFiles.length)} walked=${String(walked)} rss=${String(resident)}MB ` +
            `room=${String(bounds.budgetFiles)} underCap=${String(FILE_CAP)} ` +
            `estimate=${String(walked * MS_PER_FILE)}ms elapsed=${String(bounds.elapsedMs)}ms ` +
            `${verdict.analyse ? 'measuring' : 'skipped'}`,
        );

        if (!verdict.analyse) {
          scores.push(skippedRow(row, allFiles.length, verdict.because));
          continue;
        }

        const measuredAt = Date.now();
        scores.push(await measureOne(row, checkout, allFiles, provider));
        // eslint-disable-next-line no-console -- per-instance cost, so a slow instance is visible before it kills the job.
        console.log(
          `LCA-INSTANCE ${config} id=${String(row.id)} analysed in ${String(Date.now() - measuredAt)}ms ` +
            `rss=${String(residentMb())}MB`,
        );
      }

      const part: LanguagePart = {
        config,
        measuredAt: new Date().toISOString(),
        rowLimit: ROW_LIMIT,
        answerArm: provider !== null,
        bounds: {
          capFiles: FILE_CAP,
          memoryFiles: memoryFilesAtStart,
          mbPerFile: MEASURED_MB_PER_FILE,
          reserveMb: RUNNER_RESERVE_MB,
          budgetMs: BUDGET_MS,
        },
        space: {
          semantic: false,
          reason:
            'the indexing pipeline was run without an embedding backend in this job, so the fused list is the lexical list',
        },
        configuration: configurationOf(provider),
        rows: scores,
      };

      const recorded = recordArtifact(`benchmarks/lca-parts/${config}.json`, part);
      if (!recorded.written) {
        // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
        console.log(`LCA-PART ${config} artifact ${recorded.because}`);
      }

      const summary = summarisePart(part, CUTS);
      const at10 = summary.retrieval['at10']!;
      // The summary line **is** the interface: the workflow greps it into the job summary.
      // eslint-disable-next-line no-console
      console.log(
        `LCA-PART ${config} measured=${String(summary.measured)}/${String(summary.rows)} ` +
          `retrieval@10 P=${String(at10.precision)} R=${String(at10.recall)} F1=${String(at10.f1)} ` +
          `retrieval@1 R=${String(summary.retrieval['at1']!.recall)} ` +
          `offered=${String(
            mean(scores.filter((score) => score.skipped === null).map((score) => score.offered)),
          )} ` +
          `outside=${String(
            mean(scores.filter((score) => score.skipped === null).map((score) => score.outside)),
          )} answer=${summary.answer === null ? 'none' : String(summary.answer.f1)} ` +
          `budget=${String(BUDGET_MS)}ms used=${String(Date.now() - startedAt)}ms`,
      );

      // **What this file can claim on its own**: it examined the split's rows and wrote a part that says what it
      // measured and what the bounds refused. **Whether the figure is good, and whether one exists at all, is the
      // gate's question** - `scripts/lca-gate.js` requires a measured instance and refuses a mean over none. A test
      // that failed when every instance was skipped would report a *bound* as a broken harness, and the two want
      // different fixes.
      expect(scores.length).toBeGreaterThan(0);
      expect(summary.rows).toBe(scores.length);
    }, 3_600_000);
  }
});
