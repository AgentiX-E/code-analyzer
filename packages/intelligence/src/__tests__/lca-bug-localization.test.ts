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
//   Dataset: huggingface.co/datasets/JetBrains-Research/lca-bug-localization (Apache-2.0), 50 instances per language.
//   Metric: lca-baselines/bug_localization/src/baselines/metrics/quality_metrics.py, transcribed unchanged below.
//
// **Why this task and not another.** It is a natural-language question whose answer is a set of files in a real
// repository, in three languages (Python, Java, Kotlin), which is the shape requirement 5 asks about; the ground truth
// is the commit that fixed the issue, so nobody wrote it by hand; it needs no grader model, so the number does not move
// when a vendor changes a model; and **the paper publishes MAP for six retrieval baselines and two chat configurations**
// (`GTE` 0.33, `Mistral` 0.30, `TF-IDF` 0.27, `BM25` under 0.25, `GPT-4` 0.39), so the comparison is like for like
// rather than an argument.
//
// **Two arms, both reported.**
//
// * `retrieval` - the fused list's files, cut at k. **No model involved**, so it is free, deterministic and a change in
//   it is a change in the retriever.
// * `answer` - the file set the model cited, scored with the corpus's own metric. Only when a provider is present.
//
// **What is not claimed.** The published baselines read the *whole* repository in the context composer or name every
// file path; this harness gives the model **the blocks the retriever selected**, which is a different and much smaller
// prompt. So the answer arm is not the `filepath_imports` configuration reproduced - it is this product's
// configuration measured with the same ruler, and the artifact says so.
//
// **The corpus is never committed.** `LCA_DIR` points at a directory the workflow fills; without it this file skips,
// because a measurement that silently ran on a stale copy would be a measurement of the copy.
//
// **One instance, one process - and that is iteration 69's whole change.** This job had never produced a figure in
// eleven attempts, and the sharded repair (one job per language) fixed two of the three languages: the Kotlin leg still
// died on its first instance with `exit 143`, because the analysis of a thousand-file checkout outgrew the runner while
// the analyser and the record lived in the same process. **The bounds were all statements about the machine** (`room`
// was computed from the runner's 16 GB) while the process that had to hold the result was capped at four gigabytes of
// heap and tree-sitter's trees are native memory no heap flag bounds. So the measurement is now orchestrated here and
// executed by `scripts/lca-instance.ts`: the parent samples the child's resident set, kills it at a stated ceiling, and
// records the row as refused with the number that refused it. **A kill costs one row, and resident memory stops
// accumulating** - which is also what lets a language be measured over more instances than before.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import {
  CONFIG_EXTENSION,
  MEASURED_MB_PER_FILE,
  MS_PER_FILE,
  RUNNER_RESERVE_MB,
  analysableFileBudget,
  checkoutFileCount,
  corpusBytes,
  corpusFiles,
  decideInstance,
  limitedTotalMb,
  mean,
  parseLanguages,
} from '../benchmark/lca-instrument.js';
import { skippedRow, summarisePart } from '../benchmark/lca-merge.js';
import { readResidentMb, superviseInstance } from '../benchmark/lca-supervisor.js';

import type { LcaCorpusRow } from '../benchmark/lca-measure.js';
import type { LcaRowScore, LanguagePart } from '../benchmark/lca-merge.js';

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
 * The published protocol is the whole test split - fifty instances per language - and **each instance needs its own
 * checkout of its own repository at its own commit**, then a full analysis of that checkout. **Twelve is what one
 * runner finishes**; the row count is recorded beside every figure, and every instance the bounds refused is recorded
 * with the sentence that refused it, so the sample is smaller than the protocol rather than pretending to be it.
 */
const ROW_LIMIT = Number.parseInt(process.env['LCA_MAX_ROWS'] ?? '12', 10);

/**
 * The hard ceiling on a checkout, in files. **A stated cap, because an unbounded instrument measures nothing.**
 *
 * The bound that actually bites is the memory one ({@link analysableFileBudget}), computed from the ceiling a single
 * instance may reach; this number is the promise to the reader that no instance above it is measured even on a huge
 * runner. Both are recorded in the part, and a skipped row quotes whichever refused it.
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
 * whole budget. The retrieval arm needs no model, is deterministic to the digit, and is the arm the published baselines
 * are comparable with.
 */
