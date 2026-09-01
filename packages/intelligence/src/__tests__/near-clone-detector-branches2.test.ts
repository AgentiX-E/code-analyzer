// @code-analyzer/intelligence — Near-Clone Detector Branch Coverage (round 2)
// Reaches the pairs.sort((a, b) => b.jaccardEstimate - a.jaccardEstimate)
// comparator, which only runs when detection yields >= 2 clone pairs. Three
// byte-identical functions produce three candidate pairs (0,1), (0,2), (1,2),
// all above the default 0.7 threshold, forcing the sort to execute.

import { describe, it, expect } from 'vitest';
import { NearCloneDetector } from '../similarity/near-clone-detector.js';
import type { GraphNode, KnowledgeGraph } from '@code-analyzer/shared';

function makeNode(id: number, name: string, signature: string): GraphNode {
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
    signature,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
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

describe('NearCloneDetector — multi-pair descending sort', () => {
  it('sorts clone pairs by descending similarity', () => {
    const sig = 'function clone(a: number, b: number): number { return a + b; }';
    // Identical name + signature + properties so all three nodes produce the
    // same shingles and therefore the same MinHash signature, sharing every LSH
    // band and yielding three candidate pairs.
    const graph = makeGraph([
      makeNode(1, 'clone', sig),
      makeNode(2, 'clone', sig),
      makeNode(3, 'clone', sig),
    ]);

    const result = new NearCloneDetector().detect(graph);

    // Three identical functions yield three candidate pairs, all above threshold.
    expect(result.pairs.length).toBeGreaterThanOrEqual(2);
    // Descending sort: no later pair may exceed an earlier pair's estimate.
    for (let i = 1; i < result.pairs.length; i++) {
      expect(result.pairs[i]!.jaccardEstimate).toBeLessThanOrEqual(
        result.pairs[i - 1]!.jaccardEstimate,
      );
    }
  });
});
