// CoSQA retrieval: the product measured on a corpus somebody else built.
//
// **Every figure in this repository until now was comparable only with itself.** `docstring-search` and
// `paraphrase-search` measure this engine on this code, with questions this project wrote; they can say a change helped,
// and they cannot say whether the result is any good. **CoSQA** is the corpus the code-search literature reports on
// (Huang et al., *CoSQA: A Dataset for Question Answering over Code*, and the CoCLR retrieval setup that followed it):
// 500 developer questions, each with the one function that answers it, in the same JSON the published work uses.
//
// **The dataset is never committed.** It is fetched by the workflow from the repository that publishes it, and this
// file skips when `COSQA_DIR` is unset — a measurement that silently used a stale local copy would be a measurement of
// the copy. The artifact records the file's SHA-256 so a run can say which revision it measured.
//
// **What this file is not.** It does not fine-tune anything, and it runs the product as shipped: index the code, search
// it, optionally expand and rerank. A model fine-tuned on CoSQA will beat it, and that comparison is the point of
// publishing the number rather than the excuse for not publishing one.

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PipelineOrchestrator,
  createAllPhases,
  createQueryEmbedder,
  defaultEmbedderLoader,
  generateEmbeddings,
} from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { mapWithConcurrency, recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { DeepSeekProvider } from '../review/llm/provider.js';
import {
  channelEvidence,
  deriveVectorWeight,
  evidenceRatioWeight,
  selfEvidence,
  EVIDENCE_DEPTH,
  FUSION_WEIGHT_BOUNDS,
} from '../search/fusion-weight.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';
import { compareArms, decodeRanks, encodeRanks } from '../search/paired-stats.js';
import { rerankCandidates } from '../search/rerank.js';

import type { HybridSearchResult } from '../search/hybrid-search.js';
import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

/** Where the workflow put the two files. **Unset means this file did not measure anything**, and says so by skipping. */
const DATASET_DIR = process.env['COSQA_DIR'];
const HAS_VECTORS = Boolean(process.env['ZHIPU_API_KEY']);
const CAN_ASK_A_MODEL = Boolean(process.env['DEEPSEEK_API_KEY']);
/** The cuts the literature reports. **MRR is cut at ten**, as published. */
const CUTS = 'recall@1, @5, @10; MRR@10';

/**
 * **How many results each channel contributes before fusion, which is also how many the reranker is shown.**
 *
 * **Fifty was a constant and it was a recall ceiling nobody measured.** At the collection pool the answer is absent from
 * the top ten for **102 of 500 questions**, and a candidate a channel never returned cannot be reordered into the
 * answer: the depth is therefore the one lever that can move `found@10`, and the reranker - which reorders what it is
 * given - cannot move it at all. Widening the pool costs **no embedding calls and no completions per question** on the
 * retrieval side, so the question "does depth help" is answerable for the price of one run.
 *
 * `COSQA_DEPTH` sets the arm a run reranks; **the default stays 50** because every published figure so far was measured
 * there and a default that moves under a number is the defect the provenance block exists to prevent.
 */
const DEPTH = readPositiveInt(process.env['COSQA_DEPTH'], 50);

/**
 * **The depths the fused arm is scored at, in one pass.**
 *
 * Each depth is a prefix of the same two ranked lists, so scoring three of them costs three fusions and **one query
 * embedding**: the sweep is why a run can say where recall is built instead of only how much of it there is. Default is
 * the rerank depth alone; `COSQA_SWEEP=50,100,200` asks for the curve.
 */
const SWEEP = readDepthSweep(process.env['COSQA_SWEEP'], DEPTH);
/**
 * **The depths the reranker is asked about, because "does a deeper pool change the gap" was the open question §30.5
 * registered.**
 *
 * A rerank depth is not free the way a sweep depth is: each one buys a completion per question **per arm**, so this is
 * opt-in and defaults to the single arm every published figure was measured at. `COSQA_RERANK_DEPTHS=50,100` reranks
 * both arms at both depths **inside one run**, which is the only design in which the two depths are paired: a second
 * job would put the model's run-to-run variance back into the comparison it was separated to remove.
 */
const RERANK_DEPTHS = readDepthSweep(process.env['COSQA_RERANK_DEPTHS'], DEPTH);

/**
 * **How many reranks are in flight at once, which is the ceiling on how wide a ladder this project can afford.**
 *
 * The loop this replaces was sequential, and nothing about the work required it: question *i*'s prompt contains question
 * *i*'s candidates and no other question's answer, so the order the completions are issued in cannot change what any of
 * them says. **What sequential bought was 85 minutes for three thousand completions** - six arms over five hundred
 * questions - and that is the number every wider ladder was priced against.
 *
 * **The default is one, and that is the point rather than a leftover.** Every published figure was measured at one in
 * flight; a default that silently became eight would put a queue depth between this artifact and the ones it is compared
 * with. A run that wants the speed says so, and `mapWithConcurrency` keeps the columns in question order either way.
 *
 * **A limit is not a reranker's opinion, so raising this needs the retry in `rerankCandidates`**: a 429 used to be
 * indistinguishable from a model that had no opinion, and eight in flight hit limits that one never did.
 */
const RERANK_CONCURRENCY = readPositiveInt(process.env['COSQA_RERANK_CONCURRENCY'], 1);

/**
 * **The deepest list either channel has to produce.**
 *
 * It has to cover **every depth anything downstream slices at**, which is three lists rather than two: the sweep, the
 * rerank arm, and now the rerank depths. A run that widened the reranker to a hundred candidates while the vector search
 * still returned fifty would rerank a fifty-deep list under a hundred-deep name, and the column would report the deeper
 * pool as worth nothing - **the depth defect §29 already paid for, one variable over**.
 */
const RETRIEVAL_DEPTH = retrievalDepth(DEPTH, SWEEP, RERANK_DEPTHS);

/**
 * **The fusion weights the fused arm is scored at, on the same two lists.**
 *
 * The first depth sweep answered its question and raised a larger one: at the collection pool **the vector channel alone
 * puts the answer in its top ten 354 times and the lexical channel 206, either of them 378 — and the fused list 329.**
 * Fifty questions that one channel answered were lost by combining it with the other, because reciprocal rank fusion at
 * equal weight is a compromise and a compromise with a worse list is a worse list.
 *
 * **The weight is a measurement's job to set** (`hybrid-search.ts` says so where the constant is declared, and
 * `docstring-search.test.ts` sweeps it on that corpus). This sweep is the same question asked on this one, for the price
 * of arithmetic: no embedding is recomputed and no model is called.
 */
const VECTOR_WEIGHTS = readNumberSweep(process.env['COSQA_VECTOR_WEIGHTS'], 1);

/** A positive number from the environment, or the default when the variable is absent or unusable. */
function readPositiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The weights a sweep asks for: positive numbers, ascending, **without duplicates**, always including the arm. */
function readNumberSweep(raw: string | undefined, arm: number): number[] {
  const asked = (raw ?? '')
    .split(',')
    .map((part) => Number.parseFloat(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set([arm, ...asked])].sort((left, right) => left - right);
}

/** A positive integer from the environment, or the default when the variable is absent or unusable. */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** The widest prefix any part of a run asks for: **a depth nothing slices at is a depth that measures nothing wider**. */
function retrievalDepth(arm: number, ...sweeps: ReadonlyArray<ReadonlyArray<number>>): number {
  return Math.max(arm, ...sweeps.flat());
}

/** The depths a sweep asks for: positive integers, ascending, **without duplicates**, always including the arm. */
function readDepthSweep(raw: string | undefined, arm: number): number[] {
  const asked = (raw ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set([arm, ...asked])].sort((left, right) => left - right);
}

/**
 * **Which collection the answers are retrieved from, and therefore which published table this figure may be put beside.**
 *
 * `test-split` retrieves from the 500 functions the corpus file carries, one answer per question. That is a real
 * measurement of the product and **it is not the pool a published CoSQA table uses**: those retrieve from the collection's
 * whole unique function set, so a recall at rank one on 500 candidates and one on six thousand are two different
 * questions and this repository will not rank them against each other.
 *
 * `all` closes that gap by writing the remaining unique functions of `cosqa-all.json` into the index as distractors.
 * **The answers do not move** - a distractor file is named `distractor_######.py` and the answer of question *i* stays
 * `code_###.py`, so the rank a hit is scored at is computed the same way in both pools and the only variable is what
 * else was in the collection. Default `test-split` because it is what every figure so far was measured at, and a
 * default that changes under a published number is the defect the provenance block exists to prevent.
 */
const POOL = process.env['COSQA_POOL'] === 'all' ? 'all' : 'test-split';

interface CosqaRow {
  idx: string;
  doc: string;
  code: string;
}

interface Metrics {
  queries: number;
  recallAt1: number;
  recallAt5: number;
  recallAt10: number;
  mrrAt10: number;
  foundAt10: number;
}

/** Recall at each cut plus MRR@10, **the arithmetic the published tables use**. */
function score(ranks: ReadonlyArray<number | null>): Metrics {
  const within = (cut: number): number =>
    ranks.filter((rank) => rank !== null && rank <= cut).length;
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return {
    queries: ranks.length,
    recallAt1: round(within(1) / ranks.length),
    recallAt5: round(within(5) / ranks.length),
    recallAt10: round(within(10) / ranks.length),
    // **The accumulator is typed**, because `Array<number | null>` would otherwise make `sum` nullable and the
    // arithmetic would read as `null + 1` to the compiler.
    mrrAt10: round(
      ranks.reduce<number>((sum, rank) => sum + (rank !== null && rank <= 10 ? 1 / rank : 0), 0) /
        ranks.length,
    ),
    foundAt10: within(10),
  };
}

/**
 * **A quantile of the evidence the classifier saw, so the split can be checked rather than trusted.**
 *
 * Nearest-rank rather than an interpolated quantile: the values are a share of a small set of distinct terms, and an
 * interpolated 0.5 would report a number between two of them that no question produced.
 */
function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return Math.round(sorted[at]! * 10000) / 10000;
}

/** Whether a 1-based rank is inside the published cut. **`null` is absent rather than last**, so it is never inside. */
function isWithinTen(rank: number | null | undefined): boolean {
  // **A rank is 1-based**, so zero is a counter that was never incremented rather than a hit at the front.
  return rank !== null && rank !== undefined && rank > 0 && rank <= 10;
}

/**
 * **The distraction set, as a pure function so it can be checked without the corpus.**
 *
 * Three things have to hold for a pool to be the published one rather than a larger number on a label: the answers
 * themselves are not in it (a duplicate of an answer is a second correct hit, which would flatter recall), a function
 * that appears twice is one function, and a row whose `code` is missing or is not a string contributes nothing rather
 * than an empty file that the scanner would index as a real candidate.
 */
function distractorFunctions(
  collection: ReadonlyArray<unknown>,
  answers: ReadonlyArray<string>,
): string[] {
  const seen = new Set(answers);
  const kept: string[] = [];
  for (const row of collection) {
    const code = (row as { code?: unknown } | null)?.code;
    if (typeof code !== 'string' || code.length === 0 || seen.has(code)) continue;
    seen.add(code);
    kept.push(code);
  }
  return kept;
}

describe('the distractor set is what makes a pool the published one', () => {
  it('keeps every function that is not an answer, once, and nothing that is not code', () => {
    const answers = ['def a(): pass'];
    const collection: unknown[] = [
      { code: 'def a(): pass' },
      { code: 'def b(): pass' },
      { code: 'def b(): pass' },
      { code: '' },
      { code: 42 },
      { doc: 'this row has no code' },
      null,
      { code: 'def c(): pass' },
    ];

    // **Order is first-seen**, so the files written from it are the same files on every run and a diff of two artifacts
    // is a diff of the measurement rather than of an iteration order.
    expect(distractorFunctions(collection, answers)).toEqual(['def b(): pass', 'def c(): pass']);
  });

  it('adds nothing when the collection is the answers', () => {
    expect(distractorFunctions([{ code: 'x' }, { code: 'y' }], ['x', 'y'])).toEqual([]);
  });
});

describe('a depth that came from the environment is still a depth', () => {
  it('reads a positive integer and refuses everything else', () => {
    expect(readPositiveInt('120', 50)).toBe(120);
    // **An absent or blank variable is the default**, which is the arm every published figure was measured on.
    expect(readPositiveInt(undefined, 50)).toBe(50);
    expect(readPositiveInt('   ', 50)).toBe(50);
    // **Zero, a negative and a word are not depths**, and a run that treated them as one would query a pool of nothing.
    expect(readPositiveInt('0', 50)).toBe(50);
    expect(readPositiveInt('-3', 50)).toBe(50);
    expect(readPositiveInt('all', 50)).toBe(50);
    // **`parseInt` reads a prefix**, and `10x` is the depth the operator typed followed by a typo rather than a new one.
    expect(readPositiveInt('10x', 50)).toBe(10);
  });

  it('always includes the arm, deduplicates, and orders the sweep', () => {
    expect(readDepthSweep(undefined, 50)).toEqual([50]);
    expect(readDepthSweep('200,100,50', 50)).toEqual([50, 100, 200]);
    // **The arm is in every sweep**, because the fused column the reranked column is compared against is the arm's own.
    expect(readDepthSweep('100,200', 50)).toEqual([50, 100, 200]);
    expect(readDepthSweep('100,100,100', 50)).toEqual([50, 100]);
    expect(readDepthSweep(' 25 , bad ,7 ', 50)).toEqual([7, 25, 50]);
    expect(readDepthSweep('', 50)).toEqual([50]);
  });

  it('widens the retrieval to the deepest prefix anything slices at', () => {
    // **The defect this guards is silent**: a run that reranked at a hundred while the vector search returned fifty would
    // slice a fifty-entry list and report the deeper pool as worth nothing.
    expect(retrievalDepth(50, [50], [50])).toBe(50);
    expect(retrievalDepth(50, [50, 100], [50])).toBe(100);
    expect(retrievalDepth(50, [50], [50, 200])).toBe(200);
    // **No sweep at all still produces the arm's own depth**, because the arm is the one depth a run always scores.
    expect(retrievalDepth(75, [], [])).toBe(75);
  });

  it('counts a rank inside the cut and an absent answer outside it', () => {
    expect(isWithinTen(1)).toBe(true);
    expect(isWithinTen(10)).toBe(true);
    expect(isWithinTen(11)).toBe(false);
    // **Absent is not last**: a question whose answer no channel returned is not inside any cut.
    expect(isWithinTen(null)).toBe(false);
    expect(isWithinTen(undefined)).toBe(false);
    // **Zero is not a rank**: a 1-based counter that never fired is not a hit at the front of the list.
    expect(isWithinTen(0)).toBe(false);
  });
});

describe('a fusion weight that came from the environment is still a weight', () => {
  it('reads a positive number, including a fraction, and refuses everything else', () => {
    expect(readPositiveNumber('2', 1)).toBe(2);
    // **A weight is not an integer**: `0.5` says the lexical list counts double, which is a real arm.
    expect(readPositiveNumber('0.5', 1)).toBe(0.5);
    expect(readPositiveNumber(undefined, 1)).toBe(1);
    expect(readPositiveNumber('', 1)).toBe(1);
    // **Zero, a negative and a word are not weights**, and a zero weight would silently delete a channel.
    expect(readPositiveNumber('0', 1)).toBe(1);
    expect(readPositiveNumber('-2', 1)).toBe(1);
    expect(readPositiveNumber('heavy', 1)).toBe(1);
  });

  it('always includes the shipped weight, deduplicates, and orders the sweep', () => {
    expect(readNumberSweep(undefined, 1)).toEqual([1]);
    expect(readNumberSweep('3,2,1', 1)).toEqual([1, 2, 3]);
    expect(readNumberSweep('2,3', 1)).toEqual([1, 2, 3]);
    expect(readNumberSweep('0.5,0.5,2', 1)).toEqual([0.5, 1, 2]);
    expect(readNumberSweep(' 0.25 , bad ,4 ', 1)).toEqual([0.25, 1, 4]);
    expect(readNumberSweep('', 1)).toEqual([1]);
  });
});

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe.skipIf(!DATASET_DIR || !HAS_VECTORS)(
  'CoSQA retrieval, on the corpus the field reports on',
  () => {
    it('indexes the corpus as a repository and measures the product on 500 questions', async () => {
      const dir = resolve(DATASET_DIR!);
      const testFile = join(dir, 'cosqa-retrieval-test-500.json');
      const rows = JSON.parse(readFileSync(testFile, 'utf8')) as CosqaRow[];

      // **One file per answer, written where the scanner will find it.** The corpus is a list of functions rather than a
      // repository, so this is the smallest honest shape: the product indexes code it can see, and the pool is every
      // function in the test split.
      // **`mkdtempSync`, because `pid` and a timestamp are a name two workers can agree on** - which is the whole of
      // what the alert says and none of what "random enough" answers.
      const workdir = mkdtempSync(join(tmpdir(), 'cosqa-'));
      // **The answer of row i is the file `code_<i>.py`**, which is how a retrieved node is traced back to a question.
      rows.forEach((row, index) => {
        writeFileSync(join(workdir, `code_${String(index).padStart(3, '0')}.py`), row.code, 'utf8');
      });

      // **The distractors, when the pool is the published one.** Every unique function of the collection that is not one
      // of the 500 answers goes into the index under a name the answer regex does not match, so a hit can never be
      // mistaken for an answer and the ranks stay comparable with the `test-split` figure.
      let distractors = 0;
      if (POOL === 'all') {
        const allPath = join(dir, 'cosqa-all.json');
        const collection = JSON.parse(readFileSync(allPath, 'utf8')) as unknown[];
        const extra = distractorFunctions(
          collection,
          rows.map((row) => row.code),
        );
        extra.forEach((code, at) => {
          writeFileSync(
            join(workdir, `distractor_${String(at).padStart(6, '0')}.py`),
            code,
            'utf8',
          );
        });
        distractors = extra.length;
        // **A pool that quietly stayed at 500 would produce a figure labelled `all`**, which is worse than not running:
        // the collection file must actually add an order of magnitude, and this is the check that says so.
        expect(distractors).toBeGreaterThan(5_000);
      }

      try {
        const ctx = {
          projectId: 'cosqa',
          rootPath: workdir,
          config: getDefaultConfig(),
          signal: new AbortController().signal,
          metadata: {},
        } as unknown as PipelineContext;

        const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
        expect(pipeline.errors.map((e) => e.phaseId).filter((id) => id !== 'tools')).toEqual([]);

        // **The docstring is stripped**, for the same reason the paraphrase corpus strips it: the CoSQA question is a
        // paraphrase of documentation, and leaving docstrings in the index would let the retriever copy the question.
        const stripped = new Map<number, GraphNode>();
        for (const node of pipeline.graph.nodes.values()) {
          const {
            embedding: _e,
            embeddingBackend: _b,
            ...rest
          } = (node.properties ?? {}) as {
            embedding?: unknown;
            embeddingBackend?: unknown;
          };
          stripped.set(node.id, { ...node, docstring: null, properties: rest });
        }

        const {
          results: vectors,
          backend,
          reason,
        } = await generateEmbeddings(stripped, defaultEmbedderLoader);
        const vectorById = new Map(vectors.map((v) => [v.nodeId, v.embedding]));

        const store = new InMemoryGraphStore();
        const vectorByStoreId = new Map<number, Float32Array>();
        for (const node of stripped.values()) {
          const vector = vectorById.get(node.id);
          const storeId = store.insertNode({
            ...node,
            properties: vector
              ? { ...node.properties, embedding: vector, embeddingBackend: backend }
              : node.properties,
          });
          if (vector) vectorByStoreId.set(storeId, Float32Array.from(vector));
        }

        const queryEmbedder = await createQueryEmbedder(backend);
        const hybrid = new HybridSearchEngine(store);
        hybrid.initialize();
        if (queryEmbedder) {
          hybrid.registerEmbeddings(
            (nodeId) => vectorByStoreId.get(nodeId) ?? null,
            (text) => queryEmbedder.embed(text),
          );
        }
        const lexicalEngine = new HybridSearchEngine(store);
        lexicalEngine.initialize();

        /** The file index a hit belongs to, which is the answer's identity in this corpus. */
        const fileIndex = (hit: { node: GraphNode }): number | null => {
          const match = /code_(\d{3})\.py$/.exec(hit.node.filePath ?? '');
          return match ? Number.parseInt(match[1]!, 10) : null;
        };

        const lexicalRanks: Array<number | null> = [];
        const vectorRanks: Array<number | null> = [];
        // **One rank list per depth**, because a sweep is the only way to say where recall is built: the same two
        // channel lists are truncated at each depth, so the columns differ by what the reranker could have seen.
        const fusedRanksByDepth = new Map<number, Array<number | null>>(
          SWEEP.map((depth) => [depth, [] as Array<number | null>]),
        );
        // **And one rank list per fusion weight**, because the first run's diagnostic said the loss was here: at the
        // collection pool the vector channel alone has the answer in its top ten **354** times, the lexical channel
        // **206**, either of them **378** — and the fused list only **329**. **A compromise between a strong list and a
        // weak one is a worse list**, and reciprocal rank fusion is what makes the compromise unless the weight says so.
        const fusedRanksByWeight = new Map<number, Array<number | null>>(
          VECTOR_WEIGHTS.map((weight) => [weight, [] as Array<number | null>]),
        );
        // **The arm the product now runs**: one weight per question, read off the lexical answer's own words.
        //
        // §29 established that the two corpora point in opposite directions and that one constant must therefore be
        // wrong for one of them; §30 replaces the constant with `deriveVectorWeight`, and **this is the column that says
        // whether the replacement beats the constant it replaced on the corpus that motivated it**. The weight is
        // derived from the same two lists the arm fuses - not from a wider one - because a weight computed from a list
        // the caller never sees is a measurement of a different retrieval.
        // **One rank column per rerank depth**, including the arm's own, so a second depth is a column rather than a
        // second run. §30.5's open question was "does a deeper pool change the post-rerank gap", and a job that measured
        // the deeper arm alone would answer it with the model's run-to-run variance in the difference.
        const derivedByDepth = new Map<number, Array<number | null>>(
          RERANK_DEPTHS.map((depth) => [depth, [] as Array<number | null>]),
        );
        const derivedWeights: number[] = [];
        const evidences: number[] = [];
        /**
         * **The two-sided candidate's column, and the two numbers it is made of.**
         *
         * `deriveVectorWeight` reads the lexical list alone and §38.1 measured what that costs on a corpus it was not
         * fitted to: the rule derives the top of the weight range for a paraphrase, and a paraphrase is exactly the case
         * where *neither* list can spell the question. `evidenceRatioWeight` asks the comparative question instead -
         * which list carries more of it - and this is the arm that decides whether the comparison is worth the two
         * extra statistics (§39).
         *
         * **The evidence columns are published rather than summarised**, because a rule is a claim about a distribution
         * and a reader who cannot see the distribution can only take the claim on trust.
         */
        const candidateWeights: number[] = [];
        const candidateRanks: Array<number | null> = [];
        const lexicalEvidence: number[] = [];
        const vectorEvidence: number[] = [];
        /**
         * **The reranker's columns and its bill, keyed `${arm}@${depth}`.**
         *
         * The arm is in the key because the two arms are reranked in the same run (§28's rule: a difference smaller than
         * the model's own variance cannot be attributed), and the depth is in the key because a wider pool is a
         * different question about the same model.
         */
        const rerankedByKey = new Map<string, Array<number | null>>();
        const reorderedByKey = new Map<string, number>();
        const rescuedByKey = new Map<string, number>();
        const lostByKey = new Map<string, number>();
        /** **What the calls were billed**, in the vendor's own tokens and in dollars, per arm and depth. */
        const billByKey = new Map<
          string,
          {
            calls: number;
            promptTokens: number;
            completionTokens: number;
            usd: number;
            unpriced: number;
          }
        >();
        for (const depth of RERANK_DEPTHS) {
          for (const armKey of ['derived', 'constant']) {
            const key = `${armKey}@${depth}`;
            // **Pre-sized rather than appended.** A sequential loop could push in question order and get the same list;
            // a concurrent one cannot, and an array filled by completion order is a column permuted by the network. The
            // slot is the contract `mapWithConcurrency` keeps.
            rerankedByKey.set(key, new Array<number | null>(rows.length).fill(null));
            reorderedByKey.set(key, 0);
            rescuedByKey.set(key, 0);
            lostByKey.set(key, 0);
            billByKey.set(key, {
              calls: 0,
              promptTokens: 0,
              completionTokens: 0,
              usd: 0,
              unpriced: 0,
            });
          }
        }
        const provider = CAN_ASK_A_MODEL ? new DeepSeekProvider({ timeout: 60_000 }) : null;

        /**
         * **One rerank of one list, collected rather than awaited.**
         *
         * The two lists a question needs are pure arithmetic over the fusion; only the completion is slow, and only the
         * completion is independent. Collecting them lets the queue be `RERANK_CONCURRENCY` deep while every column
         * still lands in its question's own position.
         */
        interface RerankTask {
          rowIndex: number;
          key: string;
          question: string;
          hits: HybridSearchResult[];
          fusedRank: number | null;
        }
        const rerankTasks: RerankTask[] = [];
        /** **Limits and failures counted, because a run that was throttled is not a run that measured nothing.** */
        const rerankCalls = { failures: 0, rateLimitRetries: 0, emptyAnswers: 0 };
        /**
         * **Why a call failed, counted by the reason rather than only counted.**
         *
         * The first concurrent run reported `failures: 1` and could not say what it was - so the number raised a question
         * the artifact could not answer, which is the shape of a figure that will be misread later. The reasons are
         * grouped because they repeat: a timeout is one sentence, and a hundred timeouts are the same sentence.
         */
        const failureReasons: Record<string, number> = {};
        /**
         * **How many columns each key actually received, which is what a pre-sized array cannot show.**
         *
         * A slot that was never written decodes as `-`, and `-` is also the honest value for "the answer was not
         * returned" - so a concurrent run that dropped a task would publish a column indistinguishable from a retrieval
         * that failed on that question. The counter is the only thing that separates the two, and it is published.
         */
        const writtenByKey = new Map<string, number>();

        /** The 1-based rank at which a question's own answer sits in a hit list, or `null` when it is absent. */
        const rankOf = (
          hits: ReadonlyArray<{ node: GraphNode }>,
          answer: number,
        ): number | null => {
          const at = hits.findIndex((hit) => fileIndex(hit) === answer);
          return at >= 0 ? at + 1 : null;
        };

        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!;

          const lexicalHits = lexicalEngine.bm25Search(row.doc);
          lexicalRanks.push(rankOf(lexicalHits, index));

          // **One query embedding for every depth in the sweep**, which is what makes the curve free: the vector list
          // is produced once at the widest depth and each arm reads a prefix of it.
          const vectorHits = await hybrid.vectorSearch(row.doc, RETRIEVAL_DEPTH, null);
          vectorRanks.push(rankOf(vectorHits, index));

          /** The two channel prefixes fused at one depth and one weight - the only place fusion is called in this loop. */
          const fuseAt = (at: number, weight: number): HybridSearchResult[] =>
            hybrid.fuseResults(
              lexicalHits.slice(0, at).map((hit) => ({ node: hit.node, score: hit.score })),
              vectorHits.slice(0, at).map((hit) => ({ node: hit.node, score: hit.score })),
              60,
              at,
              weight,
            );

          for (const depth of SWEEP) {
            fusedRanksByDepth.get(depth)!.push(rankOf(fuseAt(depth, 1), index));
          }

          // **The same two channel lists, fused at each weight**, which costs one more pass over fifty entries and no
          // model call at all. The arm itself stays at weight one: a run that scores a different arm than it reranks
          // would be the §26 defect again, one field over.
          for (const weight of VECTOR_WEIGHTS) {
            fusedRanksByWeight.get(weight)!.push(rankOf(fuseAt(DEPTH, weight), index));
          }

          // **The weight is derived from the product's own depth**, once, and applied unchanged to a deeper list: it is a
          // statement about the question ("does the lexical answer carry its words"), and a statement about the question
          // does not change because the pool around the answer got wider.
          const derivedWeight = deriveVectorWeight(
            lexicalHits.slice(0, DEPTH).map((hit) => ({ node: hit.node, score: hit.score })),
            vectorHits.slice(0, DEPTH).map((hit) => ({ node: hit.node, score: hit.score })),
            row.doc,
          );
          derivedWeights.push(derivedWeight);
          evidences.push(selfEvidence(row.doc, lexicalHits[0]?.node));

          // **The comparison, computed from the same two prefixes the arm above fused** - so the two columns differ in
          // the rule and in nothing else: no second search, no model, no wider list. Two numbers, one division.
          const lexicalAtProductDepth = lexicalHits
            .slice(0, DEPTH)
            .map((hit) => ({ node: hit.node, score: hit.score }));
          const vectorAtProductDepth = vectorHits
            .slice(0, DEPTH)
            .map((hit) => ({ node: hit.node, score: hit.score }));
          const lexicalShare = channelEvidence(row.doc, lexicalAtProductDepth, EVIDENCE_DEPTH);
          const vectorShare = channelEvidence(row.doc, vectorAtProductDepth, EVIDENCE_DEPTH);
          lexicalEvidence.push(lexicalShare);
          vectorEvidence.push(vectorShare);
          const candidateWeight = evidenceRatioWeight(
            lexicalAtProductDepth,
            vectorAtProductDepth,
            row.doc,
          );
          candidateWeights.push(candidateWeight);
          candidateRanks.push(rankOf(fuseAt(DEPTH, candidateWeight), index));

          for (const depth of RERANK_DEPTHS) {
            derivedByDepth.get(depth)!.push(rankOf(fuseAt(depth, derivedWeight), index));
          }

          if (provider) {
            // **Collected, not awaited.** The lists are arithmetic and the completion is the only slow part; issuing it
            // here would make the queue one deep and the run 85 minutes long (see `RERANK_CONCURRENCY`).
            for (const depth of RERANK_DEPTHS) {
              const constantList = fuseAt(depth, 1);
              rerankTasks.push({
                rowIndex: index,
                key: `constant@${depth}`,
                question: row.doc,
                hits: constantList,
                fusedRank: rankOf(constantList, index),
              });

              const derivedList = fuseAt(depth, derivedWeight);
              rerankTasks.push({
                rowIndex: index,
                key: `derived@${depth}`,
                question: row.doc,
                hits: derivedList,
                fusedRank: rankOf(derivedList, index),
              });
            }
          }
        }

        /**
         * **Every rerank, issued with `RERANK_CONCURRENCY` in flight and each column written to its question's slot.**
         *
         * The body below is the same experiment the sequential loop ran - one prompt shape, one temperature, one tag,
         * the same bill - and the only thing that changed is how many were open at once. **A failure still leaves the
         * fused order**, which is `rerankCandidates`' contract; what is new is that a failure is counted here rather
         * than disappearing into a column, because a throttled arm reported as "no opinion" is the measurement error
         * concurrency would otherwise introduce.
         */
        if (provider) {
          await mapWithConcurrency(rerankTasks, RERANK_CONCURRENCY, async (task) => {
            const entries = task.hits.map((hit, position) => ({ rank: position + 1, hit }));
            const result = await rerankCandidates(
              task.question,
              entries,
              (entry) => ({
                rank: entry.rank,
                name: entry.hit.node.name,
                qualifiedName: entry.hit.node.qualifiedName,
                filePath: entry.hit.node.filePath,
                signature: entry.hit.node.signature,
                excerpt:
                  typeof entry.hit.node.properties['body'] === 'string'
                    ? entry.hit.node.properties['body'].slice(0, 240)
                    : null,
              }),
              provider,
              { timeout: 60_000 },
            );

            if (result.applied) reorderedByKey.set(task.key, reorderedByKey.get(task.key)! + 1);
            if (result.rateLimitRetries !== undefined) {
              rerankCalls.rateLimitRetries += result.rateLimitRetries;
            }
            if (result.reason?.startsWith('rerank failed') === true) {
              rerankCalls.failures += 1;
              const reason = result.reason.slice(0, 160);
              failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
            }
            if (result.reason === 'the answer contained no usable candidate number') {
              rerankCalls.emptyAnswers += 1;
            }

            // **The bill, summed from the calls rather than estimated from an average**: the provider returns the
            // tokens and the amount, and a report that multiplied a per-call guess by five hundred was the weaker of
            // the two numbers it could have had. **The additions are synchronous**, so two in flight cannot lose one:
            // the only `await` in this body has already resolved.
            const bill = billByKey.get(task.key)!;
            if (result.cost) {
              bill.calls += 1;
              bill.promptTokens += result.cost.usage?.promptTokens ?? 0;
              bill.completionTokens += result.cost.usage?.completionTokens ?? 0;
              // **An unpriced model is counted, not folded in as zero**: a total that absorbed it would report a bill
              // smaller than the one that was paid.
              if (result.cost.usd === undefined) bill.unpriced += 1;
              else bill.usd += result.cost.usd;
            }

            // **The rank the answer lands at after the reorder**: `indexOf` inside the ordered list, not its fused
            // rank, because the whole point of the reorder is that the two differ.
            const at = result.ordered.findIndex((entry) => fileIndex(entry.hit) === task.rowIndex);
            const rank = at >= 0 ? at + 1 : null;
            rerankedByKey.get(task.key)![task.rowIndex] = rank;
            writtenByKey.set(task.key, (writtenByKey.get(task.key) ?? 0) + 1);

            // **A reorder is only worth its completions if it moves the answer.** Two directions, both counted.
            if (task.fusedRank === null || task.fusedRank > 10) {
              if (rank !== null && rank <= 10) {
                rescuedByKey.set(task.key, rescuedByKey.get(task.key)! + 1);
              }
            } else if (rank === null || rank > 10) {
              lostByKey.set(task.key, lostByKey.get(task.key)! + 1);
            }
          });
        }

        /**
         * **The columns the published figures are about, at the arm's own depth.**
         *
         * A two-depth run is four columns, and only one of them is the product: the deeper arms are the measurement of a
         * lever. Aliasing rather than duplicating means the top-level fields and the per-depth tables cannot disagree -
         * they are the same array.
         */
        const derivedRanks = derivedByDepth.get(DEPTH)!;
        const rerankedRanks = rerankedByKey.get(`derived@${DEPTH}`)!;
        const rerankedConstantRanks = rerankedByKey.get(`constant@${DEPTH}`)!;
        const reranked = reorderedByKey.get(`derived@${DEPTH}`)!;
        const rerankedConstant = reorderedByKey.get(`constant@${DEPTH}`)!;
        const rescued = rescuedByKey.get(`derived@${DEPTH}`)!;
        const lost = lostByKey.get(`derived@${DEPTH}`)!;
        const rescuedConstant = rescuedByKey.get(`constant@${DEPTH}`)!;
        const lostConstant = lostByKey.get(`constant@${DEPTH}`)!;

        const artifact = {
          comment: [
            'Retrieval on **CoSQA** (Huang et al.), the corpus the code-search literature reports on.',
            '',
            ...(POOL === 'all'
              ? [
                  "**The pool is the collection's whole unique function set**, which is the pool the published CoSQA",
                  'tables retrieve from - so this figure may be put beside them, and `pool.distractors` says how much of',
                  'it is material no question asks for. **The models in those tables are fine-tuned on CoSQA and this one',
                  'is not**, which is the difference that makes an equal number a stronger result here rather than a',
                  'weaker one.',
                ]
              : [
                  '**The pool is the 500 functions of the test split, not the full collection**, so these numbers are not',
                  'directly comparable with published tables that retrieve from the whole function set. The pool size is',
                  'in this artifact so a reader can see exactly what was measured, and `COSQA_POOL=all` is the arm that',
                  'closes the gap.',
                ]),
            '',
            '**Docstrings are stripped from the index** for the same reason `paraphrase-search` strips them: the question',
            'is a paraphrase of documentation, and an index that keeps the documentation lets the retriever copy it.',
            '',
            '**The product as shipped**: BM25 + vectors fused at weight 1, and the same list reordered listwise when a',
            'model is available.',
          ],
          dataset: {
            name: 'CoSQA retrieval, test split',
            source: 'Jun-jie-Huang/CoCLR · data/search/cosqa-retrieval-test-500.json',
            sha256: sha256(testFile),
            // **The distractors' own provenance**, because a pool assembled from two files is a pool whose size depends
            // on both, and a figure that named one of them would be a figure that cannot be re-derived.
            ...(POOL === 'all'
              ? {
                  distractorSource: 'Jun-jie-Huang/CoCLR · data/qa/cosqa-all.json',
                  distractorSha256: sha256(join(dir, 'cosqa-all.json')),
                }
              : {}),
          },
          measuredAt: new Date().toISOString().slice(0, 10),
          pool: {
            functions: rows.length + distractors,
            answers: rows.length,
            distractors,
            source: POOL,
            docstrings: 'stripped',
          },
          space: {
            index: backend,
            query: queryEmbedder?.backend ?? 'none',
            reason: reason ?? null,
          },
          // **A string rather than an array**, because `JSON.stringify` expands `[1, 5, 10]` onto four lines and
          // Prettier collapses it back — which is how a generated artifact fails `prettier --check` in CI while being
          // perfectly correct JSON.
          cuts: CUTS,
          depths: { rerank: DEPTH, sweep: SWEEP.join(','), retrieval: RETRIEVAL_DEPTH },
          // **How the completions were issued**, because a queue depth is part of an experiment's conditions: two runs
          // of the same arms at different concurrency that disagree are two conditions rather than a replication, and
          // `failures` is the number that says whether the fast one measured anything. `rateLimitRetries` counts waits
          // that were retried into a real answer, so a reader can tell "answered" from "answered after being throttled".
          rerankCalls: { concurrency: RERANK_CONCURRENCY, ...rerankCalls, failureReasons },
          lexical: score(lexicalRanks),
          // **The arm the figure below is put beside**: the fused list truncated at the depth the reranker saw, which is
          // the only comparison that isolates the reorder from the candidates it was given.
          fused: score(fusedRanksByDepth.get(DEPTH)!),
          // **The depth curve, which is free to measure and is the only lever that can move `found@10`.**
          //
          // A key per depth rather than an array, because a reader comparing two artifacts wants to diff one number and
          // a list whose positions move is a diff of the sweep rather than of the measurement.
          sweep: Object.fromEntries(
            SWEEP.map((depth) => [String(depth), score(fusedRanksByDepth.get(depth)!)]),
          ),
          // **The fusion weight, which is the column the first sweep pointed at.** A reader comparing two artifacts can
          // see whether a change to the weight moved `found@10`, and `fused` above stays the arm at weight one.
          fusedByVectorWeight: Object.fromEntries(
            VECTOR_WEIGHTS.map((weight) => [
              String(weight),
              score(fusedRanksByWeight.get(weight)!),
            ]),
          ),
          // **The arm the product runs now, beside the constant it replaced.** `weights` is how the 500 questions were
          // split between the two bounds and the neutral middle, and `selfEvidence` is the statistic that split them -
          // a figure a reader can check against the corpus rather than a threshold they have to trust.
          derived: {
            ...score(derivedRanks),
            weights: {
              lexical: derivedWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.min).length,
              neutral: derivedWeights.filter((w) => w === 1).length,
              semantic: derivedWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.max).length,
            },
            selfEvidence: {
              p10: percentile(evidences, 0.1),
              p50: percentile(evidences, 0.5),
              p90: percentile(evidences, 0.9),
            },
          },
          // **The two-sided candidate, beside the one-sided rule it would replace** - measured here and nowhere else
          // until this run, because a rule that only its own unit test had called is a rule with no figure (§39).
          candidate: {
            ...score(candidateRanks),
            weight: {
              min: percentile(candidateWeights, 0),
              p10: percentile(candidateWeights, 0.1),
              p50: percentile(candidateWeights, 0.5),
              p90: percentile(candidateWeights, 0.9),
              max: percentile(candidateWeights, 1),
              atFloor: candidateWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.min).length,
              atCeiling: candidateWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.max).length,
            },
            evidence: {
              lexicalP50: percentile(lexicalEvidence, 0.5),
              vectorP50: percentile(vectorEvidence, 0.5),
              // **The share of questions the two-sided rule gives the vector list more than half the vote**, which is
              // the number that says whether the rule discriminates at all or simply sits near one.
              vectorAhead: lexicalEvidence.filter((value, at) => vectorEvidence[at]! > value)
                .length,
            },
          },
          // **Where the ceiling is, channel by channel.** `neither` is the number of questions no widening of these two
          // lists can help, and it is the honest denominator for "a better first stage" - every other question has its
          // answer somewhere in the pool and is a ranking problem rather than a recall one.
          retrieval: {
            lexicalInTop10: lexicalRanks.filter((rank) => rank !== null && rank <= 10).length,
            vectorInTop10: vectorRanks.filter((rank) => rank !== null && rank <= 10).length,
            eitherInTop10: lexicalRanks.filter(
              (rank, at) => (rank !== null && rank <= 10) || isWithinTen(vectorRanks[at]),
            ).length,
            neitherInChannelDepth: lexicalRanks.filter(
              (rank, at) => rank === null && vectorRanks[at] === null,
            ).length,
          },
          ...(provider
            ? {
                // **The product's arm**: the fused list the engine now produces, then the same reorder.
                reranked: { ...score(rerankedRanks), reordered: reranked, from: 'derived' },
                rerankEffect: { reordered: reranked, rescued, lost, net: rescued - lost },
                // **The arm every earlier run published**, reranked in this same run so that the difference between the
                // two columns is the fusion weight rather than the reranker's run-to-run variance.
                rerankedConstant: {
                  ...score(rerankedConstantRanks),
                  reordered: rerankedConstant,
                  from: 'weight-1',
                },
                rerankEffectConstant: {
                  reordered: rerankedConstant,
                  rescued: rescuedConstant,
                  lost: lostConstant,
                  net: rescuedConstant - lostConstant,
                },
                // **The second depth, when a run was asked for one.** `COSQA_RERANK_DEPTHS=50,100` reranks both arms
                // twice inside one job, and this is where the pair is published: the same questions, the same model,
                // the same prompt shape, and a pool twice as wide.
                rerankByDepth: Object.fromEntries(
                  RERANK_DEPTHS.map((depth) => [
                    String(depth),
                    {
                      // **The column, not only its aggregate.** §34.2 registered this as the one thing missing: the
                      // per-depth figures were published beside a per-depth paired verdict whose inputs a reader could
                      // not decode, so the depth contrast was two totals from one harness run rather than the paired
                      // test every other figure in this project is. **The column is what makes the verdict checkable**,
                      // and it costs one string per arm.
                      derived: {
                        ...score(rerankedByKey.get(`derived@${depth}`)!),
                        reordered: reorderedByKey.get(`derived@${depth}`)!,
                        rescued: rescuedByKey.get(`derived@${depth}`)!,
                        lost: lostByKey.get(`derived@${depth}`)!,
                        covered: writtenByKey.get(`derived@${depth}`) ?? 0,
                        ranks: encodeRanks(rerankedByKey.get(`derived@${depth}`)!),
                      },
                      constant: {
                        ...score(rerankedByKey.get(`constant@${depth}`)!),
                        reordered: reorderedByKey.get(`constant@${depth}`)!,
                        rescued: rescuedByKey.get(`constant@${depth}`)!,
                        lost: lostByKey.get(`constant@${depth}`)!,
                        covered: writtenByKey.get(`constant@${depth}`) ?? 0,
                        ranks: encodeRanks(rerankedByKey.get(`constant@${depth}`)!),
                      },
                      // **The two arms tested against each other *at this depth*.** The top-level
                      // `paired.rerankedDerivedVsConstant` is the arm's own depth only, so a two-depth artifact used to
                      // publish an arm contrast its reader could not test at the second depth - a figure without
                      // evidence, which is the defect the whole `paired` block exists to remove. It is arithmetic on
                      // columns already in memory, so it costs nothing to publish it at every depth instead of one.
                      paired: compareArms(
                        rerankedByKey.get(`derived@${depth}`)!,
                        rerankedByKey.get(`constant@${depth}`)!,
                      ),
                    },
                  ]),
                ),
                // **What the reranker cost, measured rather than estimated.** Every earlier figure was a per-call
                // average multiplied by five hundred; these are the vendor's own tokens and the price table's own
                // arithmetic. A depth costs what the deeper prompt costs, and now the artifact says which.
                rerankCost: Object.fromEntries(
                  RERANK_DEPTHS.map((depth) => [
                    String(depth),
                    Object.fromEntries(
                      ['derived', 'constant'].map((armKey) => {
                        const bill = billByKey.get(`${armKey}@${depth}`)!;
                        return [
                          armKey,
                          {
                            calls: bill.calls,
                            promptTokens: bill.promptTokens,
                            completionTokens: bill.completionTokens,
                            // **Rounded to six decimal places, because a float sum of five hundred prices has
                            // seventeen digits and a bill does not.
                            usd: Math.round(bill.usd * 1_000_000) / 1_000_000,
                            unpricedCalls: bill.unpriced,
                          },
                        ];
                      }),
                    ),
                  ]),
                ),
              }
            : {
                reranked: { reason: 'DEEPSEEK_API_KEY is absent, so nothing could be reordered' },
              }),
          // **The per-question ranks, which are the difference between a figure and evidence.** Everything above is
          // an aggregate; with these columns a reader can recompute every aggregate, run a paired test between any two
          // arms of this run, and re-derive the fusion weight from `selfEvidence` - on the published artifact, without
          // the corpus, the key or the model.
          //
          // **Encoded as comma strings**, because Prettier expands an array of five hundred numbers into five hundred
          // lines and a table is what this artifact is. `decodeRanks` in `search/paired-stats.ts` is the reader.
          perQuestion: {
            note: '1-based rank of the question\'s own answer per arm, "-" when absent; decode with decodeRanks()',
            lexical: encodeRanks(lexicalRanks),
            fused: encodeRanks(fusedRanksByDepth.get(DEPTH)!),
            derived: encodeRanks(derivedRanks),
            vectorWeight: encodeRanks(derivedWeights),
            selfEvidence: evidences.map((value) => Math.round(value * 1_000) / 1_000).join(','),
            candidate: encodeRanks(candidateRanks),
            candidateWeight: encodeRanks(candidateWeights),
            // **The two numbers the candidate is made of**, at the same three decimals a rank is written at, so a
            // reader can recompute `candidateWeight` from this artifact without the corpus, the key or the model.
            lexicalEvidence: lexicalEvidence
              .map((value) => Math.round(value * 1_000) / 1_000)
              .join(','),
            vectorEvidence: vectorEvidence
              .map((value) => Math.round(value * 1_000) / 1_000)
              .join(','),
            ...(provider
              ? {
                  reranked: encodeRanks(rerankedRanks),
                  rerankedConstant: encodeRanks(rerankedConstantRanks),
                  // **The other depths' columns are not repeated here.** They live inside
                  // `rerankByDepth[<depth>][<arm>].ranks`, beside the aggregate each one produces, so a reader finds a
                  // column next to the figure it explains rather than in a second block that could drift from it.
                }
              : {}),
          },
          // **The paired tests, because a difference of two averages is a description of the instrument.** The two arms
          // were measured on the same questions in the same run; these statistics are the only ones that keep that.
          paired: {
            note: 'paired bootstrap (95 %, seed 0x5eed) over questions for MRR@10, exact McNemar for found@10',
            ...(provider
              ? {
                  rerankedDerivedVsConstant: compareArms(rerankedRanks, rerankedConstantRanks),
                  fusedDerivedVsConstant: compareArms(derivedRanks, fusedRanksByDepth.get(DEPTH)!),
                }
              : {
                  fusedDerivedVsConstant: compareArms(derivedRanks, fusedRanksByDepth.get(DEPTH)!),
                }),
            // **The candidate against both things it could be adopted over**: the one-sided rule it would replace and
            // the lexical list it would still have to beat. A rule that only beat its predecessor while losing to no
            // fusion at all would be a rule that should be turned off, and the two pairs are what tell them apart.
            candidateVsDerived: compareArms(candidateRanks, derivedRanks),
            candidateVsLexical: compareArms(candidateRanks, lexicalRanks),
            ...(provider && RERANK_DEPTHS.length > 1
              ? {
                  rerankDepthPairs: Object.fromEntries(
                    RERANK_DEPTHS.filter((depth) => depth !== DEPTH).map((depth) => [
                      `${depth}-against-${DEPTH}`,
                      {
                        derived: compareArms(rerankedByKey.get(`derived@${depth}`)!, rerankedRanks),
                        constant: compareArms(
                          rerankedByKey.get(`constant@${depth}`)!,
                          rerankedConstantRanks,
                        ),
                      },
                    ]),
                  ),
                }
              : {}),
          },
        };

        const recorded = recordArtifact('benchmarks/cosqa-retrieval.json', artifact);
        // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
        if (!recorded.written) console.log(`COSQA-RETRIEVAL artifact ${recorded.because}`);
        await queryEmbedder?.dispose().catch(() => undefined);

        // The summary line **is** the interface: the workflow greps it into the job summary.
        // eslint-disable-next-line no-console
        console.log(
          `COSQA-RETRIEVAL queries=${rows.length} pool=${rows.length + distractors} (${POOL}) depth=${DEPTH} sweep=${SWEEP.join('/')} space=${backend}/${queryEmbedder?.backend ?? 'none'} ` +
            `lexical=R@1 ${score(lexicalRanks).recallAt1}/R@10 ${score(lexicalRanks).recallAt10}/MRR ${score(lexicalRanks).mrrAt10} ` +
            `fused=R@1 ${score(fusedRanksByDepth.get(DEPTH)!).recallAt1}/R@10 ${score(fusedRanksByDepth.get(DEPTH)!).recallAt10}/MRR ${score(fusedRanksByDepth.get(DEPTH)!).mrrAt10} ` +
            (provider
              ? `rerank=R@1 ${score(rerankedRanks).recallAt1}/R@10 ${score(rerankedRanks).recallAt10}/MRR ${score(rerankedRanks).mrrAt10} rescued=${rescued} lost=${lost} ` +
                `rerankConstant=R@10 ${score(rerankedConstantRanks).recallAt10}/MRR ${score(rerankedConstantRanks).mrrAt10} rescued=${rescuedConstant} lost=${lostConstant}`
              : 'rerank=none'),
        );

        // **The sweep, one line per depth**, so the job summary carries the curve without a reader downloading JSON.
        for (const depth of SWEEP) {
          const at = score(fusedRanksByDepth.get(depth)!);
          // eslint-disable-next-line no-console
          console.log(
            `COSQA-SWEEP depth=${depth} R@1 ${at.recallAt1} R@5 ${at.recallAt5} R@10 ${at.recallAt10} MRR ${at.mrrAt10} found ${at.foundAt10}`,
          );
        }

        // **And one line per fusion weight**, which is the same two lists under a different compromise.
        for (const weight of VECTOR_WEIGHTS) {
          const at = score(fusedRanksByWeight.get(weight)!);
          // eslint-disable-next-line no-console
          console.log(
            `COSQA-WEIGHT vector=${weight} R@1 ${at.recallAt1} R@5 ${at.recallAt5} R@10 ${at.recallAt10} MRR ${at.mrrAt10} found ${at.foundAt10}`,
          );
        }

        // **The derived arm, on one line**, beside the constant it replaces: `weights` says how the questions split, so
        // a reader can tell a classifier that fired from one that never did.
        // eslint-disable-next-line no-console
        console.log(
          `COSQA-DERIVED R@1 ${score(derivedRanks).recallAt1} R@5 ${score(derivedRanks).recallAt5} R@10 ${score(derivedRanks).recallAt10} MRR ${score(derivedRanks).mrrAt10} found ${score(derivedRanks).foundAt10} ` +
            `lexicalWeight ${derivedWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.min).length} ` +
            `semanticWeight ${derivedWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.max).length} ` +
            `neutral ${derivedWeights.filter((w) => w === 1).length} ` +
            `evidence p10 ${percentile(evidences, 0.1)} p50 ${percentile(evidences, 0.5)} p90 ${percentile(evidences, 0.9)}`,
        );

        // **The two-sided candidate, on one line**, with the two distributions it is a function of: a reader decides
        // between the rules from this line and the one above it, which is why they print the same columns.
        // eslint-disable-next-line no-console
        console.log(
          `COSQA-CANDIDATE R@1 ${score(candidateRanks).recallAt1} R@5 ${score(candidateRanks).recallAt5} R@10 ${score(candidateRanks).recallAt10} MRR ${score(candidateRanks).mrrAt10} found ${score(candidateRanks).foundAt10} ` +
            `weight min ${percentile(candidateWeights, 0)} p50 ${percentile(candidateWeights, 0.5)} max ${percentile(candidateWeights, 1)} ` +
            `atFloor ${candidateWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.min).length} atCeiling ${candidateWeights.filter((w) => w === FUSION_WEIGHT_BOUNDS.max).length} ` +
            `lexicalEvidence p50 ${percentile(lexicalEvidence, 0.5)} vectorEvidence p50 ${percentile(vectorEvidence, 0.5)} ` +
            `vectorAhead ${lexicalEvidence.filter((value, at) => vectorEvidence[at]! > value).length}`,
        );

        // **The paired verdicts, on one line each**, because the job summary is where a reader decides whether a
        // difference is real: `delta` with its interval, the two discordant counts, and the exact p.
        const publishPair = (name: string, pair: ReturnType<typeof compareArms>): void => {
          // eslint-disable-next-line no-console
          console.log(
            `COSQA-PAIRED pair=${name} deltaMRR ${pair.deltaMrr.toFixed(4)} ci [${pair.mrrInterval[0].toFixed(4)},${pair.mrrInterval[1].toFixed(4)}] ` +
              `foundA ${pair.foundA} foundB ${pair.foundB} onlyA ${pair.onlyA} onlyB ${pair.onlyB} p ${pair.pValue.toFixed(4)} ` +
              `distinguishable ${pair.distinguishable}`,
          );
        };
        publishPair('derived-vs-constant-fused', artifact.paired.fusedDerivedVsConstant);
        if (provider) {
          publishPair(
            'reranked-derived-vs-constant',
            (artifact.paired as { rerankedDerivedVsConstant: ReturnType<typeof compareArms> })
              .rerankedDerivedVsConstant,
          );
        }

        // **The reranker at each depth it was asked about, with its bill**, so a second depth is a comparable row rather
        // than a paragraph: the same questions, the same model, a wider pool, and what the wider prompt cost.
        for (const depth of RERANK_DEPTHS) {
          if (!provider) break;
          for (const armKey of ['derived', 'constant'] as const) {
            const at = score(rerankedByKey.get(`${armKey}@${depth}`)!);
            const bill = billByKey.get(`${armKey}@${depth}`)!;
            // eslint-disable-next-line no-console
            console.log(
              `COSQA-RERANK-DEPTH depth=${depth} arm=${armKey} R@1 ${at.recallAt1} R@10 ${at.recallAt10} MRR ${at.mrrAt10} found ${at.foundAt10} ` +
                `rescued ${rescuedByKey.get(`${armKey}@${depth}`)!} lost ${lostByKey.get(`${armKey}@${depth}`)!} ` +
                `calls ${bill.calls} promptTokens ${bill.promptTokens} usd ${bill.usd.toFixed(6)} unpriced ${bill.unpriced}`,
            );
          }
        }

        // **The acceptance bar for the classifier, on the corpus that motivated it**: the derived arm must find at least
        // as many answers in the top ten as the constant it replaced. Both arms fuse the same two lists inside this run,
        // so the comparison carries no embedding call, no model call and none of the run-to-run variance §28 recorded.
        expect(
          score(derivedRanks).foundAt10,
          `the derived weight found ${score(derivedRanks).foundAt10} against the constant's ${score(fusedRanksByDepth.get(DEPTH)!).foundAt10}`,
        ).toBeGreaterThanOrEqual(score(fusedRanksByDepth.get(DEPTH)!).foundAt10);

        // **The only claim this file can make without a comparison**: the product finds the answer at all, and the
        // semantic half is not worse than the lexical one on a corpus neither of them was tuned on.
        expect(score(lexicalRanks).recallAt10).toBeGreaterThan(0);
        expect(score(fusedRanksByDepth.get(DEPTH)!).recallAt10).toBeGreaterThanOrEqual(
          score(lexicalRanks).recallAt10,
        );
        // **The sweep's monotonicity is deliberately not asserted.** Reciprocal rank fusion is not monotone in the
        // channel depth: a candidate at lexical rank 51 adds `1/111` to a list whose tenth entry may carry `1/71`, so a
        // wider pool can and does push an answer out of the top ten. A test that demanded monotonicity would fail on a
        // correct measurement and teach the next reader to widen a bound instead of reading the curve - which is the
        // failure this repository keeps paying for. **The curve is the finding**; the suite asserts only that every
        // depth was actually scored over the whole question set.
        for (const depth of SWEEP) {
          expect(score(fusedRanksByDepth.get(depth)!).queries).toBe(rows.length);
        }
        // **And the same for the weights**, for the same reason: a column that scored fewer questions than the corpus
        // has is a column that describes a subset nobody chose.
        for (const weight of VECTOR_WEIGHTS) {
          expect(score(fusedRanksByWeight.get(weight)!).queries).toBe(rows.length);
        }
        // **The artifact has to be readable back into the measurement it published.** A column that decodes to a
        // different list than the one it was written from is a figure that cannot be recomputed, which is the whole
        // reason the columns exist.
        const columns: Array<[string, string, ReadonlyArray<number | null>]> = [
          ['lexical', artifact.perQuestion.lexical, lexicalRanks],
          ['fused', artifact.perQuestion.fused, fusedRanksByDepth.get(DEPTH)!],
          ['derived', artifact.perQuestion.derived, derivedRanks],
          ['candidate', artifact.perQuestion.candidate, candidateRanks],
        ];
        for (const [name, encoded, source] of columns) {
          const decoded = decodeRanks(encoded, rows.length);
          expect(
            decoded,
            `perQuestion.${name} does not decode to the column it was written from`,
          ).toEqual(source);
          // **And the aggregate recomputes from the decoded column**, so the JSON carries both the figure and its
          // evidence rather than a figure a reader has to trust.
          expect(
            score(decoded),
            `perQuestion.${name} does not reproduce its own aggregate`,
          ).toEqual(score(source));
        }

        // **The paired comparisons cover every question in the corpus.** A comparison over a subset nobody chose is the
        // defect a paired test exists to prevent, and the encoder refuses it - so this gate is about the caller.
        const pairs = Object.entries(artifact.paired).filter(
          (entry): entry is [string, ReturnType<typeof compareArms>] =>
            typeof entry[1] === 'object' && entry[1] !== null && 'queries' in entry[1],
        );
        expect(pairs.length).toBeGreaterThan(0);
        for (const [name, pair] of pairs) {
          expect(
            pair.queries,
            `${name} was computed over ${pair.queries} of ${rows.length} questions`,
          ).toBe(rows.length);
          // **A percentile interval that does not contain its own point estimate is a resampling bug**, and it would
          // read as a finding.
          expect(pair.mrrInterval[0]).toBeLessThanOrEqual(pair.deltaMrr);
          expect(pair.mrrInterval[1]).toBeGreaterThanOrEqual(pair.deltaMrr);
        }

        // **Every depth that publishes two arms publishes the test between them, and now the columns it was computed
        // from.** §34.2 registered the second half: a per-depth verdict whose inputs were not in the artifact could be
        // quoted and not checked, which is the weaker of the two things a number can be.
        const rerankByDepth = (
          artifact as {
            rerankByDepth?: Record<
              string,
              {
                paired: ReturnType<typeof compareArms>;
                derived: { covered: number; ranks: string; foundAt10: number; mrrAt10: number };
                constant: { covered: number; ranks: string; foundAt10: number; mrrAt10: number };
              }
            >;
          }
        ).rerankByDepth;
        if (rerankByDepth) {
          for (const [depth, entry] of Object.entries(rerankByDepth)) {
            // **Every slot was written.** A pre-sized column that a concurrent run failed to fill would decode as `-`,
            // which is also the honest value for "the answer was not returned" - so the counter is the only thing that
            // distinguishes a dropped task from a failed retrieval, and it is asserted rather than trusted.
            expect(entry.derived.covered, `derived@${depth} did not fill every question`).toBe(
              rows.length,
            );
            expect(entry.constant.covered, `constant@${depth} did not fill every question`).toBe(
              rows.length,
            );

            const derived = decodeRanks(entry.derived.ranks, rows.length);
            const constant = decodeRanks(entry.constant.ranks, rows.length);

            // **The published column is the column that produced the published aggregate**, both of them read back from
            // the artifact rather than from memory: a run whose JSON disagreed with its own console would otherwise
            // pass here and mislead every reader of the artifact.
            expect(score(derived), `derived@${depth} disagrees with its column`).toEqual(
              score(rerankedByKey.get(`derived@${depth}`)!),
            );
            expect(score(constant), `constant@${depth} disagrees with its column`).toEqual(
              score(rerankedByKey.get(`constant@${depth}`)!),
            );
            expect(score(derived).foundAt10).toBe(entry.derived.foundAt10);
            expect(score(derived).mrrAt10).toBe(entry.derived.mrrAt10);

            expect(entry.paired.queries, `rerankByDepth.${depth}.paired covers a subset`).toBe(
              rows.length,
            );
            // **And the verdict is the one those two columns produce**, recomputed from the decoded strings rather
            // than from the arrays the run happened to hold: that is the whole difference between an artifact and a
            // log, and it is what makes the depth contrast a paired test a reader can re-run.
            expect(
              entry.paired,
              `rerankByDepth.${depth}.paired is not its columns' verdict`,
            ).toEqual(compareArms(derived, constant));
            expect(entry.paired.mrrInterval[0]).toBeLessThanOrEqual(entry.paired.deltaMrr);
            expect(entry.paired.mrrInterval[1]).toBeGreaterThanOrEqual(entry.paired.deltaMrr);
          }
        }

        // **The queue depth is recorded and legal**, because it is an experimental condition: two runs of the same arms
        // at different concurrency that disagree are two conditions, and a `0` in this field would be a run that
        // measured nothing.
        const calls = (artifact as { rerankCalls?: { concurrency: number; failures: number } })
          .rerankCalls;
        if (calls !== undefined) {
          expect(calls.concurrency).toBeGreaterThanOrEqual(1);
          expect(calls.concurrency).toBe(RERANK_CONCURRENCY);
          expect(calls.failures).toBeGreaterThanOrEqual(0);
        }
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    }, 5_400_000);
  },
);
