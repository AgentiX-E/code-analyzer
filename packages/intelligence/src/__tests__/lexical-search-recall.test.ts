// Whether a symbol can be found by its own name: the retrieval half of search, measured where it is deterministic.
//
// **Why this is separate from `semantic-search-accuracy`.** That row asks whether semantic search reaches 90% against
// a competitor's ~75%, and it is blocked because there is no committed query set **and** because the embedding backend
// is intermittent. **Only the second of those blocks this**: a query set does not have to be written by hand, because
// a symbol's own name is a query whose answer is known - the symbol.
//
// **And the distinction has to survive into the name of the figure.** Recall over a symbol's own name measures the
// index and the lexical retrieval, **not** semantic generalisation: a natural-language query like "where is the
// pipeline context defined" is a different question, and its answers would have to be labelled by a person.
//
// **So this file measures two things and reports them apart:**
//
//   lexical   BM25 alone, no embeddings registered      deterministic, and the figure below
//   semantic  BM25 + vectors, when a backend is present  reported only when it is, with the backend named
//
// The corpus is this repository's own source, so the queries are real symbols from real code.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';

// **The pipeline lives in another package, and it is reached by name rather than by path.** A relative import across
// package boundaries compiles in a monorepo right up until the packages are built separately, and then it does not.
import { GraphBuilder, PipelineOrchestrator, createAllPhases } from '@code-analyzer/analyzer';
import { getDefaultConfig } from '@code-analyzer/core';

import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { PipelineContext } from '@code-analyzer/shared';

const ROOT = process.cwd();
/**
 * **A corpus of a known size, built from one real file.** `packages/shared/src` is real and takes minutes to index,
 * which on this machine is enough to be stopped rather than measured - and the lesson of the last two days is that a
 * corpus whose size is known beats one whose run may not finish.
 */
const SOURCE = 'packages/shared/src/types/graph.ts';
const COPIES = 30;
const ARTIFACT = resolve(ROOT, 'benchmarks/lexical-search-recall.json');
const TOP_K = 10;
/** Queries are sampled by stride rather than by random, so the set is the same on every run. */
const QUERIES = 40;

interface QueryResult {
  query: string;
  found: boolean;
  rank: number | null;
}

