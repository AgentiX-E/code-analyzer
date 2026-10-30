// The `ask_codebase` tool — unit tests.
//
// **The tool is a thin adapter, and thin adapters are where the mapping errors live**: a field dropped in `toResponse`,
// a `maxBlocks` that is not clamped, a provider that is passed through when the caller asked for none. The assembly
// itself is measured elsewhere; what is asserted here is the contract a client sees.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { HybridSearchEngine } from '@code-analyzer/intelligence';
import { describe, expect, it } from 'vitest';

import { askCodebaseTool, askCodebaseSchema, toResponse } from '../tools/ask.js';

import type { AskCodebaseResponse } from '../tools/ask.js';
import type { AnswerResult, LLMProvider } from '@code-analyzer/intelligence';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A store with `count` functions in one file, plus one in a second project. **Real nodes, real ids.** */
function buildStore(count = 3): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (let index = 0; index < count; index += 1) {
    store.insertNode({
      projectId: 'owner/one',
      label: 'Function',
      name: `parse_token_${String(index)}`,
      qualifiedName: `auth.parse_token_${String(index)}`,
      filePath: 'app/auth.py',
      startLine: index * 10 + 1,
      endLine: index * 10 + 9,
      language: 'python',
      properties: {
        body: `def parse_token_${String(index)}(raw):\n    return raw.split(".")[0]\n`,
      },
      complexity: null,
      isExported: true,
    } as never);
  }
  store.insertNode({
    projectId: 'owner/two',
    label: 'Function',
    name: 'parse_token_other',
    qualifiedName: 'other.parse_token_other',
    filePath: 'other/auth.py',
    startLine: 1,
    endLine: 5,
    language: 'python',
    properties: { body: 'def parse_token_other(raw):\n    return raw\n' },
    complexity: null,
    isExported: true,
  } as never);
  return store;
}

/** A provider that answers with a fixed string, so the citation contract is what is under test. */
function fakeProvider(answer: string): LLMProvider {
  return {
    name: 'fake',
    model: 'fake-1',
    complete: () =>
      Promise.resolve({
        content: answer,
        model: 'fake-1',
        createdAt: '2026-10-30T00:00:00.000Z',
        finishReason: 'stop',
      }),
    completeWithTools: () =>
      Promise.resolve({
        content: answer,
        model: 'fake-1',
        createdAt: '2026-10-30T00:00:00.000Z',
        finishReason: 'stop',
      }),
    healthCheck: () => Promise.resolve(true),
  };
}

/** A minimal tool context: `isToolContext` asks for a store and a `getSearchEngine`, and the tool asks for the rest. */
function fakeContext(
  store: InMemoryGraphStore,
  provider: LLMProvider | null,
  backend = 'fake-backend',
): Record<string, unknown> {
  // **The real engine over the real store**, because a fake that returns nothing cannot tell "no candidates" from
  // "the assembly dropped them" - and the case about an empty engine needs to say so explicitly instead.
  const engine = new HybridSearchEngine(store);
  engine.initialize();
  return {
    store,
    getSearchEngine: () => engine,
    getSemanticSearchEngine: () => Promise.resolve({ engine, backend, embed: null }),
    getLLMProvider: () => provider,
  };
}

