// A vector space either orders things or it does not, and the product may not fuse the second kind.
//
// **The defect.** With no embedding model and no API key - a fresh install, and every machine that runs this repository's
// tests - the embed phase writes a **hash of each text** and labels the space `deterministic`. The MCP search then built a
// hash embedder for the query, scored every node by cosine, and fused that list with the index at equal weight. Two
// hashes of two different texts are two unrelated directions from a linear congruential generator, so that list was a
// draw; the fusion treated it as an equal authority, and `search_code` reported `hybrid (BM25 + vector)` on every item.
//
// **Why a fixture was not enough to see it.** A four-file checkout is small enough for a random order to look like a
// judgement: on the acceptance fixture in `issue-to-ranked-files.test.ts` the fixing file scored 37.61 against a
// next-best 4.98 and landed seventh behind a one-line README. One fixture cannot say how much that costs. **This file
// measures it on the corpus and questions this repository already froze** - `benchmarks/retrieval-corpus` (the tree
// ninety-nine questions were written from) and `benchmarks/paraphrase-queries.json` - so the two columns differ in the
// fusion rule and in nothing else.
//
// **The three columns, and what each one is:**
//
//   * `lexical` - the index alone, which is what the product answers with after the fix;
//   * `hashFused` - the index fused with the hash ranking at equal weight, which is what it answered with before;
//   * `product` - the same questions asked through `search_code`, the tool a user calls.
//
// The assertion that matters is not a mean: it is that `product` and `lexical` are **the same list, path for path**. A
// product that fuses nothing cannot drift towards the arm it removed, and a future change that reintroduces one has to
// break this equality to pass.
//
// **No credential is used, and that is the point of the corpus.** The hash space exists on every machine, so this
// measurement runs everywhere, reproducibly, and the figures it publishes are comparable across commits. The semantic
// half that *does* rank is measured against the real endpoint by `paraphrase-search.test.ts`, which is a different
// question with a different artifact.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PipelineOrchestrator,
  createAllPhases,
  createQueryEmbedder,
  embeddingText,
} from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { HybridSearchEngine, reciprocalRankFusion } from '@code-analyzer/intelligence';
import { ToolContextImpl, createToolRegistry } from '@code-analyzer/mcp';
import { recordArtifact } from '@code-analyzer/shared';
import { beforeAll, describe, expect, it } from 'vitest';

import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

const CORPUS = 'benchmarks/retrieval-corpus';
const QUERY_SET = 'benchmarks/paraphrase-queries.json';
const ARTIFACT = 'benchmarks/hash-space-fusion.json';
/** The cut every published column in this project is measured at. */
const TOP_K = 20;
const TOP_5 = 5;
/**
 * The deepest answer `search_code` can give, and therefore the depth both columns are cut to.
 *
 * **`searchCode` caps `limit` at 100** (`maxLimit`), so asking it for two hundred returns a hundred and comparing that
 * with a two-hundred-long control compares two different questions. Read from the tool rather than assumed: the first
 * version of this file asked for 200 and reported all ninety-nine questions as mismatched.
 */
const PRODUCT_DEPTH = 100;

interface FrozenQuery {
  file: string;
  qualifiedName: string;
  name: string;
  query: string;
}

/** One list's column, on the same questions and the same cut. */
interface Column {
  recallAt5: number;
  recallAt20: number;
  mrr: number;
  found: number;
}

interface Measured {
  corpusRoot: string;
  store: InMemoryGraphStore;
  frozen: FrozenQuery[];
  vectors: Map<number, Float32Array>;
}

function stripRoot(rootPath: string, value: string): string {
  const root = resolve(rootPath);
  return value.split(`${root}/`).join('').split(`${root}\\`).join('');
}

/** **The key the answer is matched on**, identical to the one the paraphrase measurement uses: file and name, because
 * the corpus reuses both alone. */
function answerKey(
  node: { filePath?: string | null; qualifiedName: string },
  rootPath: string,
): string {
  return `${stripRoot(rootPath, node.filePath ?? '')}::${stripRoot(rootPath, node.qualifiedName)}`;
}

/** The column of one ranking, cut at the same place for every arm. */
function columnOf(ranks: ReadonlyArray<number | null>): Column {
  const found = ranks.filter((rank) => rank !== null && rank <= TOP_K).length;
  const at5 = ranks.filter((rank) => rank !== null && rank <= TOP_5).length;
  const mrr = ranks.reduce<number>(
    (sum, rank) => sum + (rank === null || rank > TOP_K ? 0 : 1 / rank),
    0,
  );
  const size = Math.max(1, ranks.length);
  return {
    recallAt5: Number((at5 / size).toFixed(4)),
    recallAt20: Number((found / size).toFixed(4)),
    mrr: Number((mrr / size).toFixed(4)),
    found,
  };
}

