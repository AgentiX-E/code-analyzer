// The semantic half, wired from the data rather than from a benchmark.
//
// **`registerEmbeddings` had exactly one caller in this repository, and it was a test.** The pipeline computed vectors for
// every symbol and nothing that a user could reach ever read them: `search_code` documented "BM25 + vector via
// Reciprocal Rank Fusion" and could only ever answer lexically. That is the same class of defect as a provider no file
// reaches - **a capability that exists in the codebase and not in the product** - and it is what these cases pin down.

import { createQueryEmbedder } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { ToolContextImpl } from '../tools/tool-context.js';

import type { GraphNode } from '@code-analyzer/shared';

/** A node the way the embed phase leaves it: with a vector **and the name of the space it lives in**. */
async function nodeWithVector(
  id: number,
  name: string,
  docstring: string,
  backend: string | null,
): Promise<GraphNode> {
  const embedder = await createQueryEmbedder('deterministic');
  const vector = await embedder!.embed(`Function ${name} ${docstring}`);
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
    properties: {
      embedding: Array.from(vector),
      ...(backend === null ? {} : { embeddingBackend: backend }),
    },
  };
}

describe('the MCP search engine and the vectors the index holds', () => {
  it('answers none when the graph carries no vectors, rather than pretending', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode({
      ...(await nodeWithVector(1, 'plain', 'no vector here', null)),
      properties: {},
    });

    const { backend, engine } = await new ToolContextImpl(store).getSemanticSearchEngine();

    expect(backend).toBe('none');
    const results = await engine.search({ query: 'plain', limit: 5 });
    expect(results[0]!.vectorScore).toBe(0);
  });

  it('registers the vectors and names the space, so a search can be hybrid', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      await nodeWithVector(
        1,
        'reconcile',
        'Reconciles incoming invoices against receipts',
        'deterministic',
      ),
    );
    store.insertNode(
      await nodeWithVector(2, 'unrelated', 'Formats a date for display', 'deterministic'),
    );

    const { backend, engine } = await new ToolContextImpl(store).getSemanticSearchEngine();

    expect(backend).toBe('deterministic');
    // **The query is the text the node was embedded from**, because a hash vector's cosine is only meaningful for a
    // near-identical string. What is under test is that the vectors are *reached* and that their space is named - not
    // that the deterministic fallback understands a synonym, which it does not and never claimed to. The semantic
    // figure that does claim it is `docstring-search.json`, and it runs against the real endpoint.
    const embeddedText = 'Function reconcile Reconciles incoming invoices against receipts';
    const results = await engine.search({ query: embeddedText, limit: 2 });

    // **A vector score is the proof the semantic list ran at all.** Before the wiring, every result carried
    // `vectorScore: 0` and the tool reported "BM25 text search" for every item it ever returned.
    expect(results[0]!.node.name).toBe('reconcile');
    expect(results[0]!.vectorScore).toBeGreaterThan(0);
  });

  it('refuses to guess the space when a vector arrived without one', async () => {
    // **A vector whose space is unnamed cannot be compared with a query**, so the honest answer is `none` rather than a
    // cosine against whatever backend happens to be reachable - which is the mismatch that published 0.638.
    const store = new InMemoryGraphStore();
    store.insertNode(
      await nodeWithVector(1, 'orphan', 'A vector with no model named beside it', null),
    );

    expect((await new ToolContextImpl(store).getSemanticSearchEngine()).backend).toBe('none');
  });

  it('registers once, however many tool calls arrive together', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(
      await nodeWithVector(1, 'shared', 'A symbol two callers ask about', 'deterministic'),
    );
    const context = new ToolContextImpl(store);

    const [first, second] = await Promise.all([
      context.getSemanticSearchEngine(),
      context.getSemanticSearchEngine(),
    ]);

    // **The same engine object**, because registering an embedder twice would double the network cost of a query for
    // an answer that is identical.
    expect(first.engine).toBe(second.engine);
    expect(first.backend).toBe('deterministic');
  });
});
