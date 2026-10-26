// Query expansion, wired into the tool a user actually calls.
//
// **A prompt, a mean and a provider are worth nothing if `search_code` cannot reach them.** These cases pin the four
// states the tool reports - expanded, no provider, no vectors, and not asked for - because an answer produced by a
// plain query and an answer produced by an expanded one have the same shape, and a caller cannot tell them apart from
// the scores.

import { createQueryEmbedder } from '@code-analyzer/analyzer';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, expect, it } from 'vitest';

import { searchCode } from '../tools/querying-exploration.js';
import { ToolContextImpl } from '../tools/tool-context.js';

import type { LLMProvider } from '@code-analyzer/intelligence';
import type { GraphNode } from '@code-analyzer/shared';

/** A node as the embed phase leaves it: a vector, and the name of the space it lives in. */
async function nodeWithVector(id: number, name: string): Promise<GraphNode> {
  const embedder = await createQueryEmbedder('deterministic');
  const vector = await embedder!.embed(`Function ${name} walk the calls of a source file`);
  return {
    id,
    projectId: 'p',
    label: 'Function',
    name,
    qualifiedName: `pkg.${name}`,
    filePath: `/src/calls/${name}.ts`,
    startLine: 1,
    endLine: 9,
    language: 'typescript',
    signature: `function ${name}(source: string)`,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
    properties: {
      embedding: Array.from(vector),
      embeddingBackend: 'deterministic',
    },
  };
}

/** A provider that answers with a plausible implementation, which is what HyDE asks for. */
const writer: LLMProvider = {
  name: 'fake',
  complete: async () => ({
    content: 'function walkCalls(source: string) {\n  return source.split("\\n").length;\n}',
    model: 'fake',
    createdAt: new Date(0).toISOString(),
    finishReason: 'stop',
  }),
} as unknown as LLMProvider;

/** A provider that fails, which is what a timeout looks like from the caller's side. */
const failing: LLMProvider = {
  name: 'fake',
  complete: async () => {
    throw new Error('socket hang up');
  },
} as unknown as LLMProvider;

function textOf(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

describe('the context expands a query in the index’s own space', () => {
  it('returns a vector and the hypothesis when a provider answers', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    const expanded = await new ToolContextImpl(store, { llm: writer }).expandQuery(
      'how do I count the calls in a file?',
    );

    expect(expanded?.hypothesis).toContain('walkCalls');
    expect(expanded?.vector.length).toBeGreaterThan(0);
  });

  it('is null when there is no provider, which is the ordinary state of a machine without a key', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    expect(
      await new ToolContextImpl(store, { llm: null }).expandQuery('how do I count calls?'),
    ).toBeNull();
  });

  it('is null when the index carries no vectors, because there is no space to expand into', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode({ ...(await nodeWithVector(1, 'walkCalls')), properties: {} });

    expect(
      await new ToolContextImpl(store, { llm: writer }).expandQuery('how do I count calls?'),
    ).toBeNull();
  });
});

describe('the context, in the states a deployment can actually be in', () => {
  it('builds the configured provider itself when none is injected, and answers null without a key', async () => {
    // **The arm every real process takes**: no provider object passed in, so `createLLMProvider` decides. Without
    // `DEEPSEEK_API_KEY` in this environment it decides there is none, which is the absence the tool reports.
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));
    const previous = process.env['DEEPSEEK_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    try {
      expect(await new ToolContextImpl(store).expandQuery('how do I count calls?')).toBeNull();
    } finally {
      if (previous !== undefined) process.env['DEEPSEEK_API_KEY'] = previous;
    }
  });

  it('is null when the provider answers with nothing usable', async () => {
    // The hypothesis arm of `expandToVector` is what turns a silent model into the plain query.
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));
    const silent = {
      name: 'silent',
      complete: async () => ({ content: '   ', model: 'silent' }),
    } as unknown as LLMProvider;

    expect(await new ToolContextImpl(store, { llm: silent }).expandQuery('anything')).toBeNull();
  });

  it('reports no embedder when the index names a space this machine cannot join', async () => {
    // **The two-space refusal, seen from the tool**: an `api` index on a machine without the key yields no embed
    // function, so `semanticBackend` is `none` and expansion has nothing to expand into.
    const store = new InMemoryGraphStore();
    const node = await nodeWithVector(1, 'walkCalls');
    store.insertNode({
      ...node,
      properties: { ...node.properties, embeddingBackend: 'api' },
    });
    const previous = process.env['ZHIPU_API_KEY'];
    delete process.env['ZHIPU_API_KEY'];
    try {
      const { backend, embed } = await new ToolContextImpl(store).getSemanticSearchEngine();
      expect(backend).toBe('none');
      expect(embed).toBeNull();
    } finally {
      if (previous !== undefined) process.env['ZHIPU_API_KEY'] = previous;
    }
  });
});

describe('search_code reports what the query side did', () => {
  it('searches with the expanded vector and says so', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    const result = await searchCode(
      { query: 'how do I count the calls in a file?', expand: true },
      new ToolContextImpl(store, { llm: writer }),
    );
    const payload = JSON.parse(textOf(result)) as {
      queryExpansion: { applied: boolean; hypothesis?: string };
      items: Array<{ name: string }>;
    };

    expect(payload.queryExpansion.applied).toBe(true);
    expect(payload.queryExpansion.hypothesis).toContain('walkCalls');
    expect(payload.items.length).toBeGreaterThan(0);
  });

  it('falls back to the plain query when no provider is configured, and gives the reason', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    const result = await searchCode(
      { query: 'walkCalls', expand: true },
      new ToolContextImpl(store, { llm: null }),
    );
    const payload = JSON.parse(textOf(result)) as {
      queryExpansion: { applied: boolean; reason?: string };
      items: Array<{ name: string }>;
    };

    expect(payload.queryExpansion.applied).toBe(false);
    expect(payload.queryExpansion.reason).toContain('no LLM provider');
    // **The answer is still an answer**: the fallback is the search the tool shipped before expansion existed.
    expect(payload.items.length).toBeGreaterThan(0);
  });

  it('degrades to the plain query when the provider fails, rather than failing the search', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    const result = await searchCode(
      { query: 'walkCalls', expand: true },
      new ToolContextImpl(store, { llm: failing }),
    );
    const payload = JSON.parse(textOf(result)) as {
      queryExpansion: { applied: boolean; reason?: string };
    };

    expect(payload.queryExpansion.applied).toBe(false);
    expect(payload.queryExpansion.reason).toContain('socket hang up');
  });

  it('reports the absence of expansion when nobody asked for it', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(await nodeWithVector(1, 'walkCalls'));

    const result = await searchCode(
      { query: 'walkCalls' },
      new ToolContextImpl(store, { llm: writer }),
    );
    const payload = JSON.parse(textOf(result)) as {
      queryExpansion: { applied: boolean; reason?: string; hypothesis?: string };
    };

    expect(payload.queryExpansion).toEqual({ applied: false });
  });
});
