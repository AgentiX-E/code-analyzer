// **The ranking engine is built by walking every node, and it was being built once per question.**
//
// `HybridSearchEngine.initialize()` computes field lengths and collection statistics for the whole store — the
// expensive part, and the part that is a property of *the store* rather than of the caller. `ToolContextImpl` cached one
// per context, which is right for an MCP session and wrong for a long-lived HTTP server: `searchGraph` in the GraphQL
// resolver runs once per request, and a resolver that constructed an engine per call would recompute the same statistics
// on a store that had not changed. On a six-repository corpus that is ~18 000 nodes per request, to answer a question
// about ten of them.
//
// So the engine belongs to its store: one store, one engine, and the cache is weak because a store that goes out of scope
// should take its statistics with it. **The scope resolver is part of the key's meaning and not of the key**: a store is
// indexed by one `RepoGroupManager`, and two managers over one store would be two answers to "what is in this group".

import { describe, expect, it } from 'vitest';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { searchEngineFor } from '@code-analyzer/intelligence';

describe('a search engine belongs to its store', () => {
  it('**hands back the same engine for the same store**', () => {
    const store = new InMemoryGraphStore();
    expect(searchEngineFor(store)).toBe(searchEngineFor(store));
  });

  it('**and a different one for a different store**', () => {
    const first = new InMemoryGraphStore();
    const second = new InMemoryGraphStore();
    // Two stores whose statistics were shared would answer one checkout's question with another's field lengths, which
    // is invisible in the ranking and wrong in it.
    expect(searchEngineFor(first)).not.toBe(searchEngineFor(second));
  });

  it('**asks the resolver it was given the first time, and never a second one**', () => {
    const store = new InMemoryGraphStore();
    const asked: string[] = [];
    const first = searchEngineFor(store, {
      projectsInGroup: (groupId: string) => {
        asked.push(`first:${groupId}`);
        return ['a'];
      },
    });
    const second = searchEngineFor(store, {
      projectsInGroup: (groupId: string) => {
        asked.push(`second:${groupId}`);
        return ['b'];
      },
    });

    // **The second resolver is ignored rather than merged**, and that is a decision: an engine that swapped resolvers
    // between questions would make `groupId` mean two things inside one process. A caller that needs a second meaning
    // constructs its own engine, which is what the harness does.
    expect(second).toBe(first);
    expect(asked).toEqual([]);
  });
});