const ANSWER_ARM = process.env['LCA_ANSWER_ARM'] === '1';

/** What a checkout is allowed to take before the row is reported as skipped rather than failed. */
const FETCH_TIMEOUT_MS = 240_000;

// ---------------------------------------------------------------------------
// The machine, and the ceiling a single instance may reach
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

/**
 * The resident set one instance may reach, in megabytes.
 *
 * **This is the correction the failed Kotlin leg taught, expressed as a number.** The old bound subtracted the reserve
 * from the *runner's* memory - sixteen gigabytes on a public runner - and promised an analysis of four thousand files
 * to a process whose heap was capped at four gigabytes, while tree-sitter's trees live outside the heap entirely. The
 * ceiling is now stated for the instance, enforced by the supervisor, and never larger than what the machine has left.
 */
const INSTANCE_RSS_CAP_MB = Math.max(
  1024,
  Math.min(
    TOTAL_MB - RUNNER_RESERVE_MB,
    Number.parseInt(process.env['LCA_INSTANCE_RSS_MB'] ?? '6144', 10),
  ),
);

/** The child's own heap cap. **Smaller than the resident ceiling**, so a heap exhaustion names itself before the kill. */
const INSTANCE_HEAP_MB = Number.parseInt(process.env['LCA_INSTANCE_HEAP_MB'] ?? '3072', 10);

/** How long one instance may run. **A job with twelve instances cannot spend the whole budget on one.** */
const INSTANCE_TIMEOUT_MS = Number.parseInt(process.env['LCA_INSTANCE_TIMEOUT_MS'] ?? '900000', 10);

// ---------------------------------------------------------------------------
// Checkouts
// ---------------------------------------------------------------------------

/** A checkout at one commit, fetched shallowly. **Cached per repository**, because a split reuses repositories. */
function ensureCheckout(cacheRoot: string, row: LcaCorpusRow): string | null {
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
    git(['fetch', '--quiet', '--depth', '1', 'origin', row.base_sha ?? 'HEAD'], repoDir);
    git(['checkout', '--quiet', '--force', 'FETCH_HEAD'], repoDir);
    return repoDir;
  } catch {
    return null;
  }
}

/** The configuration every part carries, so the merged artifact can state it once. */
function configurationOf(answerArm: boolean): Record<string, unknown> {
  return {
    maxBlocks: 40,
    retrieveLimit: 200,
    excerptChars: null,
    rerank: answerArm,
    generate: answerArm,
    mapDepth: 200,
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
      'Average precision reads the first two hundred candidates, which is the pool the product returns. **A shorter ' +
        'list can only lose credit**, so the MAP column is a floor rather than an estimate.',
    ],
  };
}

