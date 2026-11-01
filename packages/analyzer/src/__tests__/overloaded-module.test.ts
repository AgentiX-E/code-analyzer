// @code-analyzer/analyzer — one name, written more than once.
//
// **A call writes a name, not a signature.** `flask/cli.py` declares `def locate_app(...)` three times - two
// `@t.overload` stubs and the implementation - and the file's scope refused the name because it had three
// declarations, so `load_app`'s two calls resolved to nothing. `redis/ioredis` states the same fact in TypeScript:
// `RedisCommander` declares `info` eleven times and `cluster` forty-two, so every `this.info(...)` in that checkout
// pointed at an `@ambiguous` bucket and the edge was never made.
//
// **The rule is the one Python and JavaScript already agree on**: the last declaration of a name in a scope is the one
// that runs. Two declarations of *different* kinds under one name are still two answers, because they are two
// different things to call, and that case keeps refusing.

import { describe, expect, it } from 'vitest';

import { buildGraph, callsFrom } from './support/pipeline-graph.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** The `locate` nodes of the fixture, in source order. */
function locateNodes(graph: KnowledgeGraph): { id: number; line: number }[] {
  return [...graph.nodes.values()]
    .filter((node) => node.name === 'locate')
    .map((node) => ({ id: node.id, line: node.startLine ?? 0 }))
    .sort((left, right) => left.line - right.line);
}

describe('a module function declared more than once', () => {
  it('resolves a call to the declaration that runs, which is the last one', async () => {
    const graph = await buildGraph('overloaded-module');
    const declarations = locateNodes(graph);
    // The fixture declares it three times, and the graph keeps all three: a node's identity is its name *and* its
    // line, so three declarations are three nodes and only the scope index had to decide which one a name means.
    expect(declarations).toHaveLength(3);
    const loads = [...graph.nodes.values()].filter((node) => node.name === 'load');
    const edge = [...graph.edges.values()].find(
      (candidate) =>
        candidate.type === 'CALLS' && loads.some((node) => node.id === candidate.sourceId),
    );
    expect(edge?.targetId).toBe(declarations[2]?.id);
  });

  it('answers with a name whose declarations agree, and only with those', async () => {
    // **A repeated name carries its line**, because a node's identity is `(name, startLine)`: the three declarations
    // are three nodes and the one a call reaches is the last. The arm is `sameFile`, which is the arm a bare call in
    // the file it is written in has always taken - what changed is that it now has an answer.
    const graph = await buildGraph('overloaded-module');
    expect(callsFrom(graph, 'load')).toContainEqual(
      expect.objectContaining({ target: 'locate@12', resolution: 'sameFile' }),
    );
  });
});