/** Where `want` sits in a list of nodes, one-based, or `null` when it is absent. */
function rankOf(
  list: ReadonlyArray<{ node: GraphNode }>,
  want: string,
  rootPath: string,
): number | null {
  const index = list.findIndex((hit) => answerKey(hit.node, rootPath) === want);
  return index < 0 ? null : index + 1;
}

let measured: Measured | null = null;

/**
 * The pinned corpus, analysed once, with the doc comments stripped and a hash vector per symbol.
 *
 * **The doc comments are stripped for the reason the paraphrase measurement strips them**: a question that copies the
 * answer's documentation measures copying rather than retrieval. **The vectors are the hash space**, produced by the
 * same `createQueryEmbedder('deterministic')` the product uses when no model is present - not a stand-in for a model.
 */
async function measure(): Promise<Measured> {
  if (measured !== null) return measured;
  const corpusRoot = resolve(process.cwd(), CORPUS);
  const ctx = {
    projectId: 'paraphrase-search',
    rootPath: corpusRoot,
    config: getDefaultConfig(),
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
  const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);

  const store = new InMemoryGraphStore();
  for (const node of pipeline.graph.nodes.values() as Iterable<GraphNode>) {
    const {
      embedding: _embedding,
      embeddingBackend: _backend,
      ...rest
    } = (node.properties ?? {}) as Record<string, unknown>;
    store.insertNode({ ...node, docstring: null, properties: rest });
  }

  const embedder = await createQueryEmbedder('deterministic');
  const vectors = new Map<number, Float32Array>();
  for (const node of store.getAllNodes()) {
    if (node.label === 'File' || node.label === 'Folder' || node.label === 'Project') continue;
    if (!node.name) continue;
    vectors.set(node.id, await embedder!.embed(embeddingText(node, { rootPath: corpusRoot })));
  }

  const frozen = (JSON.parse(readFileSync(QUERY_SET, 'utf8')) as { queries: FrozenQuery[] })
    .queries;
  measured = { corpusRoot, store, frozen, vectors };
  return measured;
}

beforeAll(async () => {
  await measure();
}, 600_000);

