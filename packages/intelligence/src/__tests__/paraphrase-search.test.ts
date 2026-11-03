// A symbol found from a question somebody would actually type.
//
// **The docstring measurement cannot answer the question this file exists for.** `docstring-search.test.ts` queries a
// symbol with its own doc comment, and BM25 indexes the doc comment - so the lexical column is a *completeness* gate
// ("a documented symbol can be found by its documentation"), measured at 1.000, and a semantic list can only agree with
// it. Measured on the runner with one model on both sides, every fusion weight reproduced the lexical figure to four
// decimal places. **That is not evidence for the semantic half, and reporting it as if it were would be the same defect
// as the figure this project spent a day correcting.**
//
// So this file removes both advantages the docstring measurement hands to the retriever:
//
//   1. **The query is not the documentation.** It is a one-sentence question generated from the documentation by
//      DeepSeek, required to avoid the symbol's own name - the way a developer who does not know the name asks.
//   2. **The documentation is not in the index.** Every node is stripped of its doc comment before indexing and before
//      embedding, for every symbol, not only the queried one. A retriever that can only copy words from the text it is
//      asked about has nothing to copy.
//
// **Both halves are then measured on the same leak-free index**, so the difference between the columns is the semantic
// half and nothing else. If lexical wins on that corpus, the figure says so.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  PipelineOrchestrator,
  createAllPhases,
  createQueryEmbedder,
  defaultEmbedderLoader,
  generateEmbeddings,
} from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { recordArtifact } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { DeepSeekProvider } from '../review/llm/provider.js';
import { DEFAULT_FIELD_WEIGHTING, HybridSearchEngine } from '../search/hybrid-search.js';
import { expandToVector } from '../search/query-expansion.js';
import { rerankCandidates } from '../search/rerank.js';

import type { FieldWeighting } from '../search/hybrid-search.js';
import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

/**
 * **A snapshot, not a directory of the product - and that is the whole correction.**
 *
 * Freezing the questions and letting the corpus move is freezing half a measurement. The questions were written from
 * `packages/analyzer/src/languages` on 2026-10-26; on 2026-10-29 two refactors renamed four symbols they ask about -
 * `ArkTSProvider.walkAndCapture` became `captureTypes` (`818f9bd`) and the three `collectCLikeTaint*` helpers became one
 * `collectCLikeTaint` (`e0d5f68`). **From then on every run of this file failed**, and the failure was a fact about the
 * corpus rather than about the retriever: four questions named answers that no longer existed, and a question whose
 * answer is gone scores as a miss for both columns.
 *
 * `benchmarks/retrieval-corpus/` holds that directory as of `4ae5c62` - the last commit in which all ninety-nine names
 * still existed - so the two inputs are pinned to each other and neither can drift underneath the other. It answers all
 * ninety-nine questions at 3 600 nodes, and it is **the first corpus this file has had that cannot move**: the recorded
 * figure was measured on 2026-10-27 against the live directory at 3 357 nodes, so it is re-measured once here and then
 * only the retriever can change it. Editing the snapshot is a deliberate act in the same sense that regenerating the
 * questions is, and `benchmarks/retrieval-corpus.md` beside it says how.
 */
const CORPUS = 'benchmarks/retrieval-corpus';
const TOP_K = 20;
const TOP_5 = 5;
const MIN_DOCSTRING = 30;
/** **A bounded query set, because every query is paid for twice**: one completion to write it, one embedding to run it. */
const MAX_QUERIES = 100;
const VECTOR_WEIGHTS = [1, 0.5, 0.25, 0.1];
/** How many candidates a reranker sees. **A judgement task, not a reading task** - fifty fits one prompt. */
const RERANK_POOL = 50;

/**
 * **The deepest pool the measurement offers a reranker, and the depths it reports the ceiling at.**
 *
 * `RERANK_POOL` was fifty because *"fifty fits one prompt"* - a claim about a prompt, used for two iterations as if it
 * were a claim about the retriever. The depth curve settled the difference: the lexical list holds thirty-one answers
 * it does not show in the top twenty, so **the pool is the arm's ceiling and nobody had measured where it sat**. These
 * depths are the ones the ceiling is reported at; `DEEP_RERANK_POOL` is the one an arm actually reads.
 *
 * **One hundred and fifty, because that is where the lexical curve stops paying**: it moves from 0.5455 at 150 to
 * 0.5556 at 200 - one question of ninety-nine - while the prompt grows by a third. A depth chosen at the knee is a
 * depth a reader can defend; two hundred would be the widest list this file measures and three times the prompt of the
 * arm it replaces, for a ceiling the shallowest of the two already reaches.
 */
const MAX_POOL = 200;
const POOL_DEPTHS = [20, 50, 100, 150, 200] as const;
const DEEP_RERANK_POOL = 150;

/**
 * **The same answer budget for both rerank arms, and that is the control rather than a detail.**
 *
 * The model is asked to order the candidates it is confident about and to leave the rest where they are
 * (`applyOrder` keeps every candidate an answer did not mention in its fused position), so an answer needs room for the
 * head each arm has to fill and not for the pool it was shown. **A hundred and twenty tokens is about fifty ids**,
 * which covers a top twenty twice over at either depth - and holding it constant is what makes the two arms differ in
 * the pool and nothing else.
 */
const ANSWER_BUDGET = 120;

/**
 * **The question set is a dataset, so it is frozen and committed.**
 *
 * A measurement whose input is rewritten on every run cannot compare two retrievers: the difference between two columns
 * would contain the difference between two sets of questions. `benchmarks/paraphrase-queries.json` holds the questions
 * DeepSeek wrote for this corpus together with the symbol each one asks about, and a run **reads** them unless
 * `PARAPHRASE_REGENERATE=1` is set. **Regeneration is an explicit act**, because it invalidates every figure measured
 * before it - the one in the committed artifact, the one in the competitor matrix, and the one in the report.
 */
const QUERY_SET = 'benchmarks/paraphrase-queries.json';
const REGENERATE = process.env['PARAPHRASE_REGENERATE'] === '1';

/**
 * **Three inputs can move under this measurement, and the third one is derived.**
 *
 * The corpus is a snapshot and the questions are frozen, so the two halves cannot drift - but a question does not name a
 * line range, it names a **qualified name**, and that string is produced *from the corpus* by the resolver on every run.
 * An improvement to the resolver therefore renames answers that are the same declarations. Iteration 65 made
 * `abstract class` a container (it was previously read as no container at all, so its members were file-scoped), and
 * every member of `TreeSitterBaseProvider` moved from `checkExported` to `TreeSitterBaseProvider.checkExported`:
 * **thirteen questions whose answer had not changed and whose key no longer matched a node.** The tripwire below fired
 * exactly as designed, which is the difference between a defect caught and a defect measured as a retrieval miss.
 *
 * `PARAPHRASE_REQUALIFY=1` is the mechanical exit from that state, and it is an explicit act for the same reason
 * regeneration is: it rewrites a committed dataset. It needs no credential, because no model is asked anything - the
 * corpus answers, and `requalify` below decides whether the corpus's answer is unambiguous.
 */
const REQUALIFY = process.env['PARAPHRASE_REQUALIFY'] === '1';

/**
 * **One credential is enough for the steady state, and the job reports which ones it had.**
 *
 * `ZHIPU_API_KEY` embeds both sides; `DEEPSEEK_API_KEY` is needed only when the question set has to be *written* -
 * the first run, or an explicit regeneration. Requiring the second key for a frozen set would make a reproducible
 * measurement depend on a generator it no longer calls.
 */
const HAS_VECTORS = Boolean(process.env['ZHIPU_API_KEY']);
const CAN_WRITE_QUERIES = Boolean(process.env['DEEPSEEK_API_KEY']);
const NEEDS_QUERY_AUTHOR = REGENERATE || !existsSync(resolve(process.cwd(), QUERY_SET));

interface QueryCase {
  /** The frozen question's key, carried through so a case can be split into halves after it is scored. */
  file: string;
  qualifiedName: string;
  name: string;
  query: string;
  rank: number | null;
}

/** A frozen question, and the symbol whose behaviour it describes. */
interface FrozenQuery {
  /** **The file is part of the answer**, as a path inside the corpus - see `stripRoot`. */
  file: string;
  /** The symbol's qualified name **with the corpus root removed**, because the graph builds it from an absolute path. */
  qualifiedName: string;
  name: string;
  query: string;
}

/**
 * A value with the corpus root removed, so two machines agree.
 *
 * **The graph builds qualified names out of absolute paths** - `project:<id>:file:/home/runner/work/…/arkts.ts:name` -
 * so a frozen set that stored them verbatim matched nothing on any other machine, and the failure would have looked
 * like a retrieval miss rather than a portability defect. **Seventy of ninety-nine questions failed to match** when the
 * set was first committed, which is how the defect was found. Stripping the root at both ends makes the identity
 * relative without changing what the graph holds; making the graph itself relative is a separate change, tracked in the
 * roadmap, because `filePath` is absolute for every reader in every phase.
 */
function stripRoot(rootPath: string, value: string): string {
  const root = resolve(rootPath);
  return value.split(`${root}/`).join('').split(`${root}\\`).join('');
}

/** The key a hit is matched on. **File and qualified name together, because the corpus reuses both alone.** */
function answerKey(
  node: { filePath?: string | null; qualifiedName: string },
  rootPath: string,
): string {
  return `${stripRoot(rootPath, node.filePath ?? '')}::${stripRoot(rootPath, node.qualifiedName)}`;
}

/** What a class body is labelled by, which is the whole basis of the tie-break below. */
const CLASS_LABEL = 'Class';

/** The qualified name of the body a name is written in, or `null` for a name that is written in none. */
function containerOf(candidate: string): string | null {
  const colon = candidate.lastIndexOf(':');
  const tail = candidate.slice(colon + 1);
  const dot = tail.lastIndexOf('.');
  return dot === -1 ? null : `${candidate.slice(0, colon + 1)}${tail.slice(0, dot)}`;
}

/**
 * The qualified name the corpus gives a frozen answer today, or `null` when it gives none or cannot choose between two.
 *
 * **A suffix match on the file, and only when it is unique.** The last segment of a qualified name is the declared name,
 * and a container prefix is exactly what a derivation change adds, so `file::X` is looked for as `file::*.X`. A key that
 * already matches is not touched, so running the rewrite twice moves nothing the second time.
 *
 * **Two candidates is normally a refusal, and there is exactly one case where it is not - resolved by reconstructing
 * the rule that wrote the bare key rather than by a list of exceptions.** A frozen key with no container in it could
 * only have been written for a member of a body that *was not a container when the key was made*. Interfaces, enums,
 * namespaces and ordinary classes were containers all along, so their members always carried a prefix; **the only
 * bodies that were bare are the ones iteration 65 containerised - an `abstract class` and a class expression - and both
 * are labelled `Class`.** So when a bare key now collides with an interface member of the same name,
 * `extractSanitizers` in `TreeSitterBaseProvider` against the one `TaintProvider` declares, exactly one candidate sits
 * in a class body and it is the answer the question was written for. Where that reading is not unique either - none of
 * them, or two - the answer is left alone and the tripwire fires: **this function may move a key, never invent one.**
 */
