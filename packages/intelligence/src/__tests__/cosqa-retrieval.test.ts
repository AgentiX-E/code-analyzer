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
import { recordArtifact } from '@code-analyzer/shared';
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
const CUTS = 'recall@1, @5, @10; MRR@10';
const RERANK_POOL = 50;

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
          lexical: score(lexicalRanks),
          fused: score(fusedRanks),
          ...(provider
            ? { reranked: { ...score(rerankedRanks), reordered: reranked } }
            : {
                reranked: { reason: 'DEEPSEEK_API_KEY is absent, so nothing could be reordered' },
              }),
        };

        const recorded = recordArtifact('benchmarks/cosqa-retrieval.json', artifact);
        // eslint-disable-next-line no-console -- the artifact's fate, printed where the workflow reads it.
        if (!recorded.written) console.log(`COSQA-RETRIEVAL artifact ${recorded.because}`);
        await queryEmbedder?.dispose().catch(() => undefined);

        // The summary line **is** the interface: the workflow greps it into the job summary.
        // eslint-disable-next-line no-console
        console.log(
          `COSQA-RETRIEVAL queries=${rows.length} pool=${rows.length + distractors} (${POOL}) space=${backend}/${queryEmbedder?.backend ?? 'none'} ` +
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