describe('a hash space does not rank, and the product does not fuse it', () => {
  it('answers with the index alone, and never with the hash ranking', async () => {
    const { corpusRoot, store, frozen } = await measure();
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const registry = createToolRegistry();
    const context = new ToolContextImpl(store);
    const lexical: Array<number | null> = [];
    const product: Array<number | null> = [];
    const mismatched: string[] = [];

    for (const query of frozen) {
      const want = `${query.file}::${query.qualifiedName}`;
      // **Both lists are cut to the depth the tool was asked for**, because a ranking over a prefix is a ranking and
      // comparing a two-hundred-entry answer with a three-thousand-entry control would be comparing two questions.
      const lexicalList = engine.bm25Search(query.query).slice(0, PRODUCT_DEPTH);
      lexical.push(rankOf(lexicalList, want, corpusRoot));

      const result = await registry.execute(
        'search_code',
        { query: query.query, projectId: 'paraphrase-search', limit: PRODUCT_DEPTH },
        context,
      );
      const payload = JSON.parse((result.content[0] as { text: string }).text) as {
        items?: Array<{ filePath?: string; qualifiedName?: string }>;
      };
      const productList = (payload.items ?? []).map((item) => ({
        node: {
          filePath: item.filePath ?? null,
          qualifiedName: item.qualifiedName ?? '',
        } as GraphNode,
      }));
      product.push(rankOf(productList, want, corpusRoot));

      // **The equality is the assertion**: not a mean that happens to be close, but the same order on every question.
      const lexicalKeys = lexicalList.map((hit) => answerKey(hit.node, corpusRoot));
      const productKeys = productList.map((hit) => answerKey(hit.node, corpusRoot));
      if (lexicalKeys.join('\n') !== productKeys.join('\n')) mismatched.push(query.qualifiedName);
    }

    expect(mismatched).toEqual([]);

    const lexicalColumn = columnOf(lexical);
    const productColumn = columnOf(product);
    expect(productColumn).toEqual(lexicalColumn);

    // **The ratchet**, so this path may not quietly lose questions: the same floors the paraphrase measurement holds
    // its lexical column to.
    expect(productColumn.recallAt20).toBeGreaterThanOrEqual(0.45);
    expect(productColumn.recallAt5).toBeGreaterThanOrEqual(0.3);
    expect(productColumn.mrr).toBeGreaterThanOrEqual(0.19);
  }, 600_000);

  it('measures what fusing the hash ranking cost, so the removal is a figure and not an opinion', async () => {
    const { corpusRoot, store, frozen, vectors } = await measure();
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const embedder = await createQueryEmbedder('deterministic');
    engine.registerEmbeddings(
      (nodeId) => vectors.get(nodeId) ?? null,
      (text: string) => embedder!.embed(text),
    );

    const lexical: Array<number | null> = [];
    const fused: Array<number | null> = [];
    let better = 0;
    let worse = 0;

    for (const query of frozen) {
      const want = `${query.file}::${query.qualifiedName}`;
      const lexicalList = engine.bm25Search(query.query);
      const vectorList = await engine.vectorSearch(query.query, 200);
      const fusedList = reciprocalRankFusion(
        [
          {
            name: 'declarations',
            ranked: lexicalList.map((hit) => answerKey(hit.node, corpusRoot)),
          },
          {
            name: 'hash-vectors',
            ranked: vectorList.map((hit) => answerKey(hit.node, corpusRoot)),
          },
        ],
        { k: 60, limit: 200 },
      );
      const fusedRanks = fusedList.ranked;
      const lexicalRank = rankOf(lexicalList, want, corpusRoot);
      const fusedRank = fusedRanks.indexOf(want) < 0 ? null : fusedRanks.indexOf(want) + 1;
      lexical.push(lexicalRank);
      fused.push(fusedRank);
      if (lexicalRank !== null && fusedRank !== null) {
        if (fusedRank < lexicalRank) better += 1;
        if (fusedRank > lexicalRank) worse += 1;
      }
    }

    const lexicalColumn = columnOf(lexical);
    const fusedColumn = columnOf(fused);

    // **The direction, asserted rather than described**: a fusion that cannot rank must not be able to help, and on this
    // corpus it does not. If a future change made a hash space useful, this case would say so instead of hiding it.
    expect(fusedColumn.recallAt20).toBeLessThan(lexicalColumn.recallAt20);
    expect(fusedColumn.mrr).toBeLessThan(lexicalColumn.mrr);
    expect(worse).toBeGreaterThan(better);

    const record = recordArtifact(ARTIFACT, {
      comment: [
        'What fusing a hash space with the index cost, on the pinned corpus and the frozen questions.',
        '',
        '**The two columns differ in the fusion rule and in nothing else**: same corpus, same ninety-nine questions,',
        'same index, same hash vectors, same cut. `lexical` is the index alone - what the product answers with after',
        'the fix - and `hashFused` is the index fused at equal weight with the cosine ranking of the hash vectors,',
        'which is what it answered with before.',
        '',
        '**No credential is used.** The hash space is what the embed phase writes when no model is present, so this',
        'measurement runs on every machine and is comparable across commits. The semantic half that *does* rank is a',
        'different question, measured against the real endpoint in `paraphrase-search.json`.',
        '',
        '**The rule the product now enforces**: `hasSimilaritySpace(backend)` is true only for `onnx` and `api`, and a',
        'space for which it is false contributes neither candidates nor scores nor an embedder. `tests/e2e/',
        'issue-to-ranked-files.test.ts` is the user-facing case; this file is the measurement behind it.',
      ],
      measuredAt: new Date().toISOString().slice(0, 10),
      where: 'local-vitest',
      corpus: { path: CORPUS, questions: QUERY_SET, size: frozen.length },
      space: {
        backend: 'deterministic',
        // **`semantic: false` is the claim**, and the artifact recorder uses it to refuse a lexical figure over a
        // semantic one: this file may never replace a measurement that had a model behind it.
        semantic: false,
        reason: 'the vectors are a hash of each text, so a cosine between two of them is a draw',
      },
      topK: TOP_K,
      lexical: lexicalColumn,
      hashFused: fusedColumn,
      paired: {
        questions: frozen.length,
        fusedBetter: better,
        fusedWorse: worse,
        deltaRecallAt20: Number((fusedColumn.recallAt20 - lexicalColumn.recallAt20).toFixed(4)),
        deltaMrr: Number((fusedColumn.mrr - lexicalColumn.mrr).toFixed(4)),
      },
    });
    // eslint-disable-next-line no-console -- the workflow reads this line into the job summary.
    console.log(
      `HASH-SPACE-FUSION lexical@20=${lexicalColumn.recallAt20} mrr=${lexicalColumn.mrr} ` +
        `fused@20=${fusedColumn.recallAt20} mrr=${fusedColumn.mrr} better=${better} worse=${worse} ` +
        `artifact=${record.written ? 'written' : record.because}`,
    );
  }, 600_000);
});