function requalify(
  frozen: { file: string; qualifiedName: string },
  present: Map<string, string>,
): string | null {
  const prefix = `${frozen.file}::`;
  if (present.has(`${prefix}${frozen.qualifiedName}`)) return null;
  // **The declared tail is everything after the last `:`**, because a qualified name is
  // `project:<id>:file:<path>:<name>` and `<name>` is where a container writes its dots.
  const tail = frozen.qualifiedName.slice(frozen.qualifiedName.lastIndexOf(':') + 1);
  const suffix = `.${tail}`;
  const candidates = [...present.keys()].filter(
    (candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix),
  );
  if (candidates.length === 1) return candidates[0]!.slice(prefix.length);
  const inAClassBody = candidates.filter((candidate) => {
    const container = containerOf(candidate);
    return container !== null && present.get(container) === CLASS_LABEL;
  });
  if (inAClassBody.length !== 1) return null;
  return inAClassBody[0]!.slice(prefix.length);
}

/**
 * Rewrite only the `qualifiedName` of the answers named in `moved`, leaving every other byte of the dataset alone.
 *
 * **A targeted edit rather than a rewrite of the file**, because the rest of it - the questions, the `generatedAt` date,
 * the `dropped` count - is what makes the set an input, and a regeneration would change all three. The provenance of
 * the edit is recorded under `requalified` so a reader of the committed file can see that the derivation moved and why.
 */
function rewriteQualifiedNames(
  path: string,
  moved: ReadonlyArray<{ file: string; from: string; to: string }>,
): void {
  if (moved.length === 0) return;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    queries?: FrozenQuery[];
    requalified?: { at: string; reason: string; moved: unknown[] };
  } & Record<string, unknown>;
  const target = new Map(moved.map((entry) => [`${entry.file}::${entry.from}`, entry.to]));
  for (const query of parsed.queries ?? []) {
    const to = target.get(`${query.file}::${query.qualifiedName}`);
    if (to !== undefined) query.qualifiedName = to;
  }
  parsed.requalified = {
    at: new Date().toISOString().slice(0, 10),
    reason:
      'Iteration 65 reads `abstract class` as a container, so its members gained the `TreeSitterBaseProvider.` prefix. ' +
      'The declarations are unchanged; only the derived name moved.',
    // **Appended, not replaced**: a second migration months later is a second fact about the dataset, and a list that
    // forgot the first one would leave a reader unable to explain the keys the first one moved.
    moved: [...(parsed.requalified?.moved ?? []), ...moved],
  };
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

/** The committed question set, or `null` when there is none yet. */
function readQuerySet(path: string): { queries: FrozenQuery[]; dropped: number } | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    queries?: FrozenQuery[];
    dropped?: number;
  };
  return { queries: parsed.queries ?? [], dropped: parsed.dropped ?? 0 };
}

/** Write the question set where the next run will read it, and where a reader can inspect it. */
function writeQuerySet(path: string, queries: FrozenQuery[], dropped: number): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        comment: [
          'Questions written by DeepSeek from the doc comments of one corpus, with the symbol each one asks about.',
          '',
          '**This file is an input, not a report.** `paraphrase-search.test.ts` reads it on every run so that two',
          'retrievers are compared on the same questions; `PARAPHRASE_REGENERATE=1` rewrites it, which invalidates every',
          'figure measured before the rewrite. The prompt forbids the symbol’s own name, and a question that still',
          'contains it is `dropped` here rather than counted as a win for either column.',
        ],
        corpus: CORPUS,
        generatedAt: new Date().toISOString().slice(0, 10),
        generator: 'deepseek-chat · paraphrasePrompt',
        dropped,
        queries,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

/**
 * The pinned corpus, analysed.
 *
 * **The same call the measurement makes**, and two seconds of work: small enough that the integrity check below runs on
 * every machine, credentials or not, rather than only where the semantic half can run.
 */
let analysed: Promise<{
  corpusRoot: string;
  pipeline: Awaited<ReturnType<PipelineOrchestrator['execute']>>;
}> | null = null;

/**
 * **One analysis per file, because two analyses of one pinned corpus are two chances to disagree.**
 *
 * Three tests read the graph this builds: the integrity check, the measurement, and the rewrite. Each used to build its
 * own, which is three passes over the same fifty-two files - and in a workflow running the whole suite with coverage
 * instrumentation, the first of them starved: the integrity check spent its whole two minutes waiting for a worker
 * while the measurement that needed the same graph had not started. **A memoised promise is not an optimisation here,
 * it is the statement that the three tests are looking at one graph**, which is also what makes the integrity check
 * evidence about the measurement rather than about a second run of the same code.
 */
function analyseCorpus(): Promise<{
  corpusRoot: string;
  pipeline: Awaited<ReturnType<PipelineOrchestrator['execute']>>;
}> {
  analysed ??= analyseCorpusOnce();
  return analysed;
}

/**
 * The index the measurement ranks against: **the graph with every doc comment removed**, for every symbol rather than
 * for the queried one. A leave-one-out index would need a rebuild per query, and a global strip is the same statement
 * about every query at once.
 */
function strippedStore(pipeline: { graph: { nodes: Map<number, GraphNode> } }): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (const node of pipeline.graph.nodes.values()) {
    const {
      embedding: _embedding,
      embeddingBackend: _backend,
      ...rest
    } = (node.properties ?? {}) as Record<string, unknown>;
    store.insertNode({ ...node, docstring: null, properties: rest });
  }
  return store;
}

/**
 * **The floors the lexical column may not fall below, and they are a ratchet rather than a target.**
 *
 * The column had no gate at all: it was measured, written into the artifact, and compared with nothing - which is how it
 * fell from **0.3030 to 0.2424** across four iterations **without a red run**. The cause was not the retriever: the graph
 * grew from 3 600 to 5 735 nodes and a single bag of name-plus-path-plus-signature scored a longer document lower for
 * no reason a reader could see. The figures below are what the field-weighted ranking answers on the pinned corpus and
 * the frozen questions, rounded down, so a change that costs a question has to be argued for.
 *
 * **Iteration 68 raised them by eight questions, and the cause was a word boundary.** `tokenize` cut on whitespace and
 * on `_ - . : /`, which is a complete list for an identifier and nothing like a complete list for text: a declaration's
 * body is source, where the words that matter are quoted, and a question is prose, where the last word ends in a
 * question mark. `['escape',` and `input?` were single unmatchable tokens, so **the body's vocabulary could not meet the
 * question that asked for it** - measured on the same code with the old rule put back, the column returns
 * **0.3838 / 0.2323 / 0.1651** against **0.4646 / 0.3131 / 0.2034**.
 */
const LEXICAL_FLOOR = { recallAt5: 0.3, recallAt20: 0.45, mrr: 0.19 } as const;

/**
 * **And the floor that says the questions were answered rather than the words matched.**
 *
 * `withAWordFromTheName` is reported for a reason: **fifty-two of the ninety-nine questions reuse a word of four letters
 * or more from the name they ask for**, and on those a name match is nearly the whole answer. Measured with the
 * weighted-field index before the body's vocabulary was added, **every single answer the lexical ranking found belonged
 * to that half - 0 of the other forty-seven** - so a recall of 0.3030 described the overlap and not the retriever.
 *
 * The clean half is therefore a floor of its own, and the only column a claim about *finding a symbol from a question*
 * can be made on. **Eight of forty-seven**, which is small and is stated as small: it is the honest size of what a
 * lexical index can do when the question shares no vocabulary with the answer, and the number the semantic arms are
 * compared against in that register.
 */
const LEAK_FREE_FLOOR = { recallAt20: 0.15 } as const;

/**
 * **The depth the lexical list reaches, and the ceiling no pool can exceed.**
 *
 * Measured on the pinned corpus with the weighting above — the fifth field included: recall@20 **0.4646**, recall@100
 * **0.5758**, and **0.8889** of the ninety-nine answers appear somewhere in the list at all. **The fifth field moved
 * the ceiling from 0.6162 to 0.8586**, and the boundary fix finished the climb to 0.8889: the gap between the ceiling
 * and recall@20, **0.4243, is what a reranker with a deeper pool is offered.** **Rounded down, like the floor above
 * it**: a change that costs a question has to be argued for.
 */
const DEPTH_FLOOR = { at20: 0.45, at100: 0.57, reachable: 0.88 } as const;

/**
 * **Which half of the questions chose the weighting, and which half reports it.**
 *
 * A weight tuned on the questions it is then measured on is a figure about the tuning. The split is a stable hash of the
 * key a question is asked under, so it is the same 99 questions in the same two halves on every machine and every run -
 * and `PARAPHRASE_SWEEP=1` re-derives the choice from the `dev` half alone and reports the `test` half beside it.
 */
