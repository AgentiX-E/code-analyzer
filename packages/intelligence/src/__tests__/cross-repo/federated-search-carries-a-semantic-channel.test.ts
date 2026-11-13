// The federated engine can carry a vector channel, and this file proves the wiring rather than the model.
//
// **What is tested here is the join, not the embeddings.** A question is embedded by a function the test supplies and
// the candidates carry vectors the test supplies, so the cosine arithmetic is real and the vectors are chosen. That
// separation is the point: the questions in this file cannot tell whether a model is good, and they are not asked to -
// they assert that a vector registered on the engine reaches the ranking, that a question sharing no word with any
// candidate can still be answered, and that the lexical list survives beside it rather than being replaced by it.
//
// **The measured quality of the semantic half is in `paraphrase-search.test.ts` and `cosqa-retrieval.test.ts`**, both of
// which run against a real backend on a runner. This file would pass with a model of zero ability.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { FederatedSearchEngine } from '../../cross-repo/federated-search.js';

import type { GraphNode, NodeLabel } from '@code-analyzer/shared';

let nextId = 1;

function node(
  projectId: string,
  name: string,
  docstring: string | null,
  options: { filePath?: string; label?: NodeLabel; signature?: string | null } = {},
): GraphNode {
  const filePath = options.filePath ?? `src/${name.toLowerCase()}.ts`;
  const now = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const id = nextId++;
  return {
    id,
    projectId,
    label: options.label ?? 'Function',
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: { name, filePath, startLine: 1, endLine: 5, language: 'typescript' },
    signature: options.signature === undefined ? `function ${name}(): void` : options.signature,
    docstring,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** A unit vector along one axis. Two different axes are orthogonal, which is a cosine of exactly zero. */
function axis(index: number, dimensions = 4): Float32Array {
  const vector = new Float32Array(dimensions);
  vector[index] = 1;
  return vector;
}

/**
 * Insert into a store and answer with **the ids the store assigned**.
 *
 * The `id` a node is built with is not the id it is stored under - the store numbers its own rows - and a lookup keyed
 * on the constructor's number would return `null` for every candidate. That is exactly the class of defect this
 * registration is one line away from, so the helper reads the truth back rather than assuming it.
 */
function insertAll(store: InMemoryGraphStore, nodes: GraphNode[]): Map<string, number> {
  const ids = new Map<string, number>();
  for (const item of nodes) store.insertNode(item);
  for (const stored of store.getAllNodes()) ids.set(stored.name, stored.id);
  return ids;
}

describe('the federated engine with a vector channel registered', () => {
  it('answers a question that shares no word with the answer, which the lexical half cannot', async () => {
    // The question and the answer have no token in common: the answer says "start" and the question says "begin",
    // "serving" and "traffic". Nothing in the lexical index connects them.
    const answer = node('repo-a', 'init', 'Start the server.');
    const neighbour = node('repo-a', 'render', 'Draw the template.');
    const store = new InMemoryGraphStore();
    const ids = insertAll(store, [answer, neighbour]);

    const lexicalOnly = new FederatedSearchEngine(store);
    const withoutVectors = await lexicalOnly.search('how do I begin serving traffic', {
      maxResults: 10,
    });
    expect(withoutVectors.results.map((hit) => hit.symbol)).not.toContain('init');

    // The same engine, told that the question's vector is the answer's vector and that the neighbour is orthogonal.
    const withVectors = new FederatedSearchEngine(store);
    withVectors.registerEmbeddings(
      (nodeId) => (nodeId === ids.get('init') ? axis(0) : axis(1)),
      async () => axis(0),
    );

    const answered = await withVectors.search('how do I begin serving traffic', { maxResults: 10 });
    expect(answered.results[0]?.symbol).toBe('init');
  });

  // **The test that would have been written here, and why it is not.**
  //
  // The obvious next assertion is "a lexical answer stays above a semantic one when the question shares its words" - and
  // it is false, by construction, for vectors a test chooses. Measured on a two-node fixture: the answer is lexical
  // rank 1 (`1/61`) and vector rank 2; the unrelated node is lexical rank 2 and vector rank 1, so it wins at any fusion
  // weight above zero, and it wins by `0.0016` even at the smallest weight the sweep measured. **That is what
  // reciprocal-rank fusion is**: an item both lists name beats an item only one list names.
  //
  // Whether that is the right answer depends entirely on whether the vector was right - a question about a model, not
  // about this wiring - so it is measured where a real backend runs (`paraphrase-search.test.ts`,
  // `cosqa-retrieval.test.ts`). An assertion here would pin the fixture and teach nothing.
  //
  // What this file can hold: the vector reaches the ranking, an unregistered engine has none, and the same question
  // asked twice answers the same twice.

  it('answers the same question the same way twice, so registration is not consumed by the first call', async () => {
    const answer = node('repo-a', 'init', 'Start the server.');
    const store = new InMemoryGraphStore();
    const ids = insertAll(store, [answer]);

    const engine = new FederatedSearchEngine(store);
    engine.registerEmbeddings(
      (nodeId) => (nodeId === ids.get('init') ? axis(0) : null),
      async () => axis(0),
    );

    const first = await engine.search('begin serving traffic', { maxResults: 10 });
    const second = await engine.search('begin serving traffic', { maxResults: 10 });

    // The vector half is a function of the vectors, so two calls with the same store and the same registration answer
    // the same thing. A second call that lost its semantic list would say so here and nowhere else.
    expect(second.results.map((hit) => hit.symbol)).toEqual(first.results.map((hit) => hit.symbol));
    expect(first.results[0]?.symbol).toBe('init');
  });
});

describe('what a result carries', () => {
  it('falls back to the declaration when the node has no doc comment', async () => {
    const bare = node('repo-a', 'init', null, { signature: 'function init(): void' });
    const store = new InMemoryGraphStore();
    store.insertNode(bare);

    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('init', { maxResults: 10 });
    expect(result.results[0]?.snippet).toBe('function init(): void');
  });

  it('falls back to the name when the node has neither a doc comment nor a signature', async () => {
    const bare = node('repo-a', 'init', null, { signature: null });
    const store = new InMemoryGraphStore();
    store.insertNode(bare);

    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('init', { maxResults: 10 });
    expect(result.results[0]?.snippet).toBe('init');
  });

  it('truncates a long description rather than returning a file', async () => {
    const long = `${'Start the server and listen on a port. '.repeat(12)}`;
    const store = new InMemoryGraphStore();
    store.insertNode(node('repo-a', 'init', long));

    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('start the server', { maxResults: 10 });
    const snippet = result.results[0]?.snippet ?? '';
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(241);
  });

  it('counts every repository that appears, not only the first', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(node('repo-a', 'startServer', 'Start the server.'));
    store.insertNode(node('repo-b', 'startWorker', 'Start the worker.'));

    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('start', { maxResults: 10 });
    expect(result.repoBreakdown).toEqual({ 'repo-a': 1, 'repo-b': 1 });
    expect(result.totalResults).toBe(2);
  });

  it('refuses a group id when it was built without a resolver, instead of answering nothing', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(node('repo-a', 'start', 'Start the server.'));

    const engine = new FederatedSearchEngine(store);
    await expect(engine.search('start', { groupId: 'web' })).rejects.toThrow(/repo group resolver/);
  });
});
