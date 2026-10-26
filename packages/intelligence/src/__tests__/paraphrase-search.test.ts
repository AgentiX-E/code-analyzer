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

import { mkdirSync, writeFileSync } from 'node:fs';
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
import { describe, expect, it } from 'vitest';

import { DeepSeekProvider } from '../review/llm/provider.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

const CORPUS = 'packages/analyzer/src/languages';
const TOP_K = 20;
const TOP_5 = 5;
const MIN_DOCSTRING = 30;
/** **A bounded query set, because every query is paid for twice**: one completion to write it, one embedding to run it. */
const MAX_QUERIES = 100;
const VECTOR_WEIGHTS = [1, 0.5, 0.25, 0.1];

/**
 * **A measurement that needs two credentials is skipped where they are absent, not silently degraded.**
 *
 * `DEEPSEEK_API_KEY` writes the queries and `ZHIPU_API_KEY` embeds the index and the queries - without either, this file
 * would be measuring the hash fallback against questions it generated itself. `describe.skipIf` reports `skipped`,
 * which is true; an early `return` inside the case would report `passed` for a measurement that never happened.
 */
const HAS_CREDENTIALS = Boolean(process.env['DEEPSEEK_API_KEY'] && process.env['ZHIPU_API_KEY']);

interface QueryCase {
  name: string;
  query: string;
  rank: number | null;
}

interface Column {
  recallAt5: number;
  recallAt20: number;
  mrr: number;
  found: number;
}

/**
 * Recall at two cuts plus MRR.
 *
 * **The same arithmetic as `docstring-search.test.ts`, written twice on purpose**: a shared module inside `src/` would
 * be counted by the per-file coverage gate, and its only caller is a test that is *skipped* wherever the credentials
 * are absent - so the module would report 0 % on every run that did not measure anything, and the gate would fail for
 * the honest reason. Ten lines of arithmetic are cheaper than a file that has to be excluded from the gate.
 */
function summarise(cases: QueryCase[]): Column {
  const found = cases.filter((c) => c.rank !== null).length;
  const at5 = cases.filter((c) => c.rank !== null && c.rank <= TOP_5).length;
  const round = (value: number): number => Math.round(value * 10000) / 10000;
  return {
    recallAt5: round(at5 / cases.length),
    recallAt20: round(found / cases.length),
    mrr: round(cases.reduce((sum, c) => sum + (c.rank ? 1 / c.rank : 0), 0) / cases.length),
    found,
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

describe.skipIf(!HAS_CREDENTIALS)(
  'finding a symbol from a paraphrase, with its documentation removed',
  () => {
    it('measures lexical and fused recall on an index that holds no doc comments', async () => {
      const ctx = {
        projectId: 'paraphrase-search',
        rootPath: resolve(process.cwd(), CORPUS),
        config: getDefaultConfig(),
        signal: new AbortController().signal,
        metadata: {},
      } as unknown as PipelineContext;

      const pipeline = await new PipelineOrchestrator(createAllPhases()).execute(ctx);
      expect(pipeline.errors.map((e) => e.phaseId).filter((id) => id !== 'tools')).toEqual([]);

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

      // **The queries come from the doc comments of the *original* graph** - the documentation is the source of the
      // question even though it is not in the index.
      const documented = [...pipeline.graph.nodes.values()]
        .filter((node) => (node.docstring ?? '').trim().length >= MIN_DOCSTRING)
        .filter((node) => typeof node.name === 'string' && node.name.length > 2)
        .sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
      const step = Math.max(1, Math.floor(documented.length / MAX_QUERIES));
      const sampled = documented.filter((_, index) => index % step === 0).slice(0, MAX_QUERIES);

      const provider = new DeepSeekProvider({ timeout: 30_000 });
      const paraphrases: Array<{ name: string; query: string }> = [];
      let dropped = 0;
      let overlap = 0;
      for (const node of sampled) {
        const completion = await provider.complete(
          paraphrasePrompt((node.docstring ?? '').trim().slice(0, 1_000)),
          { maxTokens: 80, temperature: 0 },
        );
        const query = cleanCompletion(completion.content);
        // **A question that names the symbol is the lookup this file exists to replace**, so it is dropped rather than
        // counted as a win for either column.
        if (query.length < 10 || namesTheSymbol(query, node.name)) {
          dropped += 1;
          continue;
        }
        // **Counted, not discarded** - see `namesTheSymbol`.
        if (sharedTokens(query, node.name) > 0) overlap += 1;
        paraphrases.push({ name: node.name, query });
      }

      // **A measurement with no queries is not a passing measurement**, and here it is also the signal that the model
      // stopped obeying the prompt - which is a fact worth failing on rather than publishing as a recall of zero.
      expect(paraphrases.length).toBeGreaterThanOrEqual(20);

      const lexicalLists = paraphrases.map((candidate) =>
        lexicalEngine.bm25Search(candidate.query),
      );
      const lexical: QueryCase[] = paraphrases.map((candidate, index) => {
        const rank = lexicalLists[index]!.findIndex((hit) => hit.node.name === candidate.name);
        return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
      });

      const semanticLists: Array<Array<{ node: GraphNode; score: number }>> = [];
      if (queryEmbedder) {
        for (const candidate of paraphrases) {
          const ranked = await hybrid.vectorSearch(candidate.query, TOP_K, null);
          semanticLists.push(ranked);
        }
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
          const rank = fused.findIndex((hit) => hit.node?.name === candidate.name);
          return { ...candidate, rank: rank >= 0 ? rank + 1 : null };
        });
        return { vectorWeight, ...summarise(cases) };
      });

      const lexicalColumn = summarise(lexical);
      const semantic = backend !== 'deterministic' && queryEmbedder !== null;

      const artifact = {
        comment: [
          'Recall at top-k for a symbol queried by a paraphrase of its documentation, with **no doc comment in the index**.',
          '',
          '**The doc comment is the query and not part of the document**, which is what makes this different from',
          '`docstring-search.json`: there the retriever can copy the words it is asked about, and every column comes out',
          'at the same 1.000 for that reason.',
          '',
          '**The questions are written by DeepSeek from the documentation**, with a rule against using the symbol name,',
          'and a generated question that still contains one is dropped and counted in `dropped`.',
          '',
          '**Both columns are measured on the same index**: BM25 over name/signature only, and the same list fused with',
          'one semantic ranking at each weight.',
        ],
        measuredAt: new Date().toISOString().slice(0, 10),
        corpus: {
          path: CORPUS,
          nodes: stripped.size,
          documented: documented.length,
          sampled: sampled.length,
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

      mkdirSync(resolve(process.cwd(), 'benchmarks'), { recursive: true });
      writeFileSync(
        resolve(process.cwd(), 'benchmarks/paraphrase-search.json'),
        JSON.stringify(artifact, null, 2) + '\n',
        'utf8',
      );
      await queryEmbedder?.dispose().catch(() => undefined);

      // The summary line **is** the interface: the workflow greps it into the job summary.
      // eslint-disable-next-line no-console
      console.log(
        `PARAPHRASE-SEARCH queries=${paraphrases.length} dropped=${dropped} space=${backend}/${queryEmbedder?.backend ?? 'none'} ` +
          `lexical@5=${lexicalColumn.recallAt5} @20=${lexicalColumn.recallAt20} mrr=${lexicalColumn.mrr} ` +
          `sweep=${sweep.map((s) => `${s.vectorWeight}:@20=${s.recallAt20}/mrr=${s.mrr}`).join(' ')}`,
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
    }, 3_600_000);
  },
);