function foldOf(candidate: { file: string; qualifiedName: string }): number {
  let hash = 0;
  const key = `${candidate.file}::${candidate.qualifiedName}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 100_003;
  }
  return hash % 2;
}

async function analyseCorpusOnce(): Promise<{
  corpusRoot: string;
  pipeline: Awaited<ReturnType<PipelineOrchestrator['execute']>>;
}> {
  const corpusRoot = resolve(process.cwd(), CORPUS);
  const ctx = {
    projectId: 'paraphrase-search',
    rootPath: corpusRoot,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  // **Every phase but the external tool probe**, which reports the absence of a toolchain as an error and would make
  // this file depend on what is installed on the machine that runs it.
  expect(pipeline.errors.map((e) => e.phaseId).filter((id) => id !== 'tools')).toEqual([]);
  return { corpusRoot, pipeline };
}

/** One candidate composition, measured on the same questions as the control. */
interface VariantColumn extends Partial<Column> {
  name: string;
  note: string;
  /** How many questions the model answered with a usable hypothesis. **Reported, because a missing expansion is not a
   * missing answer** - the arm degrades to the plain question vector. */
  hypotheses?: number;
  /** How many questions the model actually reordered - **an identity answer is not a rerank**. */
  reranked?: number;
  /** The ceiling: the share of answers present in the pool the reranker was given. */
  poolRecallAt20?: number;
  /** How many candidates that pool held. **The arm's ceiling is a function of this number**, so it travels with it. */
  poolDepth?: number;
  /** The same column on the two halves of the question set. **A recall figure without it is two measurements added.** */
  slices?: ReturnType<typeof sliceOf>;
  /** Why this arm did not run. **An absent row reads like a passing one**, so an unmeasured variant says so. */
  reason?: string;
}

/** The columns of one retrieval list. */
interface Column {
  recallAt5: number;
  recallAt20: number;
  mrr: number;
  found: number;
}

/**
 * **Where the answer sits, which is a different question from whether it is inside twenty.**
 *
 * `recallAt20` is what the product promises and what the competitor matrix compares, and it cannot say where the rest
 * of the answers are. A list that answers a question at rank 24 and a list that does not hold the answer at all both
 * score zero, and the two call for opposite work: the first is a candidate pool too narrow to hand a reranker, the
 * second is a query or an index that never found the symbol. **`reachable` is the ceiling any pool depth can reach, and
 * the gap between it and recall at twenty is the whole headroom a deeper pool could spend** - which is the number the
 * rerank arms in this file are bounded by, and the number a reader needs before deciding to widen one.
 */
interface DepthCurve {
  /** Recall at each cut in `DEPTH_CUTS`, in the same order. */
  recall: number[];
  /** The share whose answer appears in the list at all - **the ceiling on any pool depth**. */
  reachable: number;
  /** Where a found answer sits, median. **Half of the answers this list holds sit below this rank.** */
  medianFoundRank: number | null;
}

/** The cuts a depth curve is reported at. **The widest is the deepest pool the measurement offers a reranker.** */
const DEPTH_CUTS = [5, 10, 20, 30, 50, 75, 100, 150, 200] as const;

/** Recall at one cut of a curve. **A named lookup, so an assertion cannot silently read the wrong cut.** */
function recallAt(curve: DepthCurve, cut: number): number {
  const index = DEPTH_CUTS.indexOf(cut as (typeof DEPTH_CUTS)[number]);
  return curve.recall[index] ?? 0;
}

function depthCurve(cases: QueryCase[]): DepthCurve {
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  const found = cases
    .map((candidate) => candidate.rank)
    .filter((rank): rank is number => rank !== null)
    .sort((a, b) => a - b);
  return {
    recall: DEPTH_CUTS.map((cut) =>
      round(found.filter((rank) => rank <= cut).length / cases.length),
    ),
    reachable: round(found.length / cases.length),
    medianFoundRank: found.length === 0 ? null : found[Math.floor(found.length / 2)]!,
  };
}

/**
 * Recall at two cuts plus MRR.
 *
 * **The same arithmetic as `docstring-search.test.ts`, written twice on purpose**: a shared module inside `src/` would
 * be counted by the per-file coverage gate, and its only caller is a test that is *skipped* wherever the credentials
 * are absent - so the module would report 0 % on every run that did not measure anything, and the gate would fail for
 * the honest reason. Ten lines of arithmetic are cheaper than a file that has to be excluded from the gate.
 *
 * **Every column is cut at `TOP_K`, and that is the whole point of this function.** `recallAt20` used to be
 * `cases.filter(c => c.rank !== null).length`, which counts an answer found at rank 4 000 as recall at twenty - and on
 * the lexical column that is not a rounding error, because `bm25Search` returns **every** match. The column answered
 * "is the symbol somewhere in the list" while the fused column, truncated to twenty by construction, answered "is it in
 * the top twenty": a generous measurement compared against a strict one, with the strict one being the semantic half.
 * Measured on the runner, the lexical column read **0.5455** against **0.3434** for a fusion at weight 0.25 - an
 * ordering reciprocal rank fusion cannot produce at that weight, which is what exposed the bug. **A measurement that
 * flatters the retriever it is meant to test is worse than no measurement.**
 */
function summarise(cases: QueryCase[]): Column {
  const within = (cut: number): number =>
    cases.filter((c) => c.rank !== null && c.rank <= cut).length;
  const found = within(TOP_K);
  const at5 = within(TOP_5);
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return {
    recallAt5: round(at5 / cases.length),
    recallAt20: round(found / cases.length),
    // **MRR at the same cut**, so two lists of different depths are comparable: a rank 4 000 hit contributes `1/4000`
    // to an unbounded column and `0` to a cut one, which silently favours whichever list is longer.
    mrr: round(
      cases.reduce((sum, c) => sum + (c.rank !== null && c.rank <= TOP_K ? 1 / c.rank : 0), 0) /
        cases.length,
    ),
    found,
  };
}

/**
 * The same column, reported on the two halves the question set actually has.
 *
 * **A recall of 0.3838 is two measurements added together.** Fifty-two of the ninety-nine questions reuse a word of the
 * name they ask for, and on those a name match is nearly the answer; the other forty-seven share nothing of four
 * letters or more, and **before the body's vocabulary was indexed the lexical ranking found none of them at all**. A
 * column that does not say which half it was earned on cannot be compared with a competitor's, because the
 * competitor's question set has its own overlap and nobody reports it.
 */
function sliceOf(cases: QueryCase[]): {
  leakFree: Column & { size: number };
  withLeak: Column & { size: number };
} {
  const leakFree = cases.filter((candidate) => sharedTokens(candidate.query, candidate.name) === 0);
  const withLeak = cases.filter((candidate) => sharedTokens(candidate.query, candidate.name) > 0);
  return {
    leakFree: { size: leakFree.length, ...summarise(leakFree) },
    withLeak: { size: withLeak.length, ...summarise(withLeak) },
  };
}

/**
 * Is the question the name lookup this measurement exists to replace?
 *
 * **Only the whole identifier disqualifies it.** The first version dropped a question that contained *any* word of the
 * identifier, which threw away **51 of 100 samples** - and the ones it threw away were the ordinary ones: a question
 * about `nameIn` says "name", a question about `captureAccesses` says "accesses". What survived was a biased remainder
 * of unusual identifiers, and a recall figure over it would have described the filter rather than the retriever.
 *
 * The overlap is **counted instead**, and published: a reader can see how much of the query set still shares a word with
 * the name it is asking for.
 */
function namesTheSymbol(query: string, name: string): boolean {
  return query.toLowerCase().includes(name.toLowerCase());
}

/** How many of the identifier's own words the question reuses. **A diagnostic, not a filter.** */
function sharedTokens(query: string, name: string): number {
  const haystack = query.toLowerCase();
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(' ')
    .filter((token) => token.length >= 4)
    .filter((token) => haystack.includes(token)).length;
}

/**
 * The prompt, and the rules are the measurement.
 *
 * **"Do not use the symbol's name" is what separates a paraphrase from a lookup**, and it is a prompt rule rather than a
 * post-hoc filter only so that fewer samples are thrown away. A generated question that still names the symbol is
 * detected and dropped, and the count is published.
 */
function paraphrasePrompt(docstring: string): string {
  return [
    'You rewrite API documentation into the question a developer would type into a code search box when they do not',
    'know the name of the function they are looking for.',
    '',
    'Rules:',
    '- One sentence, at most 20 words, ending in a question mark.',
    '- Describe the behaviour. Never use the symbol’s name, and never use any word taken from it.',
    '- Same language as the documentation.',
    '- Output the question only: no quotes, no prefix, no explanation.',
    '',
    'Documentation:',
    '"""',
    docstring,
    '"""',
  ].join('\n');
}

/** Drop the punctuation a model adds around an answer, and collapse it onto one line. */
function cleanCompletion(text: string): string {
  return (
    text
      .replace(/\s+/g, ' ')
      .trim()
      // **Trimmed before the quotes are stripped, not after**: a collapsed answer keeps the space it started with, and
      // `^["'“”]+` does not match a quote that is not the first character.
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim()
  );
}

// **These run everywhere, and they decide whether the measurement means anything.** A paraphrase that still contains a
// word of the symbol's name is a lookup wearing a description's clothes, and if `forbiddenIn` were wrong every column in
// the artifact would be inflated - both halves equally, so no gate comparing them would notice.
describe('the paraphrase that is not a lookup', () => {
  it('rejects a question that names the symbol outright', () => {
    expect(namesTheSymbol('How do I call extractCalls on a file?', 'extractCalls')).toBe(true);
  });

  it('keeps a question that merely shares a word, and reports the overlap', () => {
    // **This is the case the first filter threw away**, and it threw away half the sample doing it: a question about
    // `extractCalls` almost has to say "calls". Dropping it biased the remaining set towards unusual identifiers.
    expect(namesTheSymbol('where do we count the calls?', 'extractCalls')).toBe(false);
    expect(sharedTokens('where do we count the calls?', 'extractCalls')).toBe(1);
  });

  it('counts no overlap for a question about the behaviour in different words', () => {
    expect(
      sharedTokens(
        'Where can I find the code that pulls method invocations out of a source file?',
        'extractCalls',
      ),
    ).toBe(0);
  });

  it('ignores short tokens, which too much of the corpus shares to mean anything', () => {
    // `get` is three letters; counting it would report an overlap for most questions in the corpus.
    expect(sharedTokens('How do I get the owner of a file?', 'getX')).toBe(0);
  });

  it('cleans the quotes and the line breaks a model puts around an answer', () => {
    expect(cleanCompletion('  "Where is the\n reconciliation step?"  ')).toBe(
      'Where is the reconciliation step?',
    );
    expect(cleanCompletion('“Where is it?”')).toBe('Where is it?');
  });

  it('asks for a question in the documentation’s language, without the name', () => {
    const prompt = paraphrasePrompt('Reconciles incoming invoices against receipts.');
    expect(prompt).toContain('Reconciles incoming invoices against receipts.');
    expect(prompt).toContain('Never use the symbol’s name');
    expect(prompt).toContain('Same language as the documentation.');
  });
});

// **The arithmetic, checked on numbers where the two readings disagree.** These run without a credential because the
// defect they cover ran for a week: `recallAt20` counted a rank of 4 000 as a hit at twenty, and on an unbounded lexical
// list that is a 20-point gift to the column that was supposed to be the baseline.
describe('the recall arithmetic', () => {
  /** Cases built from the only field a column reads, so a test says what it is measuring and nothing else. */
  const scored = (...ranks: Array<number | null>): QueryCase[] =>
    ranks.map((rank, index) => ({
      file: 'f.ts',
      qualifiedName: `f.ts:n${index}`,
      name: `n${index}`,
      query: 'q',
      rank,
    }));

  it('does not count an answer below the cut as recall at the cut', () => {
    const column = summarise(scored(1, TOP_K, TOP_K + 1, 4_000));
    expect(column.recallAt5).toBe(0.25);
    // **Two of four, not four of four**: the answer at 21 and the answer at 4 000 are not in the top twenty.
    expect(column.recallAt20).toBe(0.5);
    expect(column.found).toBe(2);
  });

  it('gives a rank beyond the cut no weight in MRR, so lists of different depths are comparable', () => {
    const column = summarise(scored(2, TOP_K + 1));
    expect(column.mrr).toBe(0.25);
  });

  it('matches an answer with the corpus root removed, so two machines agree', () => {
    // **The absolute path a runner hands out and the relative one the frozen set stores are the same answer**, and the
    // qualified name of a file-scoped symbol carries that absolute path inside it.
    const root = '/home/runner/work/code-analyzer/code-analyzer/benchmarks/retrieval-corpus';
    expect(
      answerKey(
        { filePath: `${root}/arkts.ts`, qualifiedName: `project:p:file:${root}/arkts.ts:walk` },
        root,
      ),
    ).toBe('arkts.ts::project:p:file:arkts.ts:walk');
    expect(answerKey({ filePath: null, qualifiedName: 'parse' }, root)).toBe('::parse');
  });
});

