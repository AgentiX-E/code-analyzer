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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { HybridSearchEngine } from '../search/hybrid-search.js';
import { expandToVector } from '../search/query-expansion.js';
import { rerankCandidates } from '../search/rerank.js';

import type { HybridSearchResult } from '../search/hybrid-search.js';
import type { GraphNode, PipelineContext } from '@code-analyzer/shared';

const CORPUS = 'packages/analyzer/src/languages';
const TOP_K = 20;
const TOP_5 = 5;
const MIN_DOCSTRING = 30;
/** **A bounded query set, because every query is paid for twice**: one completion to write it, one embedding to run it. */
const MAX_QUERIES = 100;
const VECTOR_WEIGHTS = [1, 0.5, 0.25, 0.1];
/** How many candidates a reranker sees. **A judgement task, not a reading task** - fifty fits one prompt. */
const RERANK_POOL = 50;

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
  it('does not count an answer below the cut as recall at the cut', () => {
    const column = summarise([
      { name: 'a', query: 'q', rank: 1 },
      { name: 'b', query: 'q', rank: TOP_K },
      { name: 'c', query: 'q', rank: TOP_K + 1 },
      { name: 'd', query: 'q', rank: 4_000 },
    ]);
    expect(column.recallAt5).toBe(0.25);
    // **Two of four, not four of four**: the answer at 21 and the answer at 4 000 are not in the top twenty.
    expect(column.recallAt20).toBe(0.5);
    expect(column.found).toBe(2);
  });

  it('gives a rank beyond the cut no weight in MRR, so lists of different depths are comparable', () => {
    const column = summarise([
      { name: 'a', query: 'q', rank: 2 },
      { name: 'b', query: 'q', rank: TOP_K + 1 },
    ]);
    expect(column.mrr).toBe(0.25);
  });

  it('matches an answer with the corpus root removed, so two machines agree', () => {
    // **The absolute path a runner hands out and the relative one the frozen set stores are the same answer**, and the
    // qualified name of a file-scoped symbol carries that absolute path inside it.
    const root = '/home/runner/work/code-analyzer/code-analyzer/packages/analyzer/src/languages';
    expect(
      answerKey(
        { filePath: `${root}/arkts.ts`, qualifiedName: `project:p:file:${root}/arkts.ts:walk` },
        root,
      ),
    ).toBe('arkts.ts::project:p:file:arkts.ts:walk');
    expect(answerKey({ filePath: null, qualifiedName: 'parse' }, root)).toBe('::parse');
  });
});

describe.skipIf(!HAS_VECTORS || (NEEDS_QUERY_AUTHOR && !CAN_WRITE_QUERIES))(
  'finding a symbol from a paraphrase, with its documentation removed',
  () => {
    it('measures lexical and fused recall on an index that holds no doc comments', async () => {
      // **The root the graph was built from, and the one both sides of every match are normalised against.**
      const corpusRoot = resolve(process.cwd(), CORPUS);
      const frozenKey = (candidate: FrozenQuery): string =>
        `${candidate.file}::${candidate.qualifiedName}`;

      const ctx = {
        projectId: 'paraphrase-search',
        rootPath: corpusRoot,
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
        // **A question about a symbol the corpus no longer has is a broken measurement, not a miss.** Silently scoring
        // it as a retrieval failure would turn a corpus edit into a regression of the retriever.
        const present = new Set([...stripped.values()].map((node) => answerKey(node, corpusRoot)));
        const unknown = paraphrases.filter((candidate) => !present.has(frozenKey(candidate)));
        expect(
          unknown.map((candidate) => frozenKey(candidate)),
          `${QUERY_SET} asks about symbols this corpus no longer contains; regenerate it`,
        ).toEqual([]);
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
      // Two candidate compositions, measured on the same ninety-nine questions.
      // -----------------------------------------------------------------------------------------------------------
      //
      // **A variant is worth measuring only if it shares everything but the thing it changes.** Both of these run on
      // the same stripped corpus, the same lexical lists and the same fusion weight (1); they differ in the text the
      // index vector is built from and, for the second, in the vector the query is searched with. **Neither is the
      // product default until its column beats the control**, which is why `embeddingText` takes the option instead of
      // shipping it.
      const variants: VariantColumn[] = [];

      // **One fused column, computed the same way as the sweep**: the lexical list cut at twenty, the semantic list
      // fused into it at the product's weight, the answer looked for inside the twenty.
      const fuse = (
        engine: HybridSearchEngine,
        lists: Array<Array<{ node: GraphNode; score: number }>>,
        vectorWeight: number,
      ): Column =>
        summarise(
          paraphrases.map((candidate, index) => {
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
          }),
        );

      if (queryEmbedder) {
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
        // **`rerank`**: the fused fifty, ordered by a model that can see all of them, then cut at twenty.
        //
        // **The pool is the ceiling, and it is published.** A reranker cannot answer a question whose symbol was not in
        // the fifty it was given, so a reader who sees recall@20 rise without seeing the pool would not know whether the
        // ordering did the work or a deeper candidate list did.
        if (CAN_WRITE_QUERIES) {
          const provider = new DeepSeekProvider({ timeout: 60_000 });
          const pool: HybridSearchResult[][] = [];
          for (let index = 0; index < paraphrases.length; index++) {
            const candidate = paraphrases[index]!;
            const semanticDeep = await hybrid.vectorSearch(candidate.query, RERANK_POOL, null);
            pool.push(
              hybrid.fuseResults(
                lexicalLists[index]!.slice(0, RERANK_POOL).map((hit) => ({
                  node: hit.node,
                  score: hit.score,
                })),
                semanticDeep.map((hit) => ({ node: hit.node, score: hit.score })),
                60,
                RERANK_POOL,
                1,
              ),
            );
          }

          const cases: QueryCase[] = [];
          let reranked = 0;
          let poolHits = 0;
          for (let index = 0; index < paraphrases.length; index++) {
            const candidate = paraphrases[index]!;
            const fused = pool[index]!;
            if (fused.some((hit) => answerKey(hit.node, corpusRoot) === frozenKey(candidate)))
              poolHits += 1;
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
              { timeout: 60_000 },
            );
            if (result.applied) reranked += 1;
            const rank = result.ordered
              .slice(0, TOP_K)
              .findIndex((entry) => answerKey(entry.hit.node, corpusRoot) === frozenKey(candidate));
            cases.push({ ...candidate, rank: rank >= 0 ? rank + 1 : null });
          }
          variants.push({
            name: 'rerank',
            note: `the fused top ${RERANK_POOL}, reordered by a model, cut at ${TOP_K}`,
            reranked,
            poolRecallAt20: Math.round((poolHits / paraphrases.length) * 10000) / 10000,
            ...summarise(cases),
          });
        } else {
          variants.push({
            name: 'rerank',
            note: `the fused top ${RERANK_POOL}, reordered by a model, cut at ${TOP_K}`,
            reason:
              'DEEPSEEK_API_KEY is absent, so no ordering can be asked for and this arm did not run',
          });
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
          '**Every column is measured at the same cut**: `recallAt20` counts answers inside the top 20, `mrr` gives a rank',
          'beyond 20 the value 0, and `found` is `found@20`. The lexical list is unbounded, so an arithmetic that counted',
          'any rank would have measured a longer list against a shorter one.',
          '',
          '**Both columns run on the same index**: BM25 over name/signature only, and the same list fused with one',
          'semantic ranking at each weight.',
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
            .map((v) => `${v.name}:@20=${v.recallAt20 ?? '-'}/mrr=${v.mrr ?? '-'}`)
            .join(' ')}`,
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
    }, 3_600_000);
  },
);
