// @code-analyzer/analyzer — the harness is code, and its failure modes get a test like any other code's.
//
// **A shared scaffold that quietly returns '' is worse than four copies that agree.** `callsFrom` names a call's target
// by its qualified name and its file, and both are read through a fallback because a graph is a general structure: a
// node may carry no qualified name (a file, a module, a synthetic root) and a file path is a property rather than a
// field. Those fallbacks are reachable, so they are reached here - with a hand-built graph rather than a fixture, since
// no fixture this product scans is malformed.

import { describe, expect, it } from 'vitest';

import { callsFrom, idOf, targets } from './pipeline-graph.js';

import type { KnowledgeGraph } from '@code-analyzer/shared';

/** A graph of two nodes and one `CALLS` edge, which is the smallest thing the helpers can be asked about. */
function twoNodeGraph(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  edge: Record<string, unknown> = {},
): KnowledgeGraph {
  return {
    projectId: 'synthetic',
    nodes: new Map<number, Record<string, unknown>>([
      [1, { id: 1, ...source }],
      [2, { id: 2, ...target }],
    ]),
    edges: new Map<number, Record<string, unknown>>([
      [
        1,
        {
          id: 1,
          type: 'CALLS',
          sourceId: 1,
          targetId: 2,
          properties: { resolution: 'import' },
          ...edge,
        },
      ],
    ]),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  } as unknown as KnowledgeGraph;
}

describe('the pipeline harness', () => {
  it('names a call by the target qualified name and the file it is declared in', () => {
    const graph = twoNodeGraph(
      { qualifiedName: 'demo:caller' },
      { qualifiedName: 'demo:pkg.leaf:leafRun', properties: { filePath: '/repo/pkg/leaf.ts' } },
    );
    expect(callsFrom(graph, 'caller')).toEqual([
      { target: 'leafRun', file: 'leaf.ts', resolution: 'import', sourceLine: undefined },
    ]);
    expect(targets(graph, 'caller')).toEqual(['leafRun']);
  });

  it('reports a target with no qualified name and no file as empty rather than crashing', () => {
    // A graph may hold a node that carries neither: a file node has a path and no name, a synthetic root has neither.
    // The harness's answer is the empty string, and a reader can see that it is missing rather than guessing one.
    const graph = twoNodeGraph({ qualifiedName: 'demo:caller' }, { qualifiedName: null });
    expect(callsFrom(graph, 'caller')).toEqual([
      { target: '', file: '', resolution: 'import', sourceLine: undefined },
    ]);
  });

  it('reports an edge with no rule as nothing rather than as a rule', () => {
    const graph = twoNodeGraph(
      { qualifiedName: 'demo:caller' },
      { qualifiedName: 'demo:callee', properties: { filePath: '/repo/callee.ts' } },
      { properties: {} },
    );
    expect(callsFrom(graph, 'caller')[0]?.resolution).toBeUndefined();
  });

  it('throws rather than inventing a node a test asked for', () => {
    // **A missing node is a broken fixture, and a harness that returned `undefined` would report the rule under test
    // as failing instead of reporting the fixture.** `idOf` is the one place a test names a node, so it is the one
    // place that has to refuse.
    const graph = twoNodeGraph({ qualifiedName: 'demo:caller' }, { qualifiedName: 'demo:callee' });
    expect(() => idOf(graph, 'not-declared')).toThrow('no node named …not-declared');
    expect(idOf(graph, 'callee')).toBe(2);
  });
});