// **A curve is arithmetic on ranks, so it is measured on ranks.** The corpus supplies the numbers it is published with,
// but every property below - monotonicity, the ceiling, the median - is a statement about nine numbers and holds
// whether or not the corpus is present.
describe('the depth curve', () => {
  const scored = (...ranks: Array<number | null>): QueryCase[] =>
    ranks.map((rank, index) => ({
      file: 'f.ts',
      qualifiedName: `f.ts:n${index}`,
      name: `n${index}`,
      query: 'q',
      rank,
    }));

  it('separates an answer ranked just below the cut from one the list never held', () => {
    // **Both of these contribute nothing to recall at twenty, and only one of them is helped by a deeper pool.** A
    // measurement that published only the first number could not tell a pool too narrow to show a reranker from an
    // answer no candidate list ever contained, and the two call for opposite work.
    const curve = depthCurve(scored(3, 24, null, null));
    expect(recallAt(curve, TOP_K)).toBe(0.25);
    expect(recallAt(curve, 30)).toBe(0.5);
    // **The ceiling any pool depth is bounded by**, and it is above the head.
    expect(curve.reachable).toBe(0.5);
    // **And the median of the two found answers is the one outside the cut**: half of what this list holds, it holds
    // below twenty.
    expect(curve.medianFoundRank).toBe(24);
  });

  it('never falls as the cut deepens, and reports no median when the list holds no answer', () => {
    const curve = depthCurve(scored(1, 120, 4_000, null));
    expect(
      curve.recall.every((value, index) => index === 0 || value >= curve.recall[index - 1]!),
      'recall is non-decreasing in the cut',
    ).toBe(true);
    // **An answer beyond the last cut is still reachable** and still outside every published column, which is why
    // `reachable` is not simply the widest cut.
    expect(curve.reachable).toBe(0.75);
    expect(recallAt(curve, 200)).toBe(0.5);
    expect(recallAt(curve, 150)).toBe(0.5);

    const empty = depthCurve(scored(null, null));
    expect(empty.reachable).toBe(0);
    expect(empty.medianFoundRank).toBeNull();
    expect(empty.recall.every((value) => value === 0)).toBe(true);
  });
});

