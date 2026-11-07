// A vector is a number, and a space is a claim about what two of them mean.
//
// **The product shipped a search that said "hybrid (BM25 + vector)" on a machine with no embedding model**, because the
// embed phase falls back to a hash of each text when neither the 137 MB ONNX model nor an API key is present - which is
// the ordinary state of a fresh install - and the query side then built a hash embedder to match it. The cosine between
// two hashes is a draw from a distribution centred on zero: **it is not a weak signal, it is not a signal** - and it was
// fused with the index at equal weight.
//
// Measured on the pinned corpus and the frozen ninety-nine questions (`benchmarks/retrieval-corpus`,
// `benchmarks/paraphrase-queries.json`), fusing that list costs **55 of 99 questions for 3**, and MRR falls from
// **0.1990 to 0.0570**. Every figure this repository published from a machine without a key was measured through it.
//
// So the rule these cases pin: **a space that cannot rank does not vote.** It is not a degraded semantic arm to be
// reported as one; it is the absence of a semantic arm, and the product has to say so rather than fuse it.

import { createQueryEmbedder } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { searchCode, semanticSearch } from '../tools/querying-exploration.js';
import { ToolContextImpl } from '../tools/tool-context.js';

import type { GraphNode } from '@code-analyzer/shared';

/** A node the way the embed phase leaves it: a vector, and the name of the space beside it. */
async function nodeWithVector(
  id: number,
  name: string,
  docstring: string,
  backend: string,
): Promise<GraphNode> {
  const embedder = await createQueryEmbedder('deterministic');
  const vector = await embedder!.embed(textOf(name, docstring));
  return {
    id,
    projectId: 'p',
    label: 'Function',
    name,
    qualifiedName: `pkg.${name}`,
    filePath: `/src/${name}.ts`,
    startLine: 1,
    endLine: 9,
    language: 'typescript',
    signature: null,
    docstring,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
    properties: { embedding: Array.from(vector), embeddingBackend: backend },
  };
}

/** **The text the embed phase writes**, which the identity case below searches for verbatim. */
function textOf(name: string, docstring: string): string {
  return `Function ${name} ${docstring}`;
}

function textOfResult(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('a hash space is named, and it does not vote', () => {
  it('reports the space, refuses the semantic half, and says why', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'reconcile', 'Reconciles invoices', 'deterministic'));

    const { backend, semantic, reason, embed } = await new ToolContextImpl(
      store,
    ).getSemanticSearchEngine();

    // **The space is still named**, because a reader asking "what did this index hold" gets a true answer either way.
    expect(backend).toBe('deterministic');
    expect(semantic).toBe(false);
    // **And there is no embedder to build a hypothesis with either**, which is the same statement one layer down.
    expect(embed).toBeNull();
    expect(reason).toContain('hash');
  });

  it('does not score even a query that is the embedded text verbatim', async () => {
    // **This is the strongest case the old behaviour had and it still does not vote.** A hash of the same string is the
    // same vector, so its cosine is exactly 1 - the one situation where a hash "works". It is also a situation that
    // never occurs in a search box: a user pastes a question, not the concatenation of a symbol's label, name and doc
    // comment. A rule with an exception for it would be a rule that fires on the corpus it was tuned on.
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'reconcile', 'Reconciles invoices', 'deterministic'));
    const { engine } = await new ToolContextImpl(store).getSemanticSearchEngine();

    const results = await engine.search({
      query: textOf('reconcile', 'Reconciles invoices'),
      limit: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.vectorScore === 0)).toBe(true);
  });

  it('answers search_code lexically and says which half it did not run', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'reconcile', 'Reconciles invoices', 'deterministic'));

    const result = await searchCode({ query: 'reconcile' }, new ToolContextImpl(store));
    const payload = JSON.parse(textOfResult(result)) as {
      items: Array<{ searchMethod: string; vectorScore: number }>;
      semantic: { applied: boolean; backend: string; reason?: string };
    };

    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items.every((item) => item.searchMethod === 'BM25 text search')).toBe(true);
    expect(payload.items.every((item) => item.vectorScore === 0)).toBe(true);
    expect(payload.semantic.applied).toBe(false);
    expect(payload.semantic.backend).toBe('deterministic');
    expect(payload.semantic.reason).toContain('hash');
  });

  it('refuses to call a hash search semantic', async () => {
    // **The tool named for the capability** answers with the reason instead of with the nearest hash neighbours, which
    // is what it used to return: ranked by the cosine of two pseudo-random vectors, under a note that said "Vector
    // embeddings available".
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'reconcile', 'Reconciles invoices', 'deterministic'));

    const result = await semanticSearch({ query: 'invoice' }, new ToolContextImpl(store));
    const payload = JSON.parse(textOfResult(result)) as {
      items: unknown[];
      searchMethod?: string;
      reason?: string;
    };

    expect(payload.items).toEqual([]);
    expect(payload.reason).toContain('hash');
  });
});

describe('a space that can rank votes exactly once', () => {
  it('fuses when the index names a model space and an embedder joins it', async () => {
    // **The seam is the product's, not the test's**: a deployment may hold its own embedder (a local server, a pinned
    // model), and `createQueryEmbedder` already takes a loader. This case supplies one so that "hybrid" has a meaning
    // on a machine with no key - otherwise the only reachable hybrid in this repository would be the hash one.
    const store = new InMemoryGraphStore();
    const first = await nodeWithVector(1, 'reconcile', 'Reconciles invoices', 'onnx');
    store.insertNode({
      ...first,
      // A two-dimensional space the case can reason about: `reconcile` points along x, `format` along y.
      properties: { embedding: [1, 0], embeddingBackend: 'onnx' },
    });
    const second = await nodeWithVector(2, 'format', 'Formats a date', 'onnx');
    store.insertNode({ ...second, properties: { embedding: [0, 1], embeddingBackend: 'onnx' } });

    const context = new ToolContextImpl(store, {
      queryEmbedderLoader: async () => ({
        embed: async () => new Float32Array([1, 0]),
        backend: 'onnx',
        dispose: async () => undefined,
      }),
    });

    const { semantic, backend, embed } = await context.getSemanticSearchEngine();
    expect(backend).toBe('onnx');
    expect(semantic).toBe(true);
    expect(embed).not.toBeNull();

    const result = await searchCode({ query: 'reconcile' }, context);
    const payload = JSON.parse(textOfResult(result)) as {
      items: Array<{ name: string; vectorScore: number }>;
      semantic: { applied: boolean };
    };
    expect(payload.semantic.applied).toBe(true);
    expect(payload.items[0]?.name).toBe('reconcile');
    expect(payload.items.some((item) => item.vectorScore > 0)).toBe(true);
  });
});
