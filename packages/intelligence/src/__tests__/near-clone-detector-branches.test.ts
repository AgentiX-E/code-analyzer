// @code-analyzer/intelligence — Near-Clone Detector Branch Tests
// Exercises the pruning path, dissimilar-pair comparison, and candidate
// filtering by label that the happy-path clone tests do not reach.

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

describe('NearCloneDetector — branch coverage', () => {
  it('prunes a bucket-matching pair whose similarity is below the threshold', () => {
    // Two byte-identical functions share every LSH band, so they are bucketed
    // together; a threshold above the maximum possible similarity (1.0) then
    // rejects them via the `jaccard >= threshold` false branch, incrementing
    // prunedByLSH.
    const detector = new NearCloneDetector({ similarityThreshold: 1.01 });
    const sig = 'function calc(a: number, b: number): number { return a + b; }';
    const graph = makeGraph([
      makeNode(1, { name: 'calc', signature: sig }),
      makeNode(2, { name: 'calc', signature: sig }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBeGreaterThan(0);
    expect(result.prunedByLSH).toBeGreaterThan(0);
    expect(result.pairs).toHaveLength(0);
  });

  it('estimates Jaccard from two differing signatures (mismatch branch)', () => {
    // estimateJaccard compares two signatures element-wise; a partial match
    // exercises the `sig1[i] === sig2[i]` false branch.
    const detector = new NearCloneDetector() as unknown as {
      estimateJaccard: (a: number[], b: number[]) => number;
    };
    expect(detector.estimateJaccard([1, 2, 3, 4], [1, 2, 3, 0])).toBeCloseTo(0.75);
    expect(detector.estimateJaccard([9, 9, 9], [0, 0, 0])).toBe(0);
  });

  it('ignores nodes that are neither functions nor methods', () => {
    const detector = new NearCloneDetector();
    const sig = 'function sharedLogic(x: number): number { return x * 2; }';
    const graph = makeGraph([
      makeNode(1, { name: 'sharedLogic', signature: sig }),
      makeNode(2, { name: 'sharedLogic', signature: sig }),
      makeNode(3, { label: 'Class', name: 'NotACandidate', signature: sig }),
    ]);
    const result = detector.detect(graph);
    // The Class node is excluded from candidate selection entirely.
    expect(result.totalComparisons).toBeGreaterThan(0);
    for (const pair of result.pairs) {
      expect(pair.nodeId1).not.toBe(3);
      expect(pair.nodeId2).not.toBe(3);
    }
  });

  it('treats Method labels as candidates (the second label alternative)', () => {
    const detector = new NearCloneDetector();
    const sig = 'function sharedMethod(x: number): number { return x + 1; }';
    const graph = makeGraph([
      makeNode(1, { name: 'sharedMethod', signature: sig }),
      makeNode(2, { label: 'Method', name: 'sharedMethod', signature: sig }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBeGreaterThan(0);
    expect(result.pairs.length).toBeGreaterThan(0);
  });

  it('skips a function whose signature is shorter than the minimum', () => {
    const detector = new NearCloneDetector();
    const graph = makeGraph([
      makeNode(1, { signature: 'tiny' }),
      makeNode(2, { signature: 'tiny' }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBe(0);
  });

  it('treats a null signature as empty when filtering candidates', () => {
    // A Function/Method with a null signature exercises the `node.signature ??
    // ''` fallback in getCandidateNodes before being skipped as too short.
    const detector = new NearCloneDetector();
    const graph = makeGraph([
      makeNode(1, { signature: null }),
      makeNode(2, { signature: 'function real(a: number): number { return a; }' }),
    ]);
    const result = detector.detect(graph);
    expect(result.totalComparisons).toBe(0);
  });

  it('returns 0 Jaccard for empty signatures', () => {
    const detector = new NearCloneDetector() as unknown as {
      estimateJaccard: (a: number[], b: number[]) => number;
    };
    expect(detector.estimateJaccard([], [])).toBe(0);
  });

  it('produces an all-zero signature for an empty shingle set', () => {
    const detector = new NearCloneDetector() as unknown as {
      computeMinHash: (shingles: Set<number>) => number[];
    };
    const signature = detector.computeMinHash(new Set());
    expect(signature).toHaveLength(128);
    expect(signature.every((h) => h === 0)).toBe(true);
  });

  it('derives shingles from null signature/name/properties without throwing', () => {
    const detector = new NearCloneDetector() as unknown as {
      getShingles: (node: GraphNode) => Set<number>;
    };
    const bare = makeNode(1, {
      signature: null,
      name: null as unknown as string,
      properties: null as unknown as GraphNode['properties'],
    });
    // Null metadata degrades to empty strings; getShingles must not throw and
    // must return an empty shingle set for an effectively empty document.
    expect(() => detector.getShingles(bare)).not.toThrow();
  });
});
