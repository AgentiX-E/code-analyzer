// @code-analyzer/intelligence — one instance of the bug-localisation measurement, as a unit of work
//
// **Why the measurement is a module and not a loop inside a test.** Iteration 68 closed with the Kotlin leg of the Long
// Code Arena job red: `airbnb/lottie-android`, a thousand-odd files, an analysis that grew past what the runner could
// hold and a `SIGTERM` at five minutes - and the row was lost because the only thing that could have recorded it was the
// process that died. The repair is not a smaller bound. It is that **one instance is measured by one process**, which
// can be killed without taking the measurement with it, and a module is what both the process and its test can call.
//
// **The two arms, unchanged.** `retrieval` is the fused list cut at k with no model involved - free, deterministic, and
// a change in it is a change in the retriever. `answer` is the file set the model cited, scored with the same ruler.
//
// **And the third figure, which iteration 69 adds.** The corpus's own metric scores a set at a fixed cut; the paper's
// baseline table reports **MAP**. Both are computed here from the same ranked list, and the ranked list is published in
// the row's first ten entries so that a reader can see why a precision column and a MAP column disagree.

import { join } from 'node:path';

import { PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import {
  averagePrecision,
  checkoutBytes,
  firstRelevantRank,
  corpusBytes,
  dedupePreservingOrder,
  lcaQualityMetrics,
  outsideUniverse,
  restrictToUniverse,
  toCorpusPath,
} from './lca-instrument.js';
import { askCodebase } from '../qa/ask.js';
import { FILE_AGGREGATIONS, rankFiles } from '../search/file-ranking.js';
import { reciprocalRankFusion } from '../search/fusion.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { ArmMetrics, FileArmScore, LcaRowScore } from './lca-merge.js';
import type { LLMProvider } from '../review/llm/provider.js';
import type { PoolEntry } from '../search/file-ranking.js';
import type { GraphEdge, GraphNode, PipelineContext } from '@code-analyzer/shared';

/** One row of the corpus's test split, as the harness reads it. */
export interface LcaCorpusRow {
  readonly id: number;
  readonly repo_owner: string;
  readonly repo_name: string;
  readonly base_sha?: string;
  readonly issue_title: string;
  readonly issue_body: string;
  readonly changed_files: readonly string[];
}

/** The cuts the retrieval arm reports. **Fixed in advance**, because a cut chosen after seeing the answer is a fit. */
export const RETRIEVAL_CUTS = [1, 3, 5, 10] as const;

/**
 * How deep the average-precision column reads.
 *
 * **Two hundred, which is the retriever's own pool** (`retrieveLimit`). A depth larger than the pool would report a
 * figure about a list that does not exist, and a smaller one would silently truncate a ranking the product already
 * produced. The number is in the artifact beside the column.
 */
export const MAP_DEPTH = 200;

/** What one instance needs: the row, the checkout, the answer space, and optionally a model. */
export interface MeasureInput {
  readonly row: LcaCorpusRow;
  /** The checkout of `repo_owner/repo_name` at `base_sha`, **already fetched**. */
  readonly checkout: string;
  /** Every non-test file of the configuration's extension, repository-relative. **The answer space.** */
  readonly allFiles: readonly string[];
  /** The provider for the answer arm, or `null` when this run has no key. */
  readonly provider?: LLMProvider | null;
  /** Blocks the answer is assembled from. Stated rather than defaulted, because a figure is about a budget. */
  readonly maxBlocks?: number;
  /** Candidates retrieval returns before the cuts are taken. */
  readonly retrieveLimit?: number;
  /**
   * A file-level ranking to fuse into the product's file ranking, **repository-relative and already computed**.
   *
   * **Computed by the parent and handed in, because the parent is the process that survives.** The file-level arm reads
   * one eight-kilobyte head per file and needs no parser, so it ranks the checkout the analysis is about to be killed
   * on; computing it here would restrict it to the instances that did not need it. It is also the same reading the
   * fallback column is scored from, so the two cannot disagree about what a file's name and imports are.
   */
  readonly fileSignals?: readonly string[];
}

/** The seven figures the authors' metric produces, for one instance. */
function metricsOf(
  allFiles: readonly string[],
  expected: readonly string[],
  actual: string[],
): ArmMetrics {
  const score = lcaQualityMetrics([...allFiles], [...expected], actual);
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

/**
 * Copy an analysed graph into a store, **renumbering the nodes and skipping an edge whose endpoint is not there**.
 *
 * **The skip is not defensive noise, it is a resolver fact**: an edge can name a node the graph never registered (an
 * external symbol, a declaration the walk refused), and an edge pointing at a node id the store does not hold would
 * make every later query answer with a dangling target. It is a function rather than three lines inside
 * `measureInstance` so that the case has a test with a graph that really holds such an edge, rather than being a branch
 * the fixture never reaches.
 */
export function insertGraph(
  store: InMemoryGraphStore,
  nodes: Iterable<GraphNode>,
  edges: Iterable<GraphEdge>,
): void {
  const storeIdOf = new Map<number, number>();
  for (const node of nodes) {
    storeIdOf.set(node.id, store.insertNode(node));
  }
  for (const edge of edges) {
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
}

/** Analyse one checkout, ask the question, and score both arms. **The only place the product is exercised.** */
export async function measureInstance(input: MeasureInput): Promise<LcaRowScore> {
  const provider = input.provider ?? null;
  const maxBlocks = input.maxBlocks ?? 40;
  const retrieveLimit = input.retrieveLimit ?? MAP_DEPTH;
  const ctx = {
    projectId: `${input.row.repo_owner}/${input.row.repo_name}`,
    rootPath: input.checkout,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;

  const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
  // **What the analysis produced, counted before the graph is copied into a store.** Resident memory holds objects -
  // one per declaration, one per edge - so the count of them is the first predictor that names the thing the ceiling is
  // actually bounding. The two byte totals measured before this were proxies, and both failed: the checkout's bytes are
  // dominated by assets the pipeline never parses.
  const graphNodes = pipeline.graph.nodes.size;
  const graphEdges = pipeline.graph.edges.size;
  const store = new InMemoryGraphStore();
  insertGraph(store, pipeline.graph.nodes.values(), pipeline.graph.edges.values());

  const search = new HybridSearchEngine(store);
  search.initialize();

  const question = `${input.row.issue_title}\n\n${input.row.issue_body}`.trim();
  const result = await askCodebase({
    question,
    store,
    search,
    ...(provider ? { provider } : {}),
    options: {
      generate: Boolean(provider),
      rerank: Boolean(provider),
      maxBlocks,
      retrieveLimit,
      // **The fusion is the product's, not the harness's.** `askCodebase` returns `fusedFiles` beside `rankedFiles`,
      // so a row carries both readings and the ablation of the fusion is a subtraction of two columns rather than a
      // second run. The arm is given in the graph's own coordinate system, which is what the store's `filePath` holds.
      ...(input.fileSignals === undefined
        ? {}
        : { fileSignals: { ranked: input.fileSignals.map((file) => join(input.checkout, file)) } }),
    },
  });

  // **The two halves of this comparison are recorded in different coordinate systems**, and the first published run of
  // this instrument scored 0.0000 in three languages because of it: the pipeline writes `filePath` as an absolute path
  // while the corpus records repository-relative ones. `toCorpusPath` is the conversion and it has its own tests.
  //
  // **The second conversion is the answer space.** The corpus counts the non-test files of the configuration's extension
  // and the published baselines rank exactly that set, so a `History.md` our retriever offers was never in the running.
  // Restricting to that set is a filter that preserves the retriever's order.
  //
  // **And the list is `rankedFiles`, not `retrievedFiles` - which is a defect this line used to have.** `retrievedFiles`
  // is the files of the blocks that survived `maxBlocks`, a **prompt** budget of forty blocks that also admits the
  // structural neighbours the retriever never ranked. Measured over real instances, that list held **five to nine
  // files**, so the MAP column was computed over a tenth of the depth the metric reads and the published baselines use:
  // **the answer arm's context budget was truncating the retrieval arm's denominator.** `rankedFiles` is the fused
  // ranking before that budget applies, which is what the retrieval arm claims to be.
  const universe = new Set(input.allFiles);
  const offeredRaw = dedupePreservingOrder(
    result.rankedFiles.map((file) => toCorpusPath(input.checkout, file)),
  );
  // **The fused list, converted the same way**, so the two differ in the ranking and not in the coordinate system. Both
  // are cut to the answer space by the same filter, in the same order, which is what makes the difference between their
  // figures a difference the fusion produced.
  const fusedRaw = dedupePreservingOrder(
    result.fusedFiles.map((file) => toCorpusPath(input.checkout, file)),
  );
  const candidates = restrictToUniverse(fusedRaw, universe);
  const declarations = restrictToUniverse(offeredRaw, universe);
  const answered = restrictToUniverse(
    result.files.map((file) => toCorpusPath(input.checkout, file)),
    universe,
  );

  // **The same pool, read as a ranking of files five ways.** The retrieval stage ranks declarations and the corpus asks
  // which files must change; `search/file-ranking.ts` is the conversion and this is where its alternatives are measured
  // rather than argued. Every arm reads the identical pool - the candidate list the product returned, mapped into the
  // corpus's coordinate system and cut to the answer space - so the only thing that differs between them is the rule
  // for turning a file's declarations into a file's position.
  //
  // **The first arm is the control, not a competitor.** `max` is what the product ships, so its `map` must equal the
  // row's `map` and its `answerRank` the row's `answerRank`; the gate refuses an artifact where they disagree, which is
  // how a wiring mistake in the armature is told from a measurement that found nothing.
  // **The pool, converted and cut, entry by entry.** A file's *declarations* are what the aggregation reads, so the
  // pool keeps one entry per declaration rather than one per path: collapsing it here would leave every arm reading the
  // same single score per file and make the armature a test of five identical functions.
  const pool: PoolEntry[] = [];
  for (const entry of result.rankedPool) {
    const path = toCorpusPath(input.checkout, entry.filePath);
    if (!universe.has(path)) continue;
    pool.push({ filePath: path, score: entry.score });
  }
  // **The armature's second reading, and the reason it needs a pool the first one does not.** The product fuses the
  // pool's own file ranking with the file-level arm (`search/fusion.ts`), so an armature that published only the pool's
  // figures would describe a ranking nothing ships and every comparison it printed would be a comparison of four
  // candidates and a control, none of which is the product. Reproducing the fused ranking needs two things the
  // universe-filtered pool cannot give it:
  //
  //   * the declaration ranking **before** the answer space is applied, because reciprocal rank fusion scores a path by
  //     its *position* in each arm and removing a path shifts the position of every path after it;
  //   * the file-level arm itself, in the same coordinate system and at its own full length, for the same reason.
  //
  // The fusion is then restricted to the answer space, which preserves the order it produced - exactly the sequence the
  // product's own column was scored from.
  const armaturePool: PoolEntry[] = result.rankedPool.map((entry) => ({
    filePath: toCorpusPath(input.checkout, entry.filePath),
    score: entry.score,
  }));
  const fileLevelArm = (input.fileSignals ?? []).map((file) => toCorpusPath(input.checkout, file));
  const fileArms: FileArmScore[] = FILE_AGGREGATIONS.map((aggregation) => {
    const ranked = rankFiles(pool, aggregation).map((file) => file.filePath);
    const throughTheWholePool = rankFiles(armaturePool, aggregation).map((file) => file.filePath);
    const fused = restrictToUniverse(
      [
        ...reciprocalRankFusion([
          { name: 'declarations', ranked: throughTheWholePool },
          { name: 'file-level', ranked: fileLevelArm },
        ]).ranked,
      ],
      universe,
    );
    return {
      aggregation,
      map: averagePrecision(ranked, input.row.changed_files, MAP_DEPTH),
      answerRank: firstRelevantRank(ranked.slice(0, MAP_DEPTH), input.row.changed_files),
      fusedMap: averagePrecision(fused, input.row.changed_files, MAP_DEPTH),
      fusedAnswerRank: firstRelevantRank(fused.slice(0, MAP_DEPTH), input.row.changed_files),
    };
  });

  const retrieval: Record<string, ArmMetrics> = {};
  for (const cut of RETRIEVAL_CUTS) {
    retrieval[`at${String(cut)}`] = metricsOf(
      input.allFiles,
      input.row.changed_files,
      candidates.slice(0, cut),
    );
  }

  store.close();

  // **The size of the answer space, because the bounds are calibrated against it.** Peak memory per corpus file spans
  // 1.3 MB to 430 MB across the instances this harness has run, so the fit that replaces `constant × files` needs the
  // bytes per row. It is counted here rather than in the orchestrator because this is the only place that already holds
  // the answer space and the checkout together.
  const size = corpusBytes(input.checkout, input.allFiles);
  // **And the size of everything the pipeline walked**, which is a different quantity and the one the first fit showed
  // matters: 52 Java files worth 122 KB cost 3 074 MB on `appium/appium` because the pipeline parses the whole checkout.
  const walked = checkoutBytes(input.checkout);

  return {
    id: input.row.id,
    repo: `${input.row.repo_owner}/${input.row.repo_name}`,
    corpusFiles: input.allFiles.length,
    expectedFiles: input.row.changed_files.length,
    expectedOutside: input.row.changed_files.filter((file) => !universe.has(file)).length,
    offered: candidates.length,
    // **Where the answer actually sits**, on the same list and to the same depth as the MAP column, so that a row whose
    // figure is small because the ranking is bad can be told from one whose figure is small because the answer is not
    // in the text at all. The control's own rank is published beside it by the orchestrator.
    answerRank: firstRelevantRank(candidates.slice(0, MAP_DEPTH), input.row.changed_files),
    outside: outsideUniverse(offeredRaw, universe),
    offeredPaths: offeredRaw.slice(0, 10),
    // **The ranking the fusion produced, in full and to the metric's depth.** The parent needs it for two things a
    // ten-entry preview cannot support: the row's own `fusion` block, and an audit of whether a gain came from the
    // file-level arm promoting a path the pool never ranked. Two hundred entries of a relative path is a few kilobytes
    // on a row that already carries two byte totals and a graph count.
    rankedPaths: candidates.slice(0, MAP_DEPTH),
    // **The declaration arm alone**, so the fusion's net contribution is a paired subtraction on the same rows rather
    // than a comparison between two runs of two commits.
    declarationMap: averagePrecision(declarations, input.row.changed_files, MAP_DEPTH),
    declarationRank: firstRelevantRank(declarations.slice(0, MAP_DEPTH), input.row.changed_files),
    corpusBytes: size.bytes,
    corpusUnreadable: size.unreadable,
    checkoutBytes: walked.bytes,
    checkoutUnreadable: walked.unreadable,
    graphNodes,
    graphEdges,
    // **The cost is the supervisor's observation, not the child's opinion of itself**, and the orchestrator attaches it
    // after the process closes. A row written here cannot know what it will peak at later.
    cost: null,
    // **The controls are the parent's job, and that is a design decision rather than an omission.** A lexical control
    // has to run on the instances whose analysis is killed at the ceiling, so it cannot live in the process that gets
    // killed; the parent - which is the process that survives - computes both of them for every row it attempts,
    // measured or refused, and attaches them here. A row that arrived from the child carries `null` until it does.
    bm25: null,
    tfidf: null,
    // **The fallback, like the controls, is the parent's** - the process that survives the analysis is the only one that
    // can rank a checkout the analysis was killed on, and this rows' own instance is exactly such a checkout.
    fallback: null,
    // **And the fused ranking is transcribed by the parent on a measured row and built by it on a refused one**, which
    // is why it arrives as `null` here: a row does not know whether its own analysis survived it.
    fusion: null,
    skipped: null,
    fileArms,
    retrieval,
    map: averagePrecision(candidates, input.row.changed_files, MAP_DEPTH),
    answer: provider ? metricsOf(input.allFiles, input.row.changed_files, answered) : null,
  };
}