// **The rewrite itself is arithmetic on strings, so it is measured on strings.** The corpus only supplies the case that
// prompted it: every branch below - a unique move, a key that already matches, a name the corpus lost, a suffix two
// symbols share - exists independently of which corpus is pinned, and the last two would be invisible in a test that
// only ran the rewrite against the real thing.
describe('re-keying an answer whose derivation moved', () => {
  const FILE = 'types.ts';
  /** A corpus as the rewrite sees it: every answer key, against the label the graph gave that node. */
  const corpusOf = (...nodes: Array<[string, string]>): Map<string, string> =>
    new Map(nodes.map(([qualifiedName, label]) => [`${FILE}::${qualifiedName}`, label]));

  it('moves a key onto the container prefix a derivation change added', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:checkExported' },
        corpusOf(
          ['project:p:file:types.ts:Provider', 'Class'],
          ['project:p:file:types.ts:Provider.checkExported', 'Method'],
          ['project:p:file:types.ts:Provider.parse', 'Method'],
        ),
      ),
    ).toBe('project:p:file:types.ts:Provider.checkExported');
  });

  it('moves a name that is itself inside a body, so the prefix is two segments deep', () => {
    expect(
      requalify(
        {
          file: FILE,
          qualifiedName: 'project:p:file:types.ts:attachDocCommentsInOrder.DECLARATIONS',
        },
        corpusOf([
          'project:p:file:types.ts:Provider.attachDocCommentsInOrder.DECLARATIONS',
          'Variable',
        ]),
      ),
    ).toBe('project:p:file:types.ts:Provider.attachDocCommentsInOrder.DECLARATIONS');
  });

  it('leaves a key that already matches alone, so a second run moves nothing', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:Provider.parse' },
        corpusOf(['project:p:file:types.ts:Provider.parse', 'Method']),
      ),
    ).toBeNull();
  });

  it('refuses to move a key the corpus no longer has in any form', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:gone' },
        corpusOf(['project:p:file:types.ts:Provider.parse', 'Method']),
      ),
    ).toBeNull();
  });

  it('prefers the class body when a bare key now collides with an interface member of the same name', () => {
    // **The real case, as it reads in the corpus**: `extractSanitizers` was written bare because the abstract class it
    // belongs to was not a container; the interface beside it always was, so its member was never written bare.
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:extractSanitizers' },
        corpusOf(
          ['project:p:file:types.ts:Provider', 'Class'],
          ['project:p:file:types.ts:Contract', 'Interface'],
          ['project:p:file:types.ts:Provider.extractSanitizers', 'Method'],
          ['project:p:file:types.ts:Contract.extractSanitizers', 'Method'],
        ),
      ),
    ).toBe('project:p:file:types.ts:Provider.extractSanitizers');
  });

  it('refuses a collision the class rule cannot separate, because two class bodies is a question with no answer', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:parse' },
        corpusOf(
          ['project:p:file:types.ts:Provider', 'Class'],
          ['project:p:file:types.ts:Parser', 'Class'],
          ['project:p:file:types.ts:Provider.parse', 'Method'],
          ['project:p:file:types.ts:Parser.parse', 'Method'],
        ),
      ),
    ).toBeNull();
  });

  it('reads a body by its label, so a collision with a module-level name is not mistaken for a class member', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:parse' },
        corpusOf(
          ['project:p:file:types.ts:Provider', 'Class'],
          ['project:p:file:types.ts:parse', 'Function'],
          ['project:p:file:types.ts:Provider.parse', 'Method'],
        ),
      ),
    ).toBeNull();
  });

  it('keeps the file, so a name that moved between files is not silently adopted', () => {
    expect(
      requalify(
        { file: FILE, qualifiedName: 'project:p:file:types.ts:parse' },
        new Map([['other.ts::project:p:file:other.ts:Provider.parse', 'Method']]),
      ),
    ).toBeNull();
  });

  it('rewrites only the key it was given, and records why the dataset changed', () => {
    // **The file on disk is the subject, so the test writes one** - a temporary path, the same bytes a run would meet,
    // and the whole object read back afterwards. Asserting on an in-memory copy would leave the writing untested, which
    // is the only part of this function that can damage a committed dataset.
    const directory = mkdtempSync(resolve(tmpdir(), 'requalify-'));
    const path = resolve(directory, 'queries.json');
    const original = {
      comment: ['an input, not a report'],
      corpus: 'benchmarks/retrieval-corpus',
      generatedAt: '2026-10-26',
      generator: 'deepseek-chat · paraphrasePrompt',
      dropped: 1,
      queries: [
        { file: FILE, qualifiedName: 'project:p:file:types.ts:parse', name: 'parse', query: 'how' },
        { file: FILE, qualifiedName: 'project:p:file:types.ts:gone', name: 'gone', query: 'why' },
      ],
    };
    writeFileSync(path, `${JSON.stringify(original, null, 2)}\n`, 'utf8');
    try {
      rewriteQualifiedNames(path, [
        {
          file: FILE,
          from: 'project:p:file:types.ts:parse',
          to: 'project:p:file:types.ts:Provider.parse',
        },
      ]);
      const written = JSON.parse(readFileSync(path, 'utf8')) as typeof original & {
        requalified: { at: string; reason: string; moved: unknown[] };
      };
      expect(written.queries.map((query) => query.qualifiedName)).toEqual([
        'project:p:file:types.ts:Provider.parse',
        // **The one it was not given is untouched**, because a rewrite is not a licence to re-derive a whole dataset.
        'project:p:file:types.ts:gone',
      ]);
      expect(written.generatedAt).toBe('2026-10-26');
      expect(written.dropped).toBe(1);
      expect(written.requalified.moved).toHaveLength(1);
      expect(written.requalified.reason).toContain('abstract class');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes nothing when nothing moved, so an accidental run cannot touch the dataset', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'requalify-'));
    const path = resolve(directory, 'queries.json');
    const original = `${JSON.stringify({ queries: [], dropped: 0 }, null, 2)}\n`;
    writeFileSync(path, original, 'utf8');
    try {
      rewriteQualifiedNames(path, []);
      expect(readFileSync(path, 'utf8')).toBe(original);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

// **The two inputs are pinned to each other, and this is the assertion that says so.** It needs no credential, because
// the defect it guards against ran for four days precisely because the only check lived inside a block that is skipped
// wherever one is absent: a question about a symbol the corpus has lost is a broken measurement, not a retrieval miss,
// and scoring it as a miss understates whichever column is being compared.
describe('the frozen questions and the frozen corpus', () => {
  it.skipIf(!REQUALIFY)(
    're-derives the keys a container change moved, when asked to',
    async () => {
      const { corpusRoot, pipeline } = await analyseCorpus();
      const present = new Map(
        [...pipeline.graph.nodes.values()].map((node) => [answerKey(node, corpusRoot), node.label]),
      );
      const frozen = readQuerySet(QUERY_SET);
      expect(frozen, `${QUERY_SET} is the input this measurement is defined on`).not.toBeNull();
      const moved = (frozen?.queries ?? []).flatMap((query) => {
        const to = requalify(query, present);
        return to === null ? [] : [{ file: query.file, from: query.qualifiedName, to }];
      });
      rewriteQualifiedNames(QUERY_SET, moved);
      // **The count is the assertion**, because a rewrite that silently moves nothing leaves the tripwire below to fail
      // for a reason this run had already been told about.
      expect(moved.length, `${QUERY_SET} needed no re-keying - nothing moved`).toBeGreaterThan(0);
    },
    120_000,
  );

  it('asks only about symbols the corpus still has', async () => {
    const { corpusRoot, pipeline } = await analyseCorpus();
    const present = new Map(
      [...pipeline.graph.nodes.values()].map((node) => [answerKey(node, corpusRoot), node.label]),
    );
    const frozen = readQuerySet(QUERY_SET);
    expect(frozen, `${QUERY_SET} is the input this measurement is defined on`).not.toBeNull();
    const unknown = (frozen?.queries ?? []).filter(
      (candidate) => !present.has(`${candidate.file}::${candidate.qualifiedName}`),
    );
    expect(
      unknown.map((candidate) => `${candidate.file}::${candidate.qualifiedName}`),
      `${QUERY_SET} asks about symbols ${CORPUS} no longer contains`,
    ).toEqual([]);
    // **Ten minutes and not two**, because this is one pass over fifty-two files on a runner that is executing the rest
    // of the suite beside it: the figure has to survive a loaded machine or it is a figure about the machine.
  }, 600_000);

  it('answers the frozen questions with the ranking the product ships', async () => {
    const { corpusRoot, pipeline } = await analyseCorpus();
    const frozen = readQuerySet(QUERY_SET)?.queries ?? [];
    expect(
      frozen.length,
      `${QUERY_SET} is the input this measurement is defined on`,
    ).toBeGreaterThan(0);

    const engine = new HybridSearchEngine(strippedStore(pipeline));
    engine.initialize();
    const cases: QueryCase[] = frozen.map((candidate) => {
      const want = `${candidate.file}::${candidate.qualifiedName}`;
      const rank = engine
        .bm25Search(candidate.query)
        .findIndex((hit) => answerKey(hit.node, corpusRoot) === want);
      return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
    });
    const column = summarise(cases);

    // eslint-disable-next-line no-console -- the workflow greps this line into the job summary, and it needs no key.
    console.log(
      `LEXICAL-COLUMN queries=${frozen.length} nodes=${engine.documentCount} ` +
        `@5=${column.recallAt5} @20=${column.recallAt20} mrr=${column.mrr} found=${column.found}`,
    );
    // **The half where the question shares no word with the name**, measured first because it is the one a claim about
    // retrieval can be made on: see `LEAK_FREE_FLOOR`.
    const leakFree = cases.filter(
      (candidate) => sharedTokens(candidate.query, candidate.name) === 0,
    );
    const leakFreeColumn = summarise(leakFree);
    const withLeak = cases.filter((candidate) => sharedTokens(candidate.query, candidate.name) > 0);

    // eslint-disable-next-line no-console -- the workflow greps this line into the job summary, and it needs no key.
    console.log(
      `LEXICAL-SLICES leakFree=${leakFreeColumn.recallAt20}(${leakFreeColumn.found}/${leakFree.length}) ` +
        `withLeak=${summarise(withLeak).recallAt20}(${summarise(withLeak).found}/${withLeak.length}) ` +
        `leakFree@5=${leakFreeColumn.recallAt5} leakFreeMrr=${leakFreeColumn.mrr}`,
    );
    expect(
      leakFreeColumn.recallAt20,
      'recall at 20 on the questions that share no name word',
    ).toBeGreaterThanOrEqual(LEAK_FREE_FLOOR.recallAt20);

    expect(column.recallAt5, 'recall at 5').toBeGreaterThanOrEqual(LEXICAL_FLOOR.recallAt5);
    expect(column.recallAt20, 'recall at 20').toBeGreaterThanOrEqual(LEXICAL_FLOOR.recallAt20);
    expect(column.mrr, 'mean reciprocal rank').toBeGreaterThanOrEqual(LEXICAL_FLOOR.mrr);
  }, 600_000);

  // **The column above answers "is it inside twenty" and this one answers "where is it", and only one of them says
  // whether a reranker has anything to work with.** It needs no credential for the same reason the column does: BM25
  // returns every match, so the rank of an answer is a fact about the list rather than about a model.
  it('reports where the answer sits, and the ceiling no pool depth can exceed', async () => {
    const { corpusRoot, pipeline } = await analyseCorpus();
    const frozen = readQuerySet(QUERY_SET)?.queries ?? [];
    expect(
      frozen.length,
      `${QUERY_SET} is the input this measurement is defined on`,
    ).toBeGreaterThan(0);

    const engine = new HybridSearchEngine(strippedStore(pipeline));
    engine.initialize();
    const cases: QueryCase[] = frozen.map((candidate) => {
      const want = `${candidate.file}::${candidate.qualifiedName}`;
      const rank = engine
        .bm25Search(candidate.query)
        .findIndex((hit) => answerKey(hit.node, corpusRoot) === want);
      return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
    });
    const curve = depthCurve(cases);

    // eslint-disable-next-line no-console -- the workflow greps this line into the job summary, and it needs no key.
    console.log(
      `LEXICAL-DEPTH queries=${frozen.length} nodes=${engine.documentCount} ` +
        curve.recall.map((value, index) => `@${DEPTH_CUTS[index]}=${value}`).join(' ') +
        ` reachable=${curve.reachable} medianFound=${curve.medianFoundRank}`,
    );

    expect(recallAt(curve, TOP_K), 'recall at 20').toBeGreaterThanOrEqual(DEPTH_FLOOR.at20);
    expect(recallAt(curve, 100), 'recall at 100').toBeGreaterThanOrEqual(DEPTH_FLOOR.at100);
    // **The ceiling, measured on the list and not on a pool**: the share of questions whose answer the lexical index
    // holds at all. No retrieval arm in this file can pass it, and the arms that come closest are the ones worth
    // deepening the pool for.
    expect(
      curve.reachable,
      'the share whose answer the list holds at any rank',
    ).toBeGreaterThanOrEqual(DEPTH_FLOOR.reachable);
    // **And the headroom, which is the reason this file measures a pool at all.** A positive number here is the claim
    // that there are answers the list already holds and the top twenty does not show - the only headroom a reranker
    // with a deeper pool can spend, and zero would mean a reranker could only reorder.
    expect(
      curve.reachable - recallAt(curve, TOP_K),
      'answers the list holds and the head does not',
    ).toBeGreaterThan(0);
    // **A curve that fell as the cut deepened would be an arithmetic defect**, so the assertion is here rather than in
    // the report: nine numbers that only ever grow are the one property this arithmetic has to have.
    expect(
      curve.recall.every((value, index) => index === 0 || value >= curve.recall[index - 1]!),
      'recall is non-decreasing in the cut',
    ).toBe(true);
  }, 600_000);

  /**
   * One weighting, measured on every slice of the question set that a decision could be made on.
   *
   * **Not only `dev` and `test`**: the set carries a second, more consequential split - whether a question reuses a word
   * of the name it asks for - and a weighting that leans on the name field can win one slice by being asked an easier
   * question. Both are reported so that a choice can be argued with.
   */
  interface Slices {
    dev: Column & { size: number };
    test: Column & { size: number };
    all: Column;
    withLeak: Column & { size: number };
    leakFree: Column & { size: number };
    leakFreeDev: Column & { size: number };
    leakFreeTest: Column & { size: number };
  }

  it.skipIf(process.env['PARAPHRASE_SWEEP'] !== '1')(
    're-derives the field weighting on one half of the questions, and reports the other half',
    async () => {
      const { corpusRoot, pipeline } = await analyseCorpus();
      const frozen = readQuerySet(QUERY_SET)?.queries ?? [];
      const store = strippedStore(pipeline);

      /** One weighting, measured on the same three slices - so everything below is one arithmetic, not two. */
      const measure = (weighting: FieldWeighting): Slices => {
        const engine = new HybridSearchEngine(store, weighting);
        engine.initialize();
        const cases: QueryCase[] = frozen.map((candidate) => {
          const want = `${candidate.file}::${candidate.qualifiedName}`;
          const rank = engine
            .bm25Search(candidate.query)
            .findIndex((hit) => answerKey(hit.node, corpusRoot) === want);
          return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
        });
        const dev = cases.filter((candidate) => foldOf(candidate) === 0);
        const test = cases.filter((candidate) => foldOf(candidate) === 1);
        // **The split that matters more than dev and test here.** A question that reuses a word of the name it asks for
        // can be answered by matching that word, and **fifty-two of the ninety-nine do** - so a weighting that leans on
        // the name field wins on this set partly by being asked an easier question. `leakFree` is the other forty-seven,
        // where the question shares no word of four letters or more with the name, and **a choice that gains on
        // `withLeak` and loses on `leakFree` has bought itself a column rather than a better search.**
        const leakFree = cases.filter(
          (candidate) => sharedTokens(candidate.query, candidate.name) === 0,
        );
        const withLeak = cases.filter(
          (candidate) => sharedTokens(candidate.query, candidate.name) > 0,
        );
        return {
          dev: { size: dev.length, ...summarise(dev) },
          test: { size: test.length, ...summarise(test) },
          all: summarise(cases),
          withLeak: { size: withLeak.length, ...summarise(withLeak) },
          leakFree: { size: leakFree.length, ...summarise(leakFree) },
          // **The honest slice, split the same way**: the choice is made on `leakFreeDev` and reported on
          // `leakFreeTest`, so a window into the clean half cannot be mistaken for a measurement of it.
          leakFreeDev: {
            size: leakFree.filter((candidate) => foldOf(candidate) === 0).length,
            ...summarise(leakFree.filter((candidate) => foldOf(candidate) === 0)),
          },
          leakFreeTest: {
            size: leakFree.filter((candidate) => foldOf(candidate) === 1).length,
            ...summarise(leakFree.filter((candidate) => foldOf(candidate) === 1)),
          },
        };
      };

      // **The choice is made on `dev` and stated as a rule, not as a maximum of everything measured.** Recall at 20
      // first, because that is the column the competitor matrix compares; mean reciprocal rank second, because a
      // question answered at rank 3 rather than rank 19 is the same hit and a better search box.
      const chosenBy = <T>(rows: T[], slice: (row: T) => Column): T =>
        rows.reduce((a, b) =>
          slice(b).recallAt20 > slice(a).recallAt20 ||
          (slice(b).recallAt20 === slice(a).recallAt20 && slice(b).mrr > slice(a).mrr)
            ? b
            : a,
        );

      // **Stage one is the four fields that describe a declaration, and it is the grid iteration 66 measured.** The
      // fifth field is held at zero so that a field that did not exist cannot change the choice of the four that did.
      const fourField: Array<{ name: number; path: number; signature: number; b: number }> = [];
      for (const name of [1, 2, 3]) {
        for (const path of [0, 0.5, 1]) {
          for (const signature of [0, 0.5, 1]) {
            for (const b of [0, 0.3, 0.75]) fourField.push({ name, path, signature, b });
          }
        }
      }
      const weightingOf = (config: {
        name: number;
        path: number;
        signature: number;
        b: number;
        vocabulary?: number;
        bVocabulary?: number;
      }): FieldWeighting => ({
        weight: {
          name: config.name,
          path: config.path,
          signature: config.signature,
          docstring: 1,
          vocabulary: config.vocabulary ?? 0,
        },
        lengthNormalisation: {
          name: config.b,
          path: 0.75,
          signature: 0.75,
          docstring: 0.75,
          vocabulary: config.bVocabulary ?? 0.75,
        },
      });

      const rows = fourField.map((config) => ({
        weighting: config,
        ...measure(weightingOf(config)),
      }));
      const best = chosenBy(rows, (row) => row.dev);

      // **The four-field part is not re-chosen here, and the artifact says why.** It was chosen in iteration 66 on `dev`
      // and it is the baseline this grid extends; re-choosing it on the slice the fifth field is judged on would mean
      // choosing two things at once on twenty-two questions. What the eighty-one rows above are for is the record: any
      // reader can see what the grid says today, including that it prefers the name field alone - and that preference
      // is bought on the fifty-two questions that reuse a word of the name, where every configuration is the same.
      const published = { name: 1, path: 0.5, signature: 1, b: 0 } as const;

      // **Stage two asks only what the fifth field is worth, at the weights stage one chose.** A staged choice rather
      // than an eighty-one-by-fifteen cross, because the extra cells are interactions between a field that was not
      // there and four that were - and the question is not whether a body's vocabulary interacts with the signature
      // field. It is whether it is worth anything at all, and at what weight.
      //
      // **The grid is wider than the interval that will be reported**, which is the only way a maximum can be known to
      // be inside it rather than at its edge.
      const vocabularyRows = [0, 0.25, 0.5, 1, 1.5, 2, 3]
        .flatMap((vocabulary) =>
          [0, 0.3, 0.75].map((bVocabulary) => ({
            ...published,
            vocabulary,
            bVocabulary,
          })),
        )
        .map((config) => ({ weighting: config, ...measure(weightingOf(config)) }));
      // **The fifth field is chosen on the questions the file exists for, and only among configurations that lose
      // nothing anywhere else.** A field that holds the words a *body* is written in can only help a question that
      // shares no word with the name: when the question does share one, matching that word is enough and the body's
      // vocabulary is noise. So the honest slice is the objective - **and the whole-set column is the constraint**,
      // because a configuration that answers more clean questions by breaking the leaking ones has not improved the
      // product, it has moved the cost to a question a developer will also ask.
      //
      // **The constraint is the configuration that ships, and the first version of this rule got that wrong in a way
      // that produced a number rather than a decision.** It used the *fifth field's zero row* as the bar and maximised
      // clean answers above it, which is a rule that will trade a whole-set answer for a clean one at any rate: on the
      // corrected tokenizer it selected `vocabulary 2, b 0.3` - **nine whole-set answers and thirty points of the
      // leaking half gone, for one clean question** - and the only reason it was caught is that the trade fell below
      // the lexical floor. **A challenger now has to answer at least as many questions as what ships on every column
      // this file reports**, and nothing here is noisy enough to excuse a single question: the lexical columns are
      // deterministic, so two runs of the same code return the same numbers to the last digit.
      //
      // **And if nothing clears the bar, the sweep returns what it started with.** That is a result and not a failure:
      // it says an independent eighty-one-plus-twenty-one cell grid over `dev` could not beat the choice the product
      // makes, which is a stronger statement about the weighting than any single row of the grid.
      const incumbentRow = vocabularyRows.find(
        (row) =>
          row.weighting.vocabulary === DEFAULT_FIELD_WEIGHTING.weight.vocabulary &&
          row.weighting.bVocabulary === DEFAULT_FIELD_WEIGHTING.lengthNormalisation.vocabulary,
      );
      if (!incumbentRow) {
        throw new Error(
          'the shipped weighting is not a row of the grid: a rule that defends the incumbent cannot check one it did not measure',
        );
      }
      const eligible = vocabularyRows.filter(
        (row) =>
          row.all.recallAt20 >= incumbentRow.all.recallAt20 &&
          row.all.recallAt5 >= incumbentRow.all.recallAt5 &&
          row.all.mrr >= incumbentRow.all.mrr &&
          row.leakFree.recallAt20 >= incumbentRow.leakFree.recallAt20 &&
          row.leakFree.mrr >= incumbentRow.leakFree.mrr &&
          row.withLeak.recallAt20 >= incumbentRow.withLeak.recallAt20,
      );
      const bestVocabulary = eligible.reduce((a, b) => {
        const keys: Array<[number, number]> = [
          [b.leakFreeDev.recallAt20, a.leakFreeDev.recallAt20],
          [b.leakFreeDev.mrr, a.leakFreeDev.mrr],
          [b.all.recallAt20, a.all.recallAt20],
          [b.all.mrr, a.all.mrr],
        ];
        const decision = keys.find(([x, y]) => x !== y);
        return decision === undefined ? a : decision[0] > decision[1] ? b : a;
      }, incumbentRow);

      writeFileSync(
        'benchmarks/paraphrase-field-sweep.json',
        `${JSON.stringify(
          {
            comment: [
              'Every field weighting measured on the pinned corpus and the frozen questions, with the choice re-derived',
              'from one half and reported on the other. **An input to a decision, not a headline**: the headline is the',
              'lexical column in `paraphrase-search.json`, measured with the weighting this file selects.',
              '',
              '`dev` and `test` are a stable hash split of the ninety-nine questions, so the same questions are in the',
              'same half on every machine. The rule is recall at 20 on `dev`, then mean reciprocal rank.',
              '',
              '**The choice is staged.** `rows` is the eighty-one-configuration grid over the four fields that describe',
              'a declaration, with `vocabulary` held at zero; `vocabularyRows` is the grid over the fifth field alone,',
              'at the weights `rows` chose. `chosen` is what both stages together select - a configuration the second',
              'stage measured, not a combination of two maxima.',
              '',
              '**The second stage defends the configuration that ships.** A challenger is eligible only if it answers at',
              'least as many questions on every column this measurement reports - whole set at 5, at 20 and in mean',
              'reciprocal rank, the clean half at 20 and in mean reciprocal rank, and the leaking half at 20 - and the',
              'clean half is the objective among the eligible. `chosen` equal to `incumbent` therefore means the grid',
              'found nothing better, which is a result: it is the strongest available statement that the shipped',
              'weighting is not a local accident.',
            ],
            measuredAt: new Date().toISOString().slice(0, 10),
            corpus: { path: CORPUS, nodes: pipeline.graph.nodes.size },
            queries: frozen.length,
            rule: 'eligible only if no column is worse than the shipped weighting; then maximise dev.recallAt20 on the clean half, then its mean reciprocal rank; stage one over four fields, stage two over the fifth',
            incumbent: {
              weighting: incumbentRow.weighting,
              all: incumbentRow.all,
              leakFree: incumbentRow.leakFree,
            },
            chosen: weightingOf(bestVocabulary.weighting),
            chosenIsIncumbent: bestVocabulary === incumbentRow,
            rows,
            vocabularyRows,
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
      // eslint-disable-next-line no-console -- the artifact's content, printed where a reader runs the sweep.
      console.log(
        `FIELD-SWEEP four=${JSON.stringify(best.weighting)} four@20=dev:${best.dev.recallAt20}/test:${best.test.recallAt20} ` +
          `fifth=${JSON.stringify(bestVocabulary.weighting)} ` +
          `chosen@20=dev:${bestVocabulary.dev.recallAt20}/test:${bestVocabulary.test.recallAt20}/all:${bestVocabulary.all.recallAt20} ` +
          `leakFree:${bestVocabulary.leakFree.recallAt20}(${bestVocabulary.leakFree.found}) ` +
          `leakFreeTest:${bestVocabulary.leakFreeTest.recallAt20} withLeak:${bestVocabulary.withLeak.recallAt20} ` +
          `incumbent@20:all=${incumbentRow.all.recallAt20}/leakFree=${incumbentRow.leakFree.recallAt20}(${incumbentRow.leakFree.found}) ` +
          `kept=${bestVocabulary === incumbentRow} eligible=${eligible.length}`,
      );
      expect(bestVocabulary.all.recallAt20).toBeGreaterThanOrEqual(LEXICAL_FLOOR.recallAt20);
    },
    1_800_000,
  );
});

describe.skipIf(!HAS_VECTORS || (NEEDS_QUERY_AUTHOR && !CAN_WRITE_QUERIES))(
  'finding a symbol from a paraphrase, with its documentation removed',
  () => {
    it('measures lexical and fused recall on an index that holds no doc comments', async () => {
      // **The root the graph was built from, and the one both sides of every match are normalised against.**
      const { corpusRoot, pipeline } = await analyseCorpus();
      const frozenKey = (candidate: FrozenQuery): string =>
        `${candidate.file}::${candidate.qualifiedName}`;

      // **Every node loses its doc comment before indexing**, for every symbol rather than for the queried one: a
      // leave-one-out index would need a rebuild per query, and a global strip is the same statement about every query
      // at once.
      const stripped = new Map<number, GraphNode>();
      for (const node of pipeline.graph.nodes.values()) {
        const {
          embedding: _previous,
          embeddingBackend: _previousBackend,
          ...rest
        } = (node.properties ?? {}) as { embedding?: unknown; embeddingBackend?: unknown };
        stripped.set(node.id, { ...node, docstring: null, properties: rest });
      }

      // **Re-embedded from the stripped text**, because a vector is a function of the text it was built from: keeping the
      // docstring-bearing vectors would leave the leak in the half under test.
      const {
        results: vectors,
        backend,
        reason,
      } = await generateEmbeddings(stripped, defaultEmbedderLoader);
      const vectorById = new Map(vectors.map((v) => [v.nodeId, v.embedding]));

      // **The store assigns its own ids**, so the vectors are re-keyed as the nodes go in - a lookup by the *original* id
      // would find nothing and the semantic list would be empty for a reason that has nothing to do with retrieval.
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

      // **The queries are a fixed dataset, and every run measures the same ones.** The first run writes the file; every
      // later run reads it, so a difference between two runs is a difference between two retrievers. `REGENERATE`
      // rewrites it, which is a deliberate act because it makes every earlier figure incomparable.
      const frozen = REGENERATE ? null : readQuerySet(QUERY_SET);
      const paraphrases: FrozenQuery[] = [];
      let dropped = 0;
      let source: 'frozen' | 'generated';

      if (frozen) {
        source = 'frozen';
        dropped = frozen.dropped;
        paraphrases.push(...frozen.queries);
        // **That every question still has an answer is asserted in `the frozen questions and the frozen corpus`**, which
        // runs on a machine with no credential. The check used to live here, inside a block that is skipped without one,
        // which is how four questions about renamed symbols scored as misses for four days without a red run that said so.
      } else {
        source = 'generated';
        // **The queries come from the doc comments of the *original* graph** - the documentation is the source of the
        // question even though it is not in the index.
        const documented = [...pipeline.graph.nodes.values()]
          .filter((node) => (node.docstring ?? '').trim().length >= MIN_DOCSTRING)
          .filter((node) => typeof node.name === 'string' && node.name.length > 2)
          .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
        const step = Math.max(1, Math.floor(documented.length / MAX_QUERIES));
        const sampled = documented.filter((_, index) => index % step === 0).slice(0, MAX_QUERIES);

        const provider = new DeepSeekProvider({ timeout: 30_000 });
        for (const node of sampled) {
          const completion = await provider.complete(
            paraphrasePrompt((node.docstring ?? '').trim().slice(0, 1_000)),
            { maxTokens: 80, temperature: 0 },
          );
          const query = cleanCompletion(completion.content);
          // **A question that names the symbol is the lookup this file exists to replace**, so it is dropped rather
          // than counted as a win for either column.
          if (query.length < 10 || namesTheSymbol(query, node.name)) {
            dropped += 1;
            continue;
          }
          paraphrases.push({
            file: stripRoot(corpusRoot, node.filePath ?? ''),
            qualifiedName: node.qualifiedName,
            name: node.name,
            query,
          });
        }
        writeQuerySet(QUERY_SET, paraphrases, dropped);
      }

      // **A measurement with no queries is not a passing measurement**, and here it is also the signal that the model
      // stopped obeying the prompt - which is a fact worth failing on rather than publishing as a recall of zero.
      expect(paraphrases.length).toBeGreaterThanOrEqual(20);
      // **And a frozen set that contains a lookup invalidates every column in it.** The prompt forbids the name; this
      // is the check that the rule held, applied to both sources so a regenerated set cannot skip it.
      expect(paraphrases.filter((c) => namesTheSymbol(c.query, c.name))).toEqual([]);
      const overlap = paraphrases.filter((c) => sharedTokens(c.query, c.name) > 0).length;

      const lexicalLists = paraphrases.map((candidate) =>
        lexicalEngine.bm25Search(candidate.query),
      );
      const lexical: QueryCase[] = paraphrases.map((candidate, index) => {
        const rank = lexicalLists[index]!.findIndex(
          (hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate),
        );
        return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
      });

      const semanticLists: Array<Array<{ node: GraphNode; score: number }>> = [];
      // **One vector search per question, at the deepest pool any arm is given.** The list is sorted by similarity and
      // its ties are broken by identity, so its first twenty *is* the list a `vectorSearch(query, 20)` returns - the
      // columns below are unchanged by construction - and the deeper prefix is what the ceiling sweep and the deep arm
      // need, at no extra call.
      const semanticDeep: Array<Array<{ node: GraphNode; score: number }>> = [];
      if (queryEmbedder) {
        for (const candidate of paraphrases) {
          semanticDeep.push(await hybrid.vectorSearch(candidate.query, MAX_POOL, null));
        }
        semanticLists.push(...semanticDeep.map((ranked) => ranked.slice(0, TOP_K)));
      }

      const sweep = VECTOR_WEIGHTS.map((vectorWeight) => {
        const cases: QueryCase[] = paraphrases.map((candidate, index) => {
          const fused = hybrid.fuseResults(
            lexicalLists[index]!.slice(0, TOP_K).map((hit) => ({
              node: hit.node,
              score: hit.score,
            })),
            (semanticLists[index] ?? []).map((hit) => ({ node: hit.node, score: hit.score })),
            60,
            TOP_K,
            vectorWeight,
          );
          const rank = fused.findIndex(
            (hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate),
          );
          return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
        });
        return { vectorWeight, ...summarise(cases) };
      });

      const lexicalColumn = summarise(lexical);
      const semantic = backend !== 'deterministic' && queryEmbedder !== null;

      // -----------------------------------------------------------------------------------------------------------
      // The candidate compositions, measured on the same ninety-nine questions.
      // -----------------------------------------------------------------------------------------------------------
      //
      // **A variant is worth measuring only if it shares everything but the thing it changes.** The first two run on
      // the same stripped corpus, the same lexical lists and the same fusion weight (1); they differ in the text the
      // index vector is built from and, for the second, in the vector the query is searched with. The last two differ
      // in the depth of the pool a reranker reads and in nothing else. **None is the product default until its column
      // beats the control**, which is why `embeddingText` takes the option instead of shipping it and why the deep arm
      // is published beside the shallow one rather than replacing it.
      const variants: VariantColumn[] = [];

      // **One fused column, computed the same way as the sweep**: the lexical list cut at twenty, the semantic list
      // fused into it at the product's weight, the answer looked for inside the twenty.
      const fuse = (
        engine: HybridSearchEngine,
        lists: Array<Array<{ node: GraphNode; score: number }>>,
        vectorWeight: number,
      ): Column & { slices: ReturnType<typeof sliceOf> } => {
        const cases = paraphrases.map((candidate, index) => {
          const fused = engine.fuseResults(
            lexicalLists[index]!.slice(0, TOP_K).map((hit) => ({
              node: hit.node,
              score: hit.score,
            })),
            (lists[index] ?? []).map((hit) => ({ node: hit.node, score: hit.score })),
            60,
            TOP_K,
            vectorWeight,
          );
          const rank = fused.findIndex(
            (hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate),
          );
          return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
        });
        return { ...summarise(cases), slices: sliceOf(cases) };
      };

      // **The ceiling of the pool at every depth a reranker could be given**, filled below when there is a semantic list
      // to fuse: without one the pool is the lexical list and its ceiling is already the depth curve.
      const poolDepth: Array<{ depth: number; ceiling: number }> = [];

      if (queryEmbedder) {
        // **Arithmetic on two lists that are already in memory.** The fused list at depth `d` is the fusion of the two
        // lists cut at `d`, so the whole sweep costs no completion and no second vector search - and it is the number
        // every rerank arm is bounded by.
        //
        // **It is also the only honest answer to "would a deeper pool help"**: an arm cannot reach an answer the pool
        // does not hold, so a depth whose ceiling has stopped moving is a depth past which the next lever is the query
        // side. The gaps between the rows are what this file is buying when it widens a prompt.
        for (const depth of POOL_DEPTHS) {
          if (depth > MAX_POOL) continue;
          let hits = 0;
          for (let index = 0; index < paraphrases.length; index++) {
            const candidate = paraphrases[index]!;
            const fused = hybrid.fuseResults(
              lexicalLists[index]!.slice(0, depth).map((hit) => ({
                node: hit.node,
                score: hit.score,
              })),
              (semanticDeep[index] ?? [])
                .slice(0, depth)
                .map((hit) => ({ node: hit.node, score: hit.score })),
              60,
              depth,
              1,
            );
            if (fused.some((hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate)))
              hits += 1;
          }
          poolDepth.push({
            depth,
            ceiling: Math.round((hits / paraphrases.length) * 10000) / 10000,
          });
        }
        // **A ceiling that fell when the pool deepened would be a defect in the fusion and not a fact about retrieval**:
        // a longer pair of candidate lists cannot make an answer *less* available. It is asserted where it is computed,
        // because the artifact would otherwise report a falling curve as if it were a measurement.
        expect(
          poolDepth.every(
            (row, index) => index === 0 || row.ceiling >= poolDepth[index - 1]!.ceiling,
          ),
          `pool ceilings by depth: ${poolDepth.map((row) => `${row.depth}:${row.ceiling}`).join(' ')}`,
        ).toBe(true);

        // **The composition the product shipped before this measurement**: no path in the text. Kept as a column so the
        // gain the path produced is visible in the artifact rather than only in a commit message.
        const withoutPath = await generateEmbeddings(stripped, defaultEmbedderLoader, {
          includePath: false,
        });
        const plainVectors = new Map(withoutPath.results.map((r) => [r.nodeId, r.embedding]));
        const plainStore = new InMemoryGraphStore();
        const plainByStoreId = new Map<number, Float32Array>();
        for (const node of stripped.values()) {
          const vector = plainVectors.get(node.id);
          const storeId = plainStore.insertNode({
            ...node,
            properties: vector
              ? { ...node.properties, embedding: vector, embeddingBackend: withoutPath.backend }
              : node.properties,
          });
          if (vector) plainByStoreId.set(storeId, Float32Array.from(vector));
        }
        const plainHybrid = new HybridSearchEngine(plainStore);
        plainHybrid.initialize();
        const plainQueryEmbedder = await createQueryEmbedder(withoutPath.backend);
        if (plainQueryEmbedder) {
          plainHybrid.registerEmbeddings(
            (nodeId) => plainByStoreId.get(nodeId) ?? null,
            (text) => plainQueryEmbedder.embed(text),
          );
        }

        // **Both indices have to live in the same space as the product's**, or the comparison is between two models. A
        // run that hit the endpoint's limit falls back to hash vectors, and a hash index would answer this corpus with
        // noise that could still clear the lexical floor - so the arm is refused rather than published.
        if (!plainQueryEmbedder || withoutPath.backend !== backend) {
          variants.push({
            name: 'no-path',
            note: 'the composition the product shipped before the path was measured in',
            reason: `the product index is ${backend} and the control came back as ${withoutPath.backend} — two spaces do not compare`,
          });
        } else {
          const plainLists: Array<Array<{ node: GraphNode; score: number }>> = [];
          for (const candidate of paraphrases) {
            plainLists.push(await plainHybrid.vectorSearch(candidate.query, TOP_K, null));
          }
          variants.push({
            name: 'no-path',
            note: 'the composition the product shipped before the path was measured in',
            ...fuse(plainHybrid, plainLists, 1),
          });
          await plainQueryEmbedder.dispose().catch(() => undefined);
        }

        // **`hyde`**: the query vector is the mean of the question and an implementation DeepSeek writes for it. **The
        // hypothesis lives in the corpus's vocabulary** - names, types, call shape - while the question does not, which
        // is the asymmetry this arm exists to test. It runs on the product index, so the delta is the query side alone.
        if (CAN_WRITE_QUERIES) {
          const provider = new DeepSeekProvider({ timeout: 30_000 });
          const hydeLists: Array<Array<{ node: GraphNode; score: number }>> = [];
          let hypotheses = 0;
          for (const candidate of paraphrases) {
            const expanded = await expandToVector(candidate.query, provider, (text) =>
              queryEmbedder.embed(text),
            );
            if (expanded.hypothesis.length > 0) hypotheses += 1;
            // **The precomputed vector**, because the query is no longer one string.
            hydeLists.push(
              await hybrid.vectorSearch(candidate.query, TOP_K, null, expanded.vector),
            );
          }
          variants.push({
            name: 'hyde',
            note: 'the product index; the query vector is the mean of the question and a hypothesis',
            hypotheses,
            ...fuse(hybrid, hydeLists, 1),
          });
        } else {
          variants.push({
            name: 'hyde',
            note: 'the product index; the query vector is the mean of the question and a hypothesis',
            reason:
              'DEEPSEEK_API_KEY is absent, so no hypothesis can be written and this arm did not run',
          });
        }
        // **`rerank`, at two depths.** The fused pool, ordered by a model that can see all of it, then cut at twenty.
        //
        // **The pool is the ceiling, and it is published.** A reranker cannot answer a question whose symbol was not in
        // the list it was given, so a reader who sees recall@20 rise without seeing the pool would not know whether the
        // ordering did the work or a deeper candidate list did. **The two arms below differ in the depth of that list
        // and in nothing else** - same index, same questions, same fusion weight, same answer budget - which is the
        // only way the difference between their columns is the depth.
        if (CAN_WRITE_QUERIES) {
          const provider = new DeepSeekProvider({ timeout: 60_000 });
          const rerankArm = async (depth: number): Promise<VariantColumn> => {
            const cases: QueryCase[] = [];
            let reranked = 0;
            let poolHits = 0;
            for (let index = 0; index < paraphrases.length; index++) {
              const candidate = paraphrases[index]!;
              const fused = hybrid.fuseResults(
                lexicalLists[index]!.slice(0, depth).map((hit) => ({
                  node: hit.node,
                  score: hit.score,
                })),
                (semanticDeep[index] ?? [])
                  .slice(0, depth)
                  .map((hit) => ({ node: hit.node, score: hit.score })),
                60,
                depth,
                1,
              );
              if (fused.some((hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate))) {
                poolHits += 1;
              }
              const entries = fused.map((hit, position) => ({ rank: position + 1, hit }));
              const result = await rerankCandidates(
                candidate.query,
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
                { maxTokens: ANSWER_BUDGET, timeout: 60_000 },
              );
              if (result.applied) reranked += 1;
              const rank = result.ordered
                .slice(0, TOP_K)
                .findIndex(
                  (entry) => answerKey(entry.hit.node, corpusRoot) === frozenKey(candidate),
                );
              cases.push({ ...candidate, rank: rank >= 0 ? rank + 1 : null });
            }
            return {
              name: depth === RERANK_POOL ? 'rerank' : 'rerank-deep',
              note: `the fused top ${depth}, reordered by a model, cut at ${TOP_K}`,
              reranked,
              poolDepth: depth,
              poolRecallAt20: Math.round((poolHits / paraphrases.length) * 10000) / 10000,
              ...summarise(cases),
              slices: sliceOf(cases),
            };
          };

          const shallow = await rerankArm(RERANK_POOL);
          // **The sweep and the arm are two computations of one quantity**, and they have to agree: the ceiling at the
          // shallow depth is the pool ceiling the arm has published for two iterations, and a sweep that disagreed
          // with it would be a new arithmetic rather than the same one applied to a longer list.
          expect(
            poolDepth.find((row) => row.depth === RERANK_POOL)?.ceiling,
            `the depth sweep and the ${RERANK_POOL}-deep arm agree on the pool ceiling`,
          ).toBe(shallow.poolRecallAt20);
          variants.push(shallow);
          // **And the same arm on a deeper list.** A pool that stops moving the ceiling is a pool past which the next
          // lever is the query side; a pool that moves it and does not move the column is a reranker that cannot read
          // that far, and the two failures call for different work.
          variants.push(await rerankArm(DEEP_RERANK_POOL));
        } else {
          for (const depth of [RERANK_POOL, DEEP_RERANK_POOL]) {
            variants.push({
              name: depth === RERANK_POOL ? 'rerank' : 'rerank-deep',
              note: `the fused top ${depth}, reordered by a model, cut at ${TOP_K}`,
              reason:
                'DEEPSEEK_API_KEY is absent, so no ordering can be asked for and this arm did not run',
            });
          }
        }
      }

      const artifact = {
        comment: [
          'Recall at top-k for a symbol queried by a paraphrase of its documentation, with **no doc comment in the index**.',
          '',
          '**The doc comment is the query and not part of the document**, which is what makes this different from',
          '`docstring-search.json`: there the retriever can copy the words it is asked about, and every column comes out',
          'at the same 1.000 for that reason.',
          '',
          '**The questions are written by DeepSeek from the documentation**, with a rule against using the symbol name,',
          'and a question that still contains one is dropped and counted in `dropped`. **The set is frozen in',
          '`benchmarks/paraphrase-queries.json`** so that two runs differ in the retriever and not in the questions.',
          '',
          '**The corpus is pinned the same way.** `benchmarks/retrieval-corpus` is the tree those questions were written',
          'from, so this figure is comparable with the figure from any other commit: both inputs are fixed and only the',
          'retriever moves between runs. When the corpus was the live `packages/analyzer/src/languages`, a rename in the',
          'product invalidated four questions and the measurement failed for four days without measuring anything.',
          '',
          '**Every column is measured at the same cut**: `recallAt20` counts answers inside the top 20, `mrr` gives a rank',
          'beyond 20 the value 0, and `found` is `found@20`. The lexical list is unbounded, so an arithmetic that counted',
          'any rank would have measured a longer list against a shorter one.',
          '',
          '**Both columns run on the same index**: BM25 over name/signature only, and the same list fused with one',
          'semantic ranking at each weight.',
          '',
          '**`lexicalDepth` says where the answer sits rather than only whether it is inside twenty.** Recall at nine',
          'cuts, the share the list holds at any rank (`reachable`, the ceiling no pool depth can pass), and the median',
          'rank of a found answer. The gap between `reachable` and recall at 20 is the headroom a reranker with a deeper',
          'pool is offered, and it is the number the `rerank` and `rerank-deep` arms are bounded by.',
          '',
          '**`poolDepth` is that ceiling measured on the fused list** at every depth a reranker could be given. It costs',
          'no completion: the fused list at depth d is the fusion of the two candidate lists cut at d',
        ],
        measuredAt: new Date().toISOString().slice(0, 10),
        querySet: {
          // **`frozen` or `generated`**: a figure whose questions were rewritten on the same run that measured it cannot
          // be compared with the previous one, and this field is how a reader tells which it is.
          source,
          path: QUERY_SET,
          size: paraphrases.length,
        },
        corpus: {
          path: CORPUS,
          nodes: stripped.size,
          queries: paraphrases.length,
          dropped,
          // **How many questions still reuse a word of the name they ask for.** Reported rather than filtered, so a
          // reader can judge the query set instead of trusting a percentage.
          withAWordFromTheName: overlap,
        },
        space: {
          index: backend,
          query: queryEmbedder?.backend ?? 'none',
          semantic,
          reason: semantic ? null : reason,
        },
        topK: TOP_K,
        lexical: lexicalColumn,
        // **Where the answer sits, not only whether it is inside twenty**: see the note on `lexicalDepth` above.
        lexicalDepth: depthCurve(lexical),
        // **And on which half of the question set it was earned**: see the note on `sliceOf`.
        lexicalSlices: sliceOf(lexical),
        // **The ceiling of each pool the arms below were given**, and the reason a deeper one could help at all.
        poolDepth,
        answerBudget: ANSWER_BUDGET,
        variants,
        semanticSweep: sweep,
        // The row the product runs - see the note in `docstring-search.test.ts`.
        fused: { ...(sweep.find((row) => row.vectorWeight === 1) ?? sweep[0]) },
        target: {
          recall: 0.9,
          competitorRecall: 0.75,
          competitor: 'Cody, quoted by the whitepaper',
        },
        misses: lexical
          .filter((c) => c.rank === null)
          .map((c) => `${c.name}: ${c.query.slice(0, 80)}`)
          .slice(0, 8),
      };

      const recorded = recordArtifact('benchmarks/paraphrase-search.json', artifact);
      // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
      if (!recorded.written) console.log(`PARAPHRASE-SEARCH artifact ${recorded.because}`);
      await queryEmbedder?.dispose().catch(() => undefined);

      // The summary line **is** the interface: the workflow greps it into the job summary.
      // eslint-disable-next-line no-console
      console.log(
        `PARAPHRASE-SEARCH queries=${paraphrases.length} dropped=${dropped} space=${backend}/${queryEmbedder?.backend ?? 'none'} ` +
          `lexical@5=${lexicalColumn.recallAt5} @20=${lexicalColumn.recallAt20} mrr=${lexicalColumn.mrr} ` +
          `sweep=${sweep.map((s) => `${s.vectorWeight}:@20=${s.recallAt20}/mrr=${s.mrr}`).join(' ')} ` +
          `variants=${variants
            .map(
              (v) =>
                `${v.name}:@20=${v.recallAt20 ?? '-'}/mrr=${v.mrr ?? '-'}` +
                (v.slices ? `/clean=${v.slices.leakFree.recallAt20}` : ''),
            )
            .join(' ')} ` +
          `pool=${poolDepth.map((row) => `${row.depth}:${row.ceiling}`).join('/')} ` +
          `ceiling=${depthCurve(lexical).reachable}`,
      );

      // **The only claim this file can make without a semantic half**: the questions are answerable at all on an index
      // that holds no documentation, which is what a paraphrase query is.
      expect(lexicalColumn.recallAt20).toBeGreaterThan(0);

      // **And the invariant the semantic half owes the lexical one**, when a real model is on both sides.
      if (semantic) {
        const best = sweep.reduce((a, b) => (b.recallAt20 >= a.recallAt20 ? b : a));
        expect(best.recallAt20, `best weight ${best.vectorWeight}`).toBeGreaterThanOrEqual(
          lexicalColumn.recallAt20,
        );
        // **And the order**: a fusion that keeps the answer inside the top 20 but pushes it from rank 1 to rank 5 is a
        // regression a user feels, and one recall cannot see.
        expect(best.mrr, `best weight ${best.vectorWeight} MRR`).toBeGreaterThanOrEqual(
          lexicalColumn.mrr,
        );
      }

      // **Every variant is held to the same floor the product is**: a composition that answers fewer questions than the
      // lexical list is not an improvement, whatever it does to the order. **A variant that did not run is not held to
      // it** - it carries a `reason` instead, and the artifact shows both states.
      for (const variant of variants) {
        if (variant.reason) continue;
        expect(
          variant.recallAt20,
          `${variant.name} answered ${variant.recallAt20 ?? 0} recall@20 against lexical ${lexicalColumn.recallAt20}`,
        ).toBeGreaterThanOrEqual(lexicalColumn.recallAt20);
      }

      // **And no arm can pass the ceiling it was given.** This is the arithmetic that makes the two rerank rows
      // readable: a row at the ceiling says the ordering is solved and the pool is the lever; a row far below its
      // ceiling says the opposite, and the two look identical next to a recall figure alone.
      for (const variant of variants) {
        if (variant.reason || variant.poolRecallAt20 === undefined) continue;
        expect(
          variant.recallAt20 ?? 0,
          `${variant.name} answered ${variant.recallAt20 ?? 0} of a pool that held ${variant.poolRecallAt20}`,
        ).toBeLessThanOrEqual(variant.poolRecallAt20);
      }
    }, 3_600_000);
  },
);