/** The JSON the tool returns, parsed. **A failure to parse is a failure of the contract**, so it throws here. */
function payload(result: { content: Array<{ type: string; text?: string }> }): AskCodebaseResponse {
  const text = result.content[0]?.text;
  if (typeof text !== 'string') throw new Error('the tool returned no text content');
  return JSON.parse(text) as AskCodebaseResponse;
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

describe('askCodebaseSchema', () => {
  it('requires a question and nothing else', () => {
    expect(askCodebaseSchema.required).toEqual(['question']);
  });

  it('declares every parameter the tool reads', () => {
    // **A parameter the handler reads and the schema does not declare is invisible to a client**, which is the defect
    // this case exists to catch.
    expect(Object.keys(askCodebaseSchema.properties).sort()).toEqual([
      'generate',
      'maxBlocks',
      'projectId',
      'question',
      'rerank',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

describe('askCodebaseTool refusals', () => {
  it('refuses a missing question', async () => {
    const result = await askCodebaseTool({}, buildStore());
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('question is required');
  });

  it('refuses a question that is only whitespace', async () => {
    const result = await askCodebaseTool({ question: '   ' }, buildStore());
    expect(result.isError).toBe(true);
  });

  it('refuses a question that is not a string', async () => {
    const result = await askCodebaseTool({ question: 42 }, buildStore());
    expect(result.isError).toBe(true);
  });

  it('refuses when no store is passed at all', async () => {
    const result = await askCodebaseTool({ question: 'where is the token parsed' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('no graph store is available');
  });

  it('refuses an object that is neither a store nor a context', async () => {
    // **The distinction matters**: a client that passed its own options object would otherwise reach the assembler with
    // an object whose `getEdgesForNode` is undefined.
    const result = await askCodebaseTool(
      { question: 'where is the token parsed' },
      { search: 'on' },
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A bare store
// ---------------------------------------------------------------------------

describe('askCodebaseTool over a bare store', () => {
  it('answers with the context and says there is no model', async () => {
    const result = await askCodebaseTool({ question: 'where is the token parsed' }, buildStore());
    const response = payload(result);
    expect(result.isError).toBeUndefined();
    expect(response.abstained).toBe('no-provider');
    expect(response.context.length).toBeGreaterThan(0);
    expect(response.retrievedFiles).toContain('app/auth.py');
    // **Every block is numbered and every block names a file**, because a citation that cannot resolve is not one.
    for (const block of response.context) {
      expect(block.id).toBeGreaterThan(0);
      expect(block.filePath.length).toBeGreaterThan(0);
    }
  });

  it('clamps maxBlocks from above and from below', async () => {
    const store = buildStore(60);
    const high = payload(await askCodebaseTool({ question: 'parse_token', maxBlocks: 500 }, store));
    expect(high.context.length).toBeLessThanOrEqual(40);
    const low = payload(await askCodebaseTool({ question: 'parse_token', maxBlocks: 0 }, store));
    expect(low.context.length).toBeGreaterThanOrEqual(1);
  });

  it('restricts the answer to one project when one is named', async () => {
    const response = payload(
      await askCodebaseTool(
        { question: 'parse_token', projectId: 'owner/two', maxBlocks: 20 },
        buildStore(),
      ),
    );
    expect(response.context.length).toBeGreaterThan(0);
    expect(response.retrievedFiles).toEqual(['other/auth.py']);
  });
});

// ---------------------------------------------------------------------------
// A tool context
// ---------------------------------------------------------------------------

describe('askCodebaseTool over a tool context', () => {
  it('asks the context for an engine rather than building one', async () => {
    // **The engine decides whether vectors are in the answer**, and a tool that built its own would answer every
    // question lexically in a deployment that had registered an embedder.
    let asked = 0;
    const store = buildStore();
    const context = {
      ...fakeContext(store, null),
      getSemanticSearchEngine: () => {
        asked += 1;
        return Promise.resolve({
          engine: {
            bm25Search: () => [],
            vectorSearch: () => Promise.resolve([]),
            fuseResults: () => [],
            initialize: () => undefined,
          },
          backend: 'fake-backend',
          embed: null,
        });
      },
    };
    const response = payload(
      await askCodebaseTool({ question: 'where is the token parsed' }, context),
    );
    expect(asked).toBe(1);
    // **No blocks, because the engine returned no candidates**: the abstention names the retrieval, not the model.
    expect(response.context).toEqual([]);
    expect(response.abstained).toBe('no-blocks-retrieved');
  });

  it('returns prose with its citations when the context has a provider', async () => {
    const response = payload(
      await askCodebaseTool(
        { question: 'where is the token parsed', generate: true },
        fakeContext(buildStore(), fakeProvider('The token is split in [1].')),
      ),
    );
    expect(response.abstained).toBeNull();
    expect(response.answer).toContain('[1]');
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.grounding.allCitationsResolve).toBe(true);
    expect(response.files).toEqual([response.citations[0]!.filePath]);
  });

  it('does not ask for prose when the caller says generate: false', async () => {
    const response = payload(
      await askCodebaseTool(
        { question: 'where is the token parsed', generate: false },
        fakeContext(buildStore(), fakeProvider('unused')),
      ),
    );
    // **The retrieval is the whole answer**, and the reason there is no prose is stated rather than implied.
    expect(response.abstained).toBe('no-provider');
    expect(response.answer).toBe('');
    expect(response.citations).toEqual([]);
    expect(response.context.length).toBeGreaterThan(0);
  });

  it('spends a completion on the rerank but not on the answer, and none at all when both are off', async () => {
    // **`generate` governs the answer and `rerank` governs the order** - two completions become one when the prose is
    // turned off, and zero when the order is turned off too. The counts are what say the flags reached the assembler
    // rather than being accepted and ignored.
    const counts: number[] = [];
    const counting = (): { provider: LLMProvider; calls: () => number } => {
      let calls = 0;
      const base = fakeProvider('The token is split in [1].');
      return {
        provider: {
          ...base,
          complete: (...args) => {
            calls += 1;
            return base.complete(...args);
          },
        },
        calls: () => calls,
      };
    };

    const proseOff = counting();
    payload(
      await askCodebaseTool(
        { question: 'where is the token parsed', generate: false },
        fakeContext(buildStore(), proseOff.provider),
      ),
    );
    counts.push(proseOff.calls());

    const bothOff = counting();
    payload(
      await askCodebaseTool(
        { question: 'where is the token parsed', generate: false, rerank: false },
        fakeContext(buildStore(), bothOff.provider),
      ),
    );
    counts.push(bothOff.calls());

    expect(counts).toEqual([1, 0]);
  });

  it('skips the rerank when the caller says rerank: false', async () => {
    // **Two completions become one**, which is the only way to tell the flag reached the assembler rather than being
    // accepted and ignored.
    let calls = 0;
    const provider = fakeProvider('The token is split in [1].');
    const counting: LLMProvider = {
      ...provider,
      complete: (...args) => {
        calls += 1;
        return provider.complete(...args);
      },
    };
    payload(
      await askCodebaseTool(
        { question: 'where is the token parsed', rerank: false },
        fakeContext(buildStore(), counting),
      ),
    );
    expect(calls).toBe(1);
  });

  it('survives a provider that cannot be reached', async () => {
    const broken: LLMProvider = {
      ...fakeProvider(''),
      complete: () => Promise.reject(new Error('429 too many requests')),
    };
    const response = payload(
      await askCodebaseTool(
        { question: 'where is the token parsed' },
        fakeContext(buildStore(), broken),
      ),
    );
    expect(response.abstained).toBe('provider-failed');
    // **The retrieval is still there**, because a caller that paid for nothing should still get the evidence.
    expect(response.context.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The response shape
// ---------------------------------------------------------------------------

describe('toResponse', () => {
  const result: AnswerResult = {
    question: 'where is it parsed',
    answer: 'In [1].',
    context: [
      {
        id: 1,
        nodeId: 7,
        name: 'parse',
        qualifiedName: 'auth.parse',
        label: 'Function',
        filePath: 'app/auth.py',
        startLine: 3,
        endLine: 9,
        language: 'python',
        signature: null,
        body: 'def parse(raw):\n    return raw\n',
        origin: 'retrieved',
        reachedBy: null,
        score: 1,
      },
      {
        id: 2,
        nodeId: 8,
        name: 'caller',
        qualifiedName: 'app.caller',
        label: 'Function',
        filePath: 'app/views.py',
        startLine: null,
        endLine: null,
        language: 'python',
        signature: null,
        body: null,
        origin: 'graph',
        reachedBy: { relation: 'CALLS', from: 1 },
        score: null,
      },
    ],
    citations: [
      {
        id: 1,
        nodeId: 7,
        filePath: 'app/auth.py',
        startLine: 3,
        name: 'parse',
        qualifiedName: 'auth.parse',
      },
    ],
    files: ['app/auth.py'],
    retrievedFiles: ['app/auth.py', 'app/views.py'],
    grounding: { unknownIds: [], cited: [1], uncited: [2], allCitationsResolve: true },
    abstained: null,
    notes: ['the answer cites one block of two'],
    stats: { retrieved: 2, fromGraph: 1, contextChars: 120, latencyMs: 9 },
  };

  it('keeps every block and spells the edge that reached it', () => {
    const response = toResponse(result);
    expect(response.context.map((block) => block.id)).toEqual([1, 2]);
    expect(response.context[0]!.reachedBy).toBeNull();
    // **A string, because a client renders it**: the node identity appears nowhere in the prose a model read.
    expect(response.context[1]!.reachedBy).toBe('CALLS from [1]');
  });

  it('carries the grounding report without recomputing it', () => {
    const response = toResponse(result);
    expect(response.grounding).toEqual({
      unknownIds: [],
      uncited: [2],
      allCitationsResolve: true,
    });
  });

  it('carries the notes and the stats, which are how a caller sees the cost', () => {
    const response = toResponse(result);
    expect(response.notes).toEqual(['the answer cites one block of two']);
    expect(response.stats).toEqual(result.stats);
  });
});