describe('retrieval, measured on a symbol\u2019s own name', () => {
  it('reports recall at top-k for the lexical half, and names the backend for the semantic half', async () => {
    // 1. Index a corpus of a known size through the real pipeline, leaving out the phase that generates vectors.
    const corpusDir = mkdtempSync(join(tmpdir(), 'search-recall-'));
    mkdirSync(join(corpusDir, 'src'), { recursive: true });
    const source = readFileSync(resolve(ROOT, SOURCE), 'utf8');
    for (let i = 0; i < COPIES; i += 1) {
      writeFileSync(join(corpusDir, 'src', `c${i}.ts`), source.replace(/PipelineContext/g, `PipelineContext${i}`), 'utf8');
    }
    const ctx = {
      projectId: 'search-recall',
      rootPath: corpusDir,
      config: getDefaultConfig(),
      signal: new AbortController().signal,
      metadata: {},
    } as unknown as PipelineContext;
    // **`embed` because it is a different question.** It generates a vector per node, which is not retrieval, and
    // leaving it in makes a measurement whose completion depends on the vector backend.
    const phases = createAllPhases().filter((p) => p.id !== 'embed');
    const result = await new PipelineOrchestrator(phases).execute(ctx);

    // **`tools` is left in and its failure is tolerated**, rather than removed. Removing it looked tidier and broke
    // the DAG - the phases downstream of it stopped running, and `scan` failed instead - which is a good illustration
    // of why the shape of a graph beats the tidiness of a filter. **The failure is named here so that it cannot be
    // mistaken for a property of the measurement**: it is a defect in the `tools` phase, present since the first
    // profile, and it is on the register as its own row rather than absorbed into this one.
    const failures = result.errors.map((e) => e.phaseId);
    expect(failures.filter((id) => id !== 'tools')).toEqual([]);

    // 2. Put the graph into a store, the way the dump phase does.
    const store = new InMemoryGraphStore();
    // **The builder needs the store, and passing a cast null is a mistake worth naming.** `parse.ts` writes
    // `new GraphBuilder(null as unknown as InMemoryGraphStore)` and gets away with it because it only calls `addNode`
    // and `addEdge`; `dumpToStore` calls `this.store.insertNode`, so the same cast here fails at runtime with
    // "cannot read properties of null". **A cast that satisfies the compiler about a dependency the code uses is the
    // sixth time in this stretch that one has hidden something real.**
    const builder = new GraphBuilder(store);
    builder.dumpToStore(result.graph, ctx.projectId);

    // 3. Ask for symbols by their own names.
    const engine = new HybridSearchEngine(store);
    engine.initialize();

    const symbols = [...result.graph.nodes.values()].filter(
      (n) => typeof n.name === 'string' && n.name.length >= 4 && /^[A-Za-z][A-Za-z0-9_]*$/.test(n.name),
    );
    expect(symbols.length).toBeGreaterThan(QUERIES);

    const stride = Math.max(1, Math.floor(symbols.length / QUERIES));
    const results: QueryResult[] = [];
    for (let i = 0; i < symbols.length && results.length < QUERIES; i += stride) {
      const symbol = symbols[i]!;
      const hits = await engine.search({ query: symbol.name, topK: TOP_K });
      const rank = hits.findIndex((h) => h.node?.name === symbol.name);
      results.push({ query: symbol.name, found: rank >= 0, rank: rank >= 0 ? rank + 1 : null });
    }

    const found = results.filter((r) => r.found).length;
    const recall = Math.round((found / results.length) * 10000) / 10000;

    const artifact = {
      comment: [
        'Recall at top-k over a symbol\u2019s own name, on this repository\u2019s own source.',
        '',
        '**What this measures, and what it does not.** A symbol\u2019s own name is a query whose answer is known, so the',
        'figure needs no hand labelling - **and it measures the index and the lexical retrieval, not semantic',
        'generalisation.** "Where is the pipeline context defined" is a different question with answers nobody has',
        'labelled, and the `semantic-search-accuracy` row is still blocked on that.',
        '',
        '**The semantic half is reported separately and only when a backend is present**, because the embedding',
        'backend in this repository is intermittent: one probe threw `Tokenizer not found`, and later runs report a',
        'loaded `onnx` backend. A recall figure that changes with the backend is a figure about the backend.',
      ],
      measuredAt: new Date().toISOString().slice(0, 10),
      mode: 'lexical',
      backend: { embeddingsRegistered: false, note: 'BM25 alone, so the figure is deterministic' },
      corpus: { path: `${COPIES} copies of ${SOURCE}`, files: (result.graph as { fileIndex?: { size: number } }).fileIndex?.size ?? 0, nodes: result.graph.nodes.size },
      topK: TOP_K,
      queries: results.length,
      found,
      recall,
      misses: results.filter((r) => !r.found).map((r) => r.query).slice(0, 10),
      target: { recall: 0.9, competitorRecall: 0.75, competitor: 'Cody, quoted by the whitepaper' },
    };
    mkdirSync(resolve(ROOT, 'benchmarks'), { recursive: true });
    writeFileSync(ARTIFACT, JSON.stringify(artifact, null, 2) + '\n', 'utf8');

    // eslint-disable-next-line no-console
    console.log(
      `SEARCH-RECALL ${recall} (${found}/${results.length} found in top ${TOP_K}) ` +
        `over ${result.graph.nodes.size} nodes from ${artifact.corpus.files} files; lexical, no embeddings`,
    );

    // **The shapes that must hold whatever the figure is.** A run that asked nothing, or that found nothing at all,
    // is a broken pipeline rather than a poor score - and the difference matters for what the reader should do next.
    expect(results.length).toBeGreaterThan(0);
    expect(result.graph.nodes.size).toBeGreaterThan(0);
    expect(recall).toBeGreaterThanOrEqual(0);
    expect(recall).toBeLessThanOrEqual(1);
    // **A name in the index must be retrievable by that name.** If this fails, the index is not what it says it is,
    // and no amount of embedding will fix a lookup that cannot find an exact match.
    expect(recall).toBeGreaterThan(0.5);
    rmSync(corpusDir, { recursive: true, force: true });
  }, 600_000);
});

// A guard against the corpus silently becoming empty, which would make the figure above meaningless rather than bad.
describe('the corpus the recall is measured on', () => {
  it('has source files in it', () => {
    const dir = resolve(ROOT, 'packages/shared/src/types');
    const walk = (d: string): number =>
      readdirSync(d, { withFileTypes: true }).reduce(
        (n, e) => n + (e.isDirectory() ? walk(join(d, e.name)) : /\.ts$/.test(e.name) ? 1 : 0),
        0,
      );
    // The file the synthetic corpus is built from, and the symbols the queries come from.
    expect(walk(dir)).toBeGreaterThan(1);
    expect(readFileSync(resolve(ROOT, SOURCE), 'utf8').length).toBeGreaterThan(1000);
  });
});