describe.skipIf(!CORPUS_DIR)('Long Code Arena — bug localisation', () => {
  for (const config of LANGUAGES) {
    it(`measures the ${config} split and writes its part`, async () => {
      const root = CORPUS_DIR!;
      const cacheRoot = join(root, 'checkouts');
      mkdirSync(cacheRoot, { recursive: true });
      // **Rows live outside the artifact directory**: they are the interface between this file and the child, not a
      // published figure, and the workflow uploads `benchmarks/lca-parts/` whole.
      const rowsDir = mkdtempSync(join(tmpdir(), 'lca-rows-'));

      const startedAt = Date.now();
      const answerArm = CAN_ASK_A_MODEL && ANSWER_ARM;
      const splitFile = join(root, config, 'test.jsonl');
      const rows: LcaCorpusRow[] = existsSync(splitFile)
        ? readFileSync(splitFile, 'utf8')
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as LcaCorpusRow)
            .slice(0, ROW_LIMIT)
        : [];

      const scores: LcaRowScore[] = [];

      const partOf = (): LanguagePart => ({
        config,
        measuredAt: new Date().toISOString(),
        rowLimit: ROW_LIMIT,
        answerArm,
        bounds: {
          capFiles: FILE_CAP,
          memoryFiles: analysableFileBudget({
            totalMb: INSTANCE_RSS_CAP_MB,
            residentMb: 0,
            reserveMb: 0,
            mbPerFile: MEASURED_MB_PER_FILE,
          }),
          mbPerFile: MEASURED_MB_PER_FILE,
          reserveMb: RUNNER_RESERVE_MB,
          budgetMs: BUDGET_MS,
          instanceRssCapMb: INSTANCE_RSS_CAP_MB,
          instanceHeapMb: INSTANCE_HEAP_MB,
          instanceTimeoutMs: INSTANCE_TIMEOUT_MS,
        },
        space: {
          semantic: false,
          reason:
            'the indexing pipeline was run without an embedding backend in this job, so the fused list is the lexical list',
        },
        configuration: configurationOf(answerArm),
        rows: [...scores],
      });

      // **Written after every instance rather than at the end, because the end is what a killed process does not
      // reach.** A part that only exists once the loop finishes is a part that eleven runs of this job never wrote; a
      // part that exists after each row survives a child that is killed at its ceiling.
      const writePart = (): void => {
        const recorded = recordArtifact(`benchmarks/lca-parts/${config}.json`, partOf());
        if (!recorded.written) {
          // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
          console.log(`LCA-PART ${config} artifact ${recorded.because}`);
        }
      };

      for (const row of rows) {
        const checkout = ensureCheckout(cacheRoot, row);
        if (checkout === null || !existsSync(join(checkout, '.git'))) {
          scores.push(
            skippedRow({
              id: row.id,
              repo: `${row.repo_owner}/${row.repo_name}`,
              corpusFiles: 0,
              expectedFiles: row.changed_files.length,
              because: 'the commit could not be fetched',
            }),
          );
          continue;
        }
        if (statSync(checkout).size === 0) {
          scores.push(
            skippedRow({
              id: row.id,
              repo: `${row.repo_owner}/${row.repo_name}`,
              corpusFiles: 0,
              expectedFiles: row.changed_files.length,
              because: 'the checkout is empty',
            }),
          );
          continue;
        }

        const allFiles = corpusFiles(checkout, CONFIG_EXTENSION[config]);
        // **The bound is on the checkout and not on the corpus's own extension.** `ccxt/ccxt` holds 686 Python files
        // and tens of thousands of others: it passed a bound computed from `corpusFiles` and the analysis of the whole
        // directory is what took the runner down six minutes later.
        const walked = checkoutFileCount(checkout);
        const resident = residentMb();
        const bounds = {
          capFiles: FILE_CAP,
          budgetFiles: analysableFileBudget({
            totalMb: INSTANCE_RSS_CAP_MB,
            residentMb: 0,
            reserveMb: 0,
            mbPerFile: MEASURED_MB_PER_FILE,
          }),
          elapsedMs: Date.now() - startedAt,
          budgetMs: BUDGET_MS,
          residentMb: resident,
          reserveMb: RUNNER_RESERVE_MB,
        };
        const verdict = decideInstance(walked, bounds);
        const repo = `${row.repo_owner}/${row.repo_name}`;

        // **One line per instance, and it carries the numbers that decide the next one** - the parent's resident set,
        // the ceiling a child may reach, and the time spent. A killed process leaves this line written (`stdbuf -oL`
        // in the workflow), so the next failure is a location rather than a mystery.
        // eslint-disable-next-line no-console -- the workflow greps this, and a killed process needs it written.
        console.log(
          `LCA-INSTANCE ${config} id=${String(row.id)} ${repo} files=${String(allFiles.length)} ` +
            `walked=${String(walked)} parentRss=${String(resident)}MB ceiling=${String(INSTANCE_RSS_CAP_MB)}MB ` +
            `room=${String(bounds.budgetFiles)} underCap=${String(FILE_CAP)} ` +
            `estimate=${String(walked * MS_PER_FILE)}ms elapsed=${String(bounds.elapsedMs)}ms ` +
            `${verdict.analyse ? 'measuring' : 'skipped'}`,
        );

        if (!verdict.analyse) {
          // **The size of the answer space travels with the refusal**, because the rule that produced it is about to be
          // replaced by a fit against exactly this number: a refusal that does not record what the instance would have
          // cost leaves the next iteration arguing about the rule instead of computing a better one.
          const refusedSize = corpusBytes(checkout, allFiles);
          scores.push(
            skippedRow({
              id: row.id,
              repo,
              corpusFiles: allFiles.length,
              expectedFiles: row.changed_files.length,
              because: verdict.because,
              corpusBytes: refusedSize.bytes,
              corpusUnreadable: refusedSize.unreadable,
            }),
          );
          continue;
        }

        const rowFile = join(rowsDir, `${config}-${String(row.id)}.json`);
        const outFile = join(rowsDir, `${config}-${String(row.id)}.row.json`);
        writeFileSync(rowFile, JSON.stringify(row), 'utf8');

        const outcome = await superviseInstance({
          command: 'npx',
          args: [
            'tsx',
            'scripts/lca-instance.ts',
            '--config',
            config,
            '--checkout',
            checkout,
            '--row',
            rowFile,
            '--out',
            outFile,
            ...(answerArm ? ['--answer-arm'] : []),
          ],
          outFile,
          rssCapMb: INSTANCE_RSS_CAP_MB,
          timeoutMs: INSTANCE_TIMEOUT_MS,
          // **The workspace imports resolve through a tsconfig, and the child is told which one.** Without it tsx reads
          // each package's `main`, which points at a `dist/` this job does not build: the harness would then measure a
          // build older than the commit that triggered it. The heap flag is the child's own ceiling, stated so that a
          // heap exhaustion names itself before the supervisor's kill.
          env: {
            NODE_OPTIONS: `--max-old-space-size=${String(INSTANCE_HEAP_MB)}`,
            TSX_TSCONFIG_PATH: 'tsconfig.tests.json',
          },
        });

        // **What the instance cost is the supervisor's observation**, so it is attached to the row after the process
        // has closed - a row written by the child cannot know what it will peak at later, and a figure the child
        // reported about itself would be a child's opinion rather than a measurement.
        const cost = { peakRssMb: outcome.peakRssMb, elapsedMs: outcome.ms };
        if (outcome.kind === 'row') {
          scores.push({ ...outcome.row, cost });
        } else {
          // **The refusal is the row.** An instance too large for the runner it ran on is a fact about the sample, and
          // publishing it as a skip with the sentence that produced it is how the sample's size stays explainable.
          scores.push(
            skippedRow({
              id: row.id,
              repo,
              corpusFiles: allFiles.length,
              expectedFiles: row.changed_files.length,
              because: outcome.because,
              cost,
            }),
          );
        }

        // eslint-disable-next-line no-console -- per-instance cost, so a slow instance is visible before it is killed.
        console.log(
          `LCA-INSTANCE ${config} id=${String(row.id)} ${outcome.kind} in ${String(outcome.ms)}ms ` +
            `peakRss=${String(outcome.peakRssMb)}MB parentRss=${String(residentMb())}MB`,
        );
        writePart();
      }

      const summary = summarisePart(partOf(), [1, 3, 5, 10]);
      const at10 = summary.retrieval['at10']!;
      // The summary line **is** the interface: the workflow greps it into the job summary.
      // eslint-disable-next-line no-console
      console.log(
        `LCA-PART ${config} measured=${String(summary.measured)}/${String(summary.rows)} ` +
          `retrieval@10 P=${String(at10.precision)} R=${String(at10.recall)} F1=${String(at10.f1)} ` +
          `retrieval@1 R=${String(summary.retrieval['at1']!.recall)} ` +
          `map=${summary.map === null ? 'none' : String(summary.map.value)} ` +
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
      // gate's question** - `scripts/lca-gate.js` requires a measured instance and refuses a mean over none.
      expect(scores.length).toBeGreaterThan(0);
      expect(summary.rows).toBe(scores.length);
      // **The parent must not be where the memory went.** A child per instance is only worth its cost if the process
      // that orchestrates stays small; this is the assertion that says the architecture did what it claims.
      expect(residentMb()).toBeLessThan(INSTANCE_RSS_CAP_MB);
      expect(readResidentMb(process.pid)).toBeGreaterThan(0);
    }, 3_600_000);
  }
});
