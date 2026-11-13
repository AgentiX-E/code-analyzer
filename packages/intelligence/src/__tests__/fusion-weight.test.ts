// **A weight the question chooses, not the engine.**
//
// `docstring-search.test.ts` and `cosqa-retrieval.test.ts` sweep the same fusion weight and disagree by about five
// points in opposite directions: a symbol looked up from its own doc comment wants the lexical list to dominate
// (MRR 0.9119 at weight 1 against 0.9636 at 0.1) and a paraphrase asks for the semantic one to (found@10 322 at weight
// 1 against 347 at 4). **One constant can only be wrong for one of them**, so the constant has to be replaced by an
// observation about the query in hand.
//
// The observation is `selfEvidence`: **the share of the question's own terms that the lexical channel's best answer
// carries in its indexed fields.** A question the code's documentation already answers scores near one - the document
// contains the question. A question the index cannot spell scores near zero, and a lexical list built from it is a
// guess wearing a rank. Measured on the two corpora (500 CoSQA questions, 219 doc-comment queries, local, no model):
// median 0.250 against 1.000, and a single threshold separates the two sets with **98.6 %** accuracy.
//
// **This file tests the arithmetic and the wiring separately**, because the arithmetic is a claim about ranks and the
// wiring is a claim about what the product actually runs.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { retrieveContext } from '../qa/ask.js';
import {
  FUSION_WEIGHT_BOUNDS,
  SELF_EVIDENCE_CONFIDENT,
  SELF_EVIDENCE_GUESSING,
  deriveVectorWeight,
  selfEvidence,
} from '../search/fusion-weight.js';
import { HybridSearchEngine } from '../search/hybrid-search.js';

import type { RankedResult } from '../search/hybrid-search.js';
import type { GraphNode } from '@code-analyzer/shared';

