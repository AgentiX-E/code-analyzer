// The semantic half, wired from the data rather than from a benchmark.
//
// **`registerEmbeddings` had exactly one caller in this repository, and it was a test.** The pipeline computed vectors for
// every symbol and nothing that a user could reach ever read them: `search_code` documented "BM25 + vector via
// Reciprocal Rank Fusion" and could only ever answer lexically. That is the same class of defect as a provider no file
// reaches - **a capability that exists in the codebase and not in the product** - and it is what these cases pin down.
//
// **The repair then over-corrected, and this file says so.** Wiring whatever the index held made a hash of each text
// count as a semantic arm: the fallback the embed phase uses when no model is present, fused at equal weight with the
// index. Measured on the pinned corpus it answered **55 of 99 frozen questions worse than the lexical list alone**. So
// the cases below assert the third state - the space is named, and it does not vote - and the ranking arm is exercised
// in `semantic-space-authority.test.ts` through an embedder the caller supplies.

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

  it('names the space, and declines to rank with a hash', async () => {
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

    const { backend, engine, semantic, reason } = await new ToolContextImpl(
      store,
    ).getSemanticSearchEngine();

    // **The space is still named**, and that is the half of this case that survived: a reader asking what the index
    // holds gets a true answer.
    expect(backend).toBe('deterministic');
    // **And it does not vote.** `semantic` used to be implied by `backend !== 'none'`, which made a hash of each text
    // count as a semantic arm - see `semantic-space-authority.test.ts` for what that cost on the pinned corpus.
    expect(semantic).toBe(false);
    expect(reason).toContain('hash');

    // **A lexical answer is still an answer**: the node is found by its name, with no vector score behind it.
    const results = await engine.search({ query: 'reconcile', limit: 2 });
    expect(results[0]!.node.name).toBe('reconcile');
    expect(results.every((result) => result.vectorScore === 0)).toBe(true);
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
