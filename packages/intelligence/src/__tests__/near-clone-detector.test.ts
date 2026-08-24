import { describe, it, expect } from 'vitest';
import { NearCloneDetector } from '../similarity/near-clone-detector.js';
import type { GraphNode, KnowledgeGraph } from '@code-analyzer/shared';

function makeNode(id: number, overrides: Partial<GraphNode> = {}): GraphNode {
  const name = overrides.name ?? `func${id}`;
  return {
    id,
    projectId: 'p',
    label: 'Function',
    name,
    qualifiedName: `pkg.${name}`,
    filePath: `/src/f${id}.ts`,
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: { name },
    signature: `function func${id}(a: string, b: number): boolean { return a.length > b; }`,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGraph(nodes: GraphNode[]): KnowledgeGraph {
  return {
    projectId: 'p',
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges: new Map(),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

describe('NearCloneDetector', () => {
  it('returns empty result for fewer than 2 candidate nodes', () => {
    const detector = new NearCloneDetector();
    const result = detector.detect(makeGraph([makeNode(1)]));
    expect(result.pairs).toHaveLength(0);
    expect(result.totalComparisons).toBe(0);
  });

  it('detects near-identical functions', () => {
    const detector = new NearCloneDetector();
    const sig = 'function processOrder(id: number, qty: number): void { return; }';
    const graph = makeGraph([
      makeNode(1, { name: 'processOrder', signature: sig }),
      makeNode(2, { name: 'processOrder', signature: sig }),
    ]);
    const result = detector.detect(graph);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.pairs[0]!.jaccardEstimate).toBeGreaterThanOrEqual(0.7);
  });

  it('does not detect dissimilar functions', () => {
    const detector = new NearCloneDetector();
    const graph = makeGraph([
      makeNode(1, { name: 'aaa', signature: 'function aaaa(a: string): void { return; }' }),
      makeNode(2, { name: 'zzz', signature: 'function zzzz(q: number): void { return; }' }),
    ]);
    const result = detector.detect(graph);
    // Different names/signatures should fall below threshold
    expect(result.pairs).toHaveLength(0);
  });

  it('skips functions with short signatures', () => {
    const detector = new NearCloneDetector();
    const graph = makeGraph([
      makeNode(1, { signature: 'short' }),
      makeNode(2, { signature: 'short' }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBe(0);
  });

  it('respects custom similarity threshold', () => {
    const lenient = new NearCloneDetector({ similarityThreshold: 0.0 });
    const sig1 = 'function alpha(a: string): void { return; }';
    const sig2 = 'function beta(b: number): void { return; }';
    const graph = makeGraph([
      makeNode(1, { name: 'alpha', signature: sig1 }),
      makeNode(2, { name: 'beta', signature: sig2 }),
    ]);
    // At threshold 0, even dissimilar pairs should surface (if LSH buckets them)
    const result = lenient.detect(graph);
    expect(result.threshold).toBe(0.0);
  });

  it('adds SIMILAR_TO edges to the graph', () => {
    const detector = new NearCloneDetector();
    const sig = 'function sharedLogic(x: number): number { return x * 2; }';
    const graph = makeGraph([
      makeNode(1, { name: 'sharedLogic', signature: sig }),
      makeNode(2, { name: 'sharedLogic', signature: sig }),
    ]);
    const result = detector.detect(graph);
    detector.addSimilarToEdges(graph, result);
    if (result.pairs.length > 0) {
      expect(graph.edges.size).toBe(result.pairs.length);
      for (const edge of graph.edges.values()) {
        expect(edge.type).toBe('SIMILAR_TO');
        expect(edge.properties['detector']).toBe('minhash-lsh');
      }
    }
  });

  it('handles empty graph', () => {
    const detector = new NearCloneDetector();
    const result = detector.detect(makeGraph([]));
    expect(result.pairs).toHaveLength(0);
    expect(result.totalComparisons).toBe(0);
  });

  it('accepts custom signature length', () => {
    const detector = new NearCloneDetector({ signatureLength: 64 });
    const sig = 'function testSig(x: number): number { return x + 1; }';
    const graph = makeGraph([
      makeNode(1, { name: 'testSig', signature: sig }),
      makeNode(2, { name: 'testSig', signature: sig }),
    ]);
    const result = detector.detect(graph);
    for (const pair of result.pairs) {
      expect(pair.signatureLength).toBe(64);
    }
  });

  it('tolerates null filePath on candidate nodes', () => {
    const detector = new NearCloneDetector();
    const sig = 'function cloneTarget(n: number): number { return n * n; }';
    const graph = makeGraph([
      makeNode(1, { name: 'cloneTarget', signature: sig, filePath: null }),
      makeNode(2, { name: 'cloneTarget', signature: sig, filePath: null }),
    ]);
    const result = detector.detect(graph);
    for (const pair of result.pairs) {
      expect(pair.filePath1).toBe('');
      expect(pair.filePath2).toBe('');
    }
  });

  it('handles single-token signatures that produce empty shingles', () => {
    const detector = new NearCloneDetector();
    // A 20-char single token (< ngramSize 5) yields an empty shingle set, so
    // the MinHash signature degenerates to all-zero without throwing.
    const graph = makeGraph([
      makeNode(1, { name: 'aa', signature: 'aaaaaaaaaaaaaaaaaaaa' }),
      makeNode(2, { name: 'aa', signature: 'aaaaaaaaaaaaaaaaaaaa' }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBeGreaterThanOrEqual(0);
  });
});