/** The minimum a node has to carry to be scored: **the three indexable fields this arithmetic reads**. */
function makeNode(overrides: Partial<GraphNode> & { id: number; name: string }): GraphNode {
  return {
    projectId: 'fusion-weight',
    label: 'FUNCTION' as GraphNode['label'],
    qualifiedName: overrides.name,
    filePath: null,
    startLine: null,
    endLine: null,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ranked = (node: GraphNode, score: number): RankedResult => ({ node, score });

const list = (nodes: GraphNode[], scores: number[]): RankedResult[] =>
  nodes.map((node, index) => ranked(node, scores[index] ?? 1));

describe('selfEvidence', () => {
  it('is zero when there is no answer to ask about', () => {
    expect(selfEvidence('how is the session cookie signed', undefined)).toBe(0);
  });

  it('is zero when the question has no terms', () => {
    const node = makeNode({ id: 1, name: 'signSessionCookie' });
    expect(selfEvidence('   ?!  ', node)).toBe(0);
  });

  it('is one when the answer carries every term of the question', () => {
    const node = makeNode({
      id: 1,
      name: 'signSessionCookie',
      docstring: 'Sign the session cookie',
    });
    // `tokenize` splits camelCase, so the question and the name meet on the same four terms.
    expect(selfEvidence('sign session cookie', node)).toBe(1);
  });

  it('counts a term the answer carries in its signature as carried', () => {
    const node = makeNode({ id: 1, name: 'write', signature: 'write(serialised: string)' });
    expect(selfEvidence('write serialised', node)).toBe(1);
  });

  it('is the share of distinct terms, not of occurrences', () => {
    const node = makeNode({ id: 1, name: 'escapeHtml' });
    // Four occurrences, two distinct terms, one of them carried.
    expect(selfEvidence('escape escape escape html', node)).toBe(1);
    expect(selfEvidence('escape encode url html', node)).toBe(2 / 4);
  });

  it('does not credit a term the answer does not carry', () => {
    const node = makeNode({ id: 1, name: 'loadConfig', docstring: 'Read the configuration file' });
    const evidence = selfEvidence('why does a worker leak memory', node);
    expect(evidence).toBe(0);
  });
});

describe('deriveVectorWeight', () => {
  const answer = makeNode({
    id: 1,
    name: 'signSessionCookie',
    docstring: 'Sign the session cookie',
  });
  const spare = makeNode({ id: 2, name: 'renderPage' });

  it('trusts the lexical list when the question is answered in the index own words', () => {
    const lexical = list([answer, spare], [40, 10]);
    const vector = list([answer, spare], [0.9, 0.85]);
    expect(deriveVectorWeight(lexical, vector, 'sign the session cookie')).toBe(
      FUSION_WEIGHT_BOUNDS.min,
    );
  });

  it('trusts the semantic list when the lexical one cannot spell the question', () => {
    const lexical = list([spare, answer], [12, 11]);
    const vector = list([answer, spare], [0.9, 0.85]);
    expect(deriveVectorWeight(lexical, vector, 'why does the worker leak memory under load')).toBe(
      FUSION_WEIGHT_BOUNDS.max,
    );
  });

  it('claims nothing when the evidence is in between', () => {
    const half = makeNode({ id: 3, name: 'sessionStore', docstring: 'Holds the session' });
    const lexical = list([half], [20]);
    const vector = list([half], [0.8]);
    // Two of two carried is above the confident cut; two of three is neither confident nor guessing.
    expect(deriveVectorWeight(lexical, vector, 'session store')).toBe(FUSION_WEIGHT_BOUNDS.min);
    expect(deriveVectorWeight(lexical, vector, 'session store leaks')).toBe(1);
    // One of four is below the guessing cut, where the lexical list has nothing to say about the question.
    expect(deriveVectorWeight(lexical, vector, 'session token leak memory')).toBe(
      FUSION_WEIGHT_BOUNDS.max,
    );
  });

  it('claims nothing when one of the two lists is empty', () => {
    const lexical = list([answer], [40]);
    expect(deriveVectorWeight(lexical, [], 'sign the session cookie')).toBe(1);
    expect(deriveVectorWeight([], list([answer], [0.9]), 'sign the session cookie')).toBe(1);
  });

  it('keeps the two cuts ordered and inside the sweeps that produced them', () => {
    expect(SELF_EVIDENCE_GUESSING).toBeLessThan(SELF_EVIDENCE_CONFIDENT);
    expect(FUSION_WEIGHT_BOUNDS.min).toBeGreaterThan(0);
    expect(FUSION_WEIGHT_BOUNDS.max).toBeGreaterThan(1);
  });
});

/**
 * **The wiring, measured through the product path rather than through the function.**
 *
 * A test that only called `deriveVectorWeight` would pass with `search()` ignoring it, which is the defect §26 of
 * `EVAL-CONTRACT.md` records one field over: a published figure for an arm the product does not run. So each assertion
 * is a pair - `search()` must equal the fusion at the derived weight, **and must differ from the fusion at one** on a
 * fixture where the two weights order the candidates differently. Without the second half the first half passes on an
 * engine that never derived anything.
 */
describe('the product path fuses at the weight the question implies', () => {
  const answer = makeNode({
    id: 1,
    name: 'signSessionCookie',
    docstring: 'Sign the session cookie, cookie lifetime 30 days',
    filePath: '/a.ts',
  });
  const runnerUp = makeNode({ id: 2, name: 'cookieSigner', filePath: '/b.ts' });
  const unasked = makeNode({ id: 3, name: 'alphaOmega', filePath: '/c.ts' });

  /**
   * **A deterministic stub embedder rather than a model**: this file is about arithmetic, and a network call would make
   * a rank assertion depend on a quota. The vectors are chosen so the semantic order is the reverse of the lexical one,
   * which is what makes the weight observable at all.
   */
  const build = (nodes: GraphNode[]): HybridSearchEngine => {
    const store = new InMemoryGraphStore();
    for (const node of nodes) store.insertNode(node);
    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const vectors = new Map<number, Float32Array>([
      [1, Float32Array.from([0.1, 1])],
      [2, Float32Array.from([1, 0.1])],
      [3, Float32Array.from([0.5, 0.5])],
    ]);
    engine.registerEmbeddings(
      (id) => vectors.get(id) ?? null,
      async () => Float32Array.from([1, 0]),
    );
    return engine;
  };

  it('takes the lexical list when the question is answered in the index own words', async () => {
    const engine = build([answer, runnerUp, unasked]);
    const query = 'sign session cookie';
    const lexical = engine.bm25Search(query);
    const vectors = await engine.vectorSearch(query, 3, null);

    const weight = deriveVectorWeight(lexical, vectors, query);
    expect(weight).toBe(FUSION_WEIGHT_BOUNDS.min);
    expect(engine.fuseResults(lexical, vectors, 60, 3, weight).map((h) => h.node.id)).toEqual([
      1, 2, 3,
    ]);
    // **The same two lists at the neutral weight put the other candidate first**, so the assertion above is about the
    // derivation and not about a corpus where the weight does not matter.
    expect(engine.fuseResults(lexical, vectors, 60, 3, 1).map((h) => h.node.id)).toEqual([2, 1, 3]);

    const viaSearch = await engine.search({ query, limit: 3 });
    expect(viaSearch.map((h) => h.node.id)).toEqual([1, 2, 3]);
  });

  it('takes the semantic list when the lexical one can only repeat one word of the question', async () => {
    const engine = build([answer, runnerUp]);
    const query = 'why does cookie leak memory under load';
    const lexical = engine.bm25Search(query);
    const vectors = await engine.vectorSearch(query, 2, null);

    const weight = deriveVectorWeight(lexical, vectors, query);
    expect(weight).toBe(FUSION_WEIGHT_BOUNDS.max);
    expect(engine.fuseResults(lexical, vectors, 60, 2, weight).map((h) => h.node.id)).toEqual([
      2, 1,
    ]);
    expect(engine.fuseResults(lexical, vectors, 60, 2, 1).map((h) => h.node.id)).toEqual([1, 2]);

    const viaSearch = await engine.search({ query, limit: 2 });
    expect(viaSearch.map((h) => h.node.id)).toEqual([2, 1]);
  });

  it('lets a caller override the weight, because a measurement has to be able to ask', async () => {
    const engine = build([answer, runnerUp, unasked]);
    const query = 'sign session cookie';
    const lexical = engine.bm25Search(query);
    const vectors = await engine.vectorSearch(query, 3, null);
    const overridden = await engine.search({ query, limit: 3, vectorWeight: 4 });
    expect(overridden.map((h) => h.node.id)).toEqual(
      engine.fuseResults(lexical, vectors, 60, 3, 4).map((h) => h.node.id),
    );
    // **The override is visible**: the derived weight gives [1, 2, 3] and this gives [2, 1, 3], so a sweep that passed
    // a weight and got the product's column back would fail here rather than in a report nobody re-reads.
    expect(overridden.map((h) => h.node.id)).toEqual([2, 1, 3]);
  });
});

/**
 * **The second fusion site, which is the one that made the first one a half-truth.**
 *
 * `ask.ts` builds its own two lists instead of calling `search()`, so the derived weight had to be wired there as well;
 * a test of `search()` alone would have passed while the answer path kept the constant. The assertion is again a pair -
 * the answer path equals the fusion at the derived weight **and differs from the fusion at one** - because equality
 * alone is satisfied by an engine that derives nothing.
 */
describe('the answer path fuses at the same derived weight', () => {
  it('orders its candidates the way the derived weight orders them', async () => {
    const store = new InMemoryGraphStore();
    const answer = makeNode({
      id: 1,
      name: 'signSessionCookie',
      docstring: 'Sign the session cookie, cookie lifetime 30 days',
      filePath: '/a.ts',
    });
    const runnerUp = makeNode({ id: 2, name: 'cookieSigner', filePath: '/b.ts' });
    for (const node of [answer, runnerUp]) store.insertNode(node);

    const engine = new HybridSearchEngine(store);
    engine.initialize();
    const vectors = new Map<number, Float32Array>([
      [1, Float32Array.from([0.1, 1])],
      [2, Float32Array.from([1, 0.1])],
    ]);
    engine.registerEmbeddings(
      (id) => vectors.get(id) ?? null,
      async () => Float32Array.from([1, 0]),
    );

    const question = 'why does cookie leak memory under load';
    const lexical = engine.bm25Search(question);
    const vector = await engine.vectorSearch(question, 2, null);
    const weight = deriveVectorWeight(lexical, vector, question);
    expect(weight).toBe(FUSION_WEIGHT_BOUNDS.max);

    const retrieval = await retrieveContext({
      question,
      store,
      search: engine,
      options: { rerank: false },
    });
    const atDerived = engine.fuseResults(lexical, vector, 60, 60, weight);
    const atOne = engine.fuseResults(lexical, vector, 60, 60, 1);
    // **The file order is the observable**, because `PoolEntry` is per file rather than per node: the two weights put a
    // different file first, and that is what a reader of an answer sees.
    expect(retrieval.rankedFiles[0]).toBe(atDerived[0]!.node.filePath);
    expect(atOne[0]!.node.filePath).not.toBe(atDerived[0]!.node.filePath);
  });
});
