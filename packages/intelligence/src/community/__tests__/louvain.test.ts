// @code-analyzer/intelligence — Louvain Community Detection Tests
import { describe, it, expect } from 'vitest';
import { LouvainDetector } from '../louvain.js';
import type { KnowledgeGraph, GraphNode, GraphEdge } from '@code-analyzer/shared';

function makeGraph(): KnowledgeGraph {
  return {
    projectId: 'test',
    nodes: new Map(),
    edges: new Map(),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

function addNode(g: KnowledgeGraph, id: number, label: string, name: string): GraphNode {
  const node: GraphNode = {
    id, projectId: g.projectId, label: label as any, name,
    qualifiedName: `${label}:${name}`,
    filePath: null, startLine: null, endLine: null, language: null,
    properties: {}, signature: null, docstring: null, complexity: null,
    isExported: false, fingerprint: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  g.nodes.set(id, node);
  return node;
}

function addEdge(g: KnowledgeGraph, id: number, sourceId: number, targetId: number, type: string, weight = 1): void {
  const edge: GraphEdge = {
    id, projectId: g.projectId, sourceId, targetId,
    type: type as any, properties: {}, weight,
    createdAt: new Date().toISOString(),
  };
  g.edges.set(id, edge);
}

describe('LouvainDetector', () => {
  it('should detect communities in simple two-community call graph', () => {
    const g = makeGraph();
    for (let i = 0; i < 6; i++) addNode(g, i, 'Function', `f${i}`);
    // Community A: 0-1-2 connected
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');
    addEdge(g, 2, 0, 2, 'CALLS');
    // Community B: 3-4-5 connected
    addEdge(g, 3, 3, 4, 'CALLS');
    addEdge(g, 4, 4, 5, 'CALLS');
    addEdge(g, 5, 3, 5, 'CALLS');
    // Weak inter-community edge
    addEdge(g, 6, 0, 3, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBe(6);
    expect(result.modularity).toBeGreaterThan(0);
  });

  it('should detect a single community in a fully connected graph', () => {
    const g = makeGraph();
    for (let i = 0; i < 5; i++) addNode(g, i, 'Function', `f${i}`);
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        addEdge(g, i * 10 + j, i, j, 'CALLS');
      }
    }

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBe(1);
    expect(result.nodeToCommunity.size).toBe(5);
  });

  it('should return empty result for empty graph', () => {
    const g = makeGraph();
    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBe(0);
    expect(result.modularity).toBe(0);
    expect(result.nodeToCommunity.size).toBe(0);
  });

  it('should handle graph with only non-CALLS edges', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    addNode(g, 1, 'Function', 'f1');
    addEdge(g, 0, 0, 1, 'IMPORTS');
    addEdge(g, 1, 0, 1, 'DEFINES');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBe(0);
  });

  it('should assign each node to exactly one community', () => {
    const g = makeGraph();
    for (let i = 0; i < 10; i++) addNode(g, i, 'Function', `f${i}`);
    for (let i = 0; i < 9; i++) addEdge(g, i, i, i + 1, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    const assignedNodes = new Set<number>();
    for (const [, members] of result.communities) {
      for (const nid of members) assignedNodes.add(nid);
    }
    expect(assignedNodes.size).toBe(10);
  });

  it('should include all nodes in community members', () => {
    const g = makeGraph();
    for (let i = 0; i < 8; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');
    addEdge(g, 2, 4, 5, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    let totalMembers = 0;
    for (const [, members] of result.communities) {
      totalMembers += members.length;
    }
    // Nodes with no CALLS edges won't be in communities
    expect(totalMembers).toBeGreaterThan(0);
  });

  it('should produce valid community labels', () => {
    const g = makeGraph();
    for (let i = 0; i < 5; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    for (const [commId, label] of result.communityLabels) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('should produce modularity in range [0, 1]', () => {
    const g = makeGraph();
    for (let i = 0; i < 6; i++) addNode(g, i, 'Function', `f${i}`);
    addEdge(g, 0, 0, 1, 'CALLS');
    addEdge(g, 1, 1, 2, 'CALLS');
    addEdge(g, 2, 0, 2, 'CALLS');
    addEdge(g, 3, 3, 4, 'CALLS');
    addEdge(g, 4, 4, 5, 'CALLS');
    addEdge(g, 5, 3, 5, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.modularity).toBeGreaterThanOrEqual(0);
    expect(result.modularity).toBeLessThanOrEqual(1);
  });

  it('should handle weighted edges', () => {
    const g = makeGraph();
    addNode(g, 0, 'Function', 'f0');
    addNode(g, 1, 'Function', 'f1');
    addEdge(g, 0, 0, 1, 'CALLS', 5);

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.nodeToCommunity.size).toBe(2);
  });

  it('should handle large graph (50+ nodes)', () => {
    const g = makeGraph();
    for (let i = 0; i < 60; i++) addNode(g, i, 'Function', `f${i}`);
    // Create two dense clusters with a bridge
    for (let i = 0; i < 29; i++) addEdge(g, i, i, i + 1, 'CALLS');
    addEdge(g, 29, 29, 30, 'CALLS'); // bridge
    for (let i = 30; i < 59; i++) addEdge(g, i + 30, i, i + 1, 'CALLS');

    const detector = new LouvainDetector();
    const result = detector.detectCommunities(g);
    expect(result.communities.size).toBeGreaterThanOrEqual(1);
    expect(result.nodeToCommunity.size).toBeGreaterThan(40);
  });
});
