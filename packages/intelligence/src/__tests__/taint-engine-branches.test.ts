// @ts-nocheck
// @code-analyzer/intelligence — Taint engine branch coverage: null signature/
// name/language fallbacks and wildcard-language source/sink/sanitizer matching.

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

const wildcardSource: TaintSource = {
  id: 'src',
  category: 'sql_injection',
  patterns: [/req\./],
  description: 'user input',
  severity: 'high',
  languages: ['*'],
};

const typedSource: TaintSource = {
  id: 'src-typed',
  category: 'sql_injection',
  patterns: [/req\./],
  description: 'user input',
  severity: 'high',
  languages: ['typescript'],
};

const wildcardSink: TaintSink = {
  id: 'sink',
  category: 'sql_injection',
  patterns: [/db\.query/],
  description: 'sql sink',
  severity: 'high',
  languages: ['*'],
};

const wildcardSanitizer: Sanitizer = {
  id: 'san',
  patterns: [/escape/],
  description: 'sanitizer',
  languages: ['*'],
};

describe('TaintAnalysisEngine — node identification edge cases', () => {
  it('skips a node with no signature and no name', () => {
    const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
    engine.addSource(wildcardSource);
    const node = makeNode({ id: 1, signature: null, name: '' });
    const matches = (engine as any).identifySourceNodes(makeGraph([node]));
    expect(matches).toEqual([]);
  });

  it('matches a source via wildcard language for a node with null language', () => {
    const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
    engine.addSource(wildcardSource);
    const node = makeNode({ id: 1, signature: 'req.query.id', language: null });
    const matches = (engine as any).identifySourceNodes(makeGraph([node]));
    expect(matches.length).toBe(1);
  });

  it('uses a null-signature fallback by matching on name alone', () => {
    const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
    engine.addSource({ ...typedSource, patterns: [/sensitiveFn/] });
    const node = makeNode({ id: 1, signature: null, name: 'sensitiveFn' });
    const matches = (engine as any).identifySourceNodes(makeGraph([node]));
    expect(matches.length).toBe(1);
  });

  it('identifies a sink with null language via wildcard', () => {
    const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
    engine.addSink(wildcardSink);
    const node = makeNode({ id: 1, signature: 'db.query("x")', language: null });
    const matches = (engine as any).identifySinkNodes(makeGraph([node]));
    expect(matches.length).toBe(1);
  });

  it('identifies a sanitizer with null language via wildcard', () => {
    const engine = new TaintAnalysisEngine({ sources: [], sinks: [], sanitizers: [] });
    engine.addSanitizer(wildcardSanitizer);
    const node = makeNode({ id: 1, signature: 'escape(input)', language: null });
    const ids = (engine as any).identifySanitizerNodes(makeGraph([node]));
    expect(ids.has(1)).toBe(true);
  });
});
