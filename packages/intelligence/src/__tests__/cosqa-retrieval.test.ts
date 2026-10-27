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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { describe, expect, it } from 'vitest';

import { DeepSeekProvider } from '../review/llm/provider.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';
import { rerankCandidates } from '../search/rerank.js';

import type { HybridSearchResult } from '../search/hybrid-search.js';
import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

/** Where the workflow put the two files. **Unset means this file did not measure anything**, and says so by skipping. */
const DATASET_DIR = process.env['COSQA_DIR'];
const HAS_VECTORS = Boolean(process.env['ZHIPU_API_KEY']);
const CAN_ASK_A_MODEL = Boolean(process.env['DEEPSEEK_API_KEY']);
/** The cuts the literature reports. **MRR is cut at ten**, as published. */
const CUTS = [1, 5, 10] as const;
const RERANK_POOL = 50;

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
function score(ranks: Array<number | null>): Metrics {
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
      const workdir = join(tmpdir(), `cosqa-${process.pid}-${Date.now()}`);
      mkdirSync(workdir, { recursive: true });
      // **The answer of row i is the file `code_<i>.py`**, which is how a retrieved node is traced back to a question.
      rows.forEach((row, index) => {
        writeFileSync(join(workdir, `code_${String(index).padStart(3, '0')}.py`), row.code, 'utf8');
      });

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
        const fusedRanks: Array<number | null> = [];
        const rerankedRanks: Array<number | null> = [];
        const provider = CAN_ASK_A_MODEL ? new DeepSeekProvider({ timeout: 60_000 }) : null;
        let reranked = 0;

        for (let index = 0; index < rows.length; index++) {
          const row = rows[index]!;

          const lexicalHits = lexicalEngine.bm25Search(row.doc);
          const lexicalRank = lexicalHits.findIndex((hit) => fileIndex(hit) === index);
          lexicalRanks.push(lexicalRank >= 0 ? lexicalRank + 1 : null);

          const fused: HybridSearchResult[] = hybrid.fuseResults(
            lexicalHits.slice(0, RERANK_POOL).map((hit) => ({ node: hit.node, score: hit.score })),
            (await hybrid.vectorSearch(row.doc, RERANK_POOL, null)).map((hit) => ({
              node: hit.node,
              score: hit.score,
            })),
            60,
            RERANK_POOL,
            1,
          );
          const fusedRank = fused.findIndex((hit) => fileIndex(hit) === index);
          fusedRanks.push(fusedRank >= 0 ? fusedRank + 1 : null);

          if (provider) {
            const entries = fused.map((hit, position) => ({ rank: position + 1, hit }));
            const result = await rerankCandidates(
              row.doc,
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
            if (result.applied) reranked += 1;
            // **The rank the answer lands at after the reorder**: `indexOf` inside the ordered list, not its fused rank.
            const rerankedIndex = result.ordered.findIndex(
              (entry) => fileIndex(entry.hit) === index,
            );
            rerankedRanks.push(rerankedIndex >= 0 ? rerankedIndex + 1 : null);
          }
        }

        const artifact = {
          comment: [
            'Retrieval on **CoSQA** (Huang et al.), the corpus the code-search literature reports on.',
            '',
            '**The pool is the 500 functions of the test split, not the full training corpus**, so these numbers are not',
            'directly comparable with published tables that retrieve from ~20 000 functions. The pool size is in this',
            'artifact so a reader can see exactly what was measured.',
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
          },
          measuredAt: new Date().toISOString().slice(0, 10),
          pool: { functions: rows.length, docstrings: 'stripped' },
          space: {
            index: backend,
            query: queryEmbedder?.backend ?? 'none',
            reason: reason ?? null,
          },
          cuts: CUTS,
          lexical: score(lexicalRanks),
          fused: score(fusedRanks),
          ...(provider
            ? { reranked: { ...score(rerankedRanks), reordered: reranked } }
            : {
                reranked: { reason: 'DEEPSEEK_API_KEY is absent, so nothing could be reordered' },
              }),
        };

        mkdirSync(resolve(process.cwd(), 'benchmarks'), { recursive: true });
        writeFileSync(
          resolve(process.cwd(), 'benchmarks/cosqa-retrieval.json'),
          JSON.stringify(artifact, null, 2) + '\n',
          'utf8',
        );
        await queryEmbedder?.dispose().catch(() => undefined);

        // The summary line **is** the interface: the workflow greps it into the job summary.
        // eslint-disable-next-line no-console
        console.log(
          `COSQA-RETRIEVAL queries=${rows.length} pool=${rows.length} space=${backend}/${queryEmbedder?.backend ?? 'none'} ` +
            `lexical=R@1 ${score(lexicalRanks).recallAt1}/R@10 ${score(lexicalRanks).recallAt10}/MRR ${score(lexicalRanks).mrrAt10} ` +
            `fused=R@1 ${score(fusedRanks).recallAt1}/R@10 ${score(fusedRanks).recallAt10}/MRR ${score(fusedRanks).mrrAt10} ` +
            (provider
              ? `rerank=R@1 ${score(rerankedRanks).recallAt1}/R@10 ${score(rerankedRanks).recallAt10}/MRR ${score(rerankedRanks).mrrAt10}`
              : 'rerank=none'),
        );

        // **The only claim this file can make without a comparison**: the product finds the answer at all, and the
        // semantic half is not worse than the lexical one on a corpus neither of them was tuned on.
        expect(score(lexicalRanks).recallAt10).toBeGreaterThan(0);
        expect(score(fusedRanks).recallAt10).toBeGreaterThanOrEqual(score(lexicalRanks).recallAt10);
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    }, 5_400_000);
  },
);
