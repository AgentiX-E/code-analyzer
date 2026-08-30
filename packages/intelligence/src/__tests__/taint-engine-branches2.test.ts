// @ts-nocheck
// @code-analyzer/intelligence — Taint engine branch coverage (round 2): the
// typed-language mismatch guards, the path-length confidence tiers, the edge-type
// adjacency filter, and the per-source finding cap.

import { describe, it, expect } from 'vitest';
import { TaintAnalysisEngine } from '../security/taint-engine.js';
import type { TaintSource, TaintSink, Sanitizer } from '../security/taint-engine.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@code-analyzer/shared';

function makeNode(partial: Partial<GraphNode> & { id: number }): GraphNode {
  return {
    projectId: 'proj',
    label: 'Function',
    name: 'fn',
    qualifiedName: 'q::fn',
    filePath: 'test.ts',
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: 1,
    isExported: false,
    fingerprint: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...partial,
  };
}

function makeEdge(partial: Partial<GraphEdge> & { id: number }): GraphEdge {
  return {
    projectId: 'proj',
    sourceId: 0,
    targetId: 1,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2026-01-01',
    ...partial,
  };
}

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  const nodeMap = new Map<number, GraphNode>();
  const edgeMap = new Map<number, GraphEdge>();
  for (const n of nodes) nodeMap.set(n.id, n);
  for (const e of edges) edgeMap.set(e.id, e);
  return {
    projectId: 'proj',
    nodes: nodeMap,
    edges: edgeMap,
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

const typedSource: TaintSource = {
  id: 'src-typed',
  category: 'sql_injection',
  patterns: [/req\./],
  description: 'user input',
  severity: 'high',
  languages: ['typescript'],
};

const typedSink: TaintSink = {
  id: 'sink-typed',
  category: 'sql_injection',
  patterns: [/db\.query/],
  description: 'sql sink',
  severity: 'high',
  languages: ['typescript'],
};

const typedSanitizer: Sanitizer = {
  id: 'san-typed',
  patterns: [/escape/],
  description: 'sanitizer',
  languages: ['typescript'],
};

function emptyEngine(): TaintAnalysisEngine {
  return new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
}

describe('TaintAnalysisEngine — typed language guards', () => {
  it('skips a source whose language is null and not wildcard-covered', () => {
    const engine = emptyEngine();
    engine.addSource(typedSource);
    const node = makeNode({ id: 1, signature: 'req.query', language: null });
    expect((engine as any).identifySourceNodes(makeGraph([node]))).toEqual([]);
  });

  it('skips a sink whose language mismatches the sink rule', () => {
    const engine = emptyEngine();
    engine.addSink(typedSink);
    const node = makeNode({ id: 1, signature: 'db.query("x")', language: 'python' });
    expect((engine as any).identifySinkNodes(makeGraph([node]))).toEqual([]);
  });

  it('skips a sink with no signature and no name', () => {
    const engine = emptyEngine();
    engine.addSink(typedSink);
    const node = makeNode({ id: 1, signature: null, name: '' });
    expect((engine as any).identifySinkNodes(makeGraph([node]))).toEqual([]);
  });

  it('skips a sanitizer whose language mismatches the sanitizer rule', () => {
    const engine = emptyEngine();
    engine.addSanitizer(typedSanitizer);
    const node = makeNode({ id: 1, signature: 'escape(x)', language: 'python' });
    expect((engine as any).identifySanitizerNodes(makeGraph([node])).size).toBe(0);
  });
});

describe('TaintAnalysisEngine — null signature/language fallbacks', () => {
  it('identifies a sink with a null signature and a non-null name', () => {
    const engine = emptyEngine();
    engine.addSink({ ...typedSink, patterns: [/db/] });
    const node = makeNode({ id: 1, signature: null, name: 'db' });
    expect((engine as any).identifySinkNodes(makeGraph([node])).length).toBe(1);
  });

  it('skips a sink with a null language under a typed sink rule', () => {
    const engine = emptyEngine();
    engine.addSink(typedSink);
    const node = makeNode({ id: 1, signature: 'db.query("x")', language: null });
    expect((engine as any).identifySinkNodes(makeGraph([node]))).toEqual([]);
  });

  it('identifies a sanitizer with a null signature and a non-null name', () => {
    const engine = emptyEngine();
    engine.addSanitizer({ ...typedSanitizer, patterns: [/esc/] });
    const node = makeNode({ id: 1, signature: null, name: 'esc' });
    expect((engine as any).identifySanitizerNodes(makeGraph([node])).has(1)).toBe(true);
  });

  it('skips a sanitizer with a null language under a typed sanitizer rule', () => {
    const engine = emptyEngine();
    engine.addSanitizer(typedSanitizer);
    const node = makeNode({ id: 1, signature: 'escape(x)', language: null });
    expect((engine as any).identifySanitizerNodes(makeGraph([node])).size).toBe(0);
  });
});

describe('TaintAnalysisEngine — adjacency edge-type filter', () => {
  it('follows CALLS, DATA_FLOWS, and IMPORTS edges and ignores others', () => {
    const engine = emptyEngine();
    const graph = makeGraph(
      [],
      [
        makeEdge({ id: 1, sourceId: 1, targetId: 2, type: 'CALLS' }),
        makeEdge({ id: 2, sourceId: 1, targetId: 3, type: 'DATA_FLOWS' }),
        makeEdge({ id: 3, sourceId: 1, targetId: 4, type: 'IMPORTS' }),
        makeEdge({ id: 4, sourceId: 1, targetId: 5, type: 'EXTENDS' }),
      ],
    );
    const adjacency = (engine as any).buildAdjacency(graph);
    expect(adjacency.get(1)).toEqual([2, 3, 4]);
  });
});

describe('TaintAnalysisEngine — confidence path-length tiers', () => {
  it('reduces confidence for a path longer than five hops', () => {
    const engine = emptyEngine();
    const six = (engine as any).computeConfidence({ sanitized: false, pathLength: 6 }, new Set());
    const five = (engine as any).computeConfidence({ sanitized: false, pathLength: 5 }, new Set());
    expect(six).toBeLessThan(five);
  });

  it('reduces confidence further for a path longer than eight hops', () => {
    const engine = emptyEngine();
    const nine = (engine as any).computeConfidence({ sanitized: false, pathLength: 9 }, new Set());
    const eight = (engine as any).computeConfidence({ sanitized: false, pathLength: 8 }, new Set());
    expect(nine).toBeLessThan(eight);
  });
});

describe('TaintAnalysisEngine — per-source finding cap', () => {
  it('stops collecting once the per-source cap is reached', () => {
    const engine = new TaintAnalysisEngine({
      sources: [typedSource],
      sinks: [typedSink],
      sanitizers: [],
      maxPathsPerSource: 1,
    });
    const sourceA = makeNode({ id: 1, signature: 'req.query', name: 'a' });
    const sourceB = makeNode({ id: 2, signature: 'req.query', name: 'b' });
    const sink = makeNode({ id: 3, signature: 'db.query("x")', name: 'c' });
    const graph = makeGraph(
      [sourceA, sourceB, sink],
      [
        makeEdge({ id: 1, sourceId: 1, targetId: 3, type: 'CALLS' }),
        makeEdge({ id: 2, sourceId: 2, targetId: 3, type: 'CALLS' }),
      ],
    );
    const result = engine.analyze(graph, 'proj');
    // cap = maxPathsPerSource * sourceNodes.length = 1 * 2 = 2
    expect(result.findings.length).toBe(2);
  });
});
