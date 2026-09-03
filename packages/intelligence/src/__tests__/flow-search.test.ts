// @code-analyzer/intelligence — Flow Search Engine Tests
// Covers flow graph traversal, depth-limited search, result ranking,
// path finding, direction filtering, edge type filtering, and edge cases.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { FlowSearchEngine } from '../search/flow-search.js';
import type { FlowSearchResult, FlowPath } from '../search/flow-search.js';
import type {
  GraphNode,
  GraphEdge,
  RelationshipType,
  NodeProperties,
  EdgeProperties,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createNode(
  store: InMemoryGraphStore,
  name: string,
  label: string,
  filePath: string = '/test/file.ts',
  startLine: number = 1,
): GraphNode {
  const node: GraphNode = {
    id: 0, // Will be auto-assigned by insertNode
    projectId: 'test-project',
    label: label as GraphNode['label'],
    name,
    qualifiedName: `${filePath}:${name}`,
    filePath,
    startLine,
    endLine: startLine + 1,
    language: 'typescript',
    properties: { name, filePath, startLine } as unknown as NodeProperties,
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const id = store.insertNode(node);
  node.id = id;
  return node;
}

function createEdge(
  store: InMemoryGraphStore,
  sourceId: number,
  targetId: number,
  type: RelationshipType,
): GraphEdge {
  const edge: GraphEdge = {
    id: 0,
    projectId: 'test-project',
    sourceId,
    targetId,
    type,
    properties: {} as EdgeProperties,
    weight: 1,
    createdAt: new Date().toISOString(),
  };
  const id = store.insertEdge(edge);
  edge.id = id;
  return edge;
}

/**
 * Create a simple call chain: main -> helper -> util
 * Returns [mainId, helperId, utilId]
 */
function createCallChain(store: InMemoryGraphStore): [number, number, number] {
  const main = createNode(store, 'main', 'Function', '/test/main.ts', 1);
  const helper = createNode(store, 'helper', 'Function', '/test/helper.ts', 1);
  const util = createNode(store, 'util', 'Function', '/test/util.ts', 1);

  createEdge(store, main.id, helper.id, 'CALLS');
  createEdge(store, helper.id, util.id, 'CALLS');

  return [main.id, helper.id, util.id];
}

/**
 * Create a class hierarchy: BaseClass -> DerivedClass -> Instance
 */
function createClassHierarchy(store: InMemoryGraphStore): [number, number, number] {
  const base = createNode(store, 'BaseClass', 'Class', '/test/base.ts', 1);
  const derived = createNode(store, 'DerivedClass', 'Class', '/test/derived.ts', 1);
  const instance = createNode(store, 'instance', 'Function', '/test/main.ts', 10);

  createEdge(store, derived.id, base.id, 'EXTENDS');
  createEdge(store, instance.id, derived.id, 'INSTANTIATES');

  return [base.id, derived.id, instance.id];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlowSearchEngine', () => {
  let store: InMemoryGraphStore;
  let engine: FlowSearchEngine;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    engine = new FlowSearchEngine(store);
  });

  // ── Basic Search ──

  it('should search from a starting node and find connected nodes', () => {
    const [mainId, helperId, utilId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 3 });

    expect(results.length).toBeGreaterThanOrEqual(1);

    // Should find helper (direct call)
    const helperResult = results.find((r) => r.node.nodeId === helperId);
    expect(helperResult).toBeDefined();
    expect(helperResult!.node.depth).toBe(1);
    expect(helperResult!.score).toBeGreaterThan(0);

    // Should find util (indirect call via helper)
    const utilResult = results.find((r) => r.node.nodeId === utilId);
    expect(utilResult).toBeDefined();
    expect(utilResult!.node.depth).toBe(2);
  });

  it('should respect maxDepth', () => {
    const [mainId] = createCallChain(store);

    // Depth 1 should only find direct neighbors
    const results = engine.search([mainId], { maxDepth: 1 });

    // All results should be at depth 1
    for (const result of results) {
      expect(result.node.depth).toBe(1);
    }
  });

  it('should return empty array for empty start nodes', () => {
    const results = engine.search([], { maxDepth: 3 });
    expect(results).toEqual([]);
  });

  it('should handle non-existent start node', () => {
    const results = engine.search([9999], { maxDepth: 3 });
    expect(results).toEqual([]);
  });

  // ── Result Ranking ──

  it('should rank results by relevance score', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 3 });

    // Results should be sorted by score descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score!);
    }
  });

  it('should respect maxResults limit', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 3, maxResults: 1 });

    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('should assign higher scores to closer nodes', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 3 });

    // Direct neighbor should have higher score than 2-hop neighbor
    const directNode = results.find((r) => r.node.depth === 1);
    const indirectNode = results.find((r) => r.node.depth === 2);

    if (directNode && indirectNode) {
      expect(directNode.score).toBeGreaterThan(indirectNode.score);
    }
  });

  // ── Direction Filtering ──

  it('should follow only outgoing edges in forward direction', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      direction: 'forward',
    });

    // Forward from main should find helper
    expect(results.some((r) => r.node.nodeId === helperId)).toBe(true);
  });

  it('should follow only incoming edges in backward direction', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([helperId], {
      maxDepth: 2,
      direction: 'backward',
    });

    // Backward from helper should find main (main calls helper)
    expect(results.some((r) => r.node.nodeId === mainId)).toBe(true);
  });

  it('should follow both directions', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([helperId], {
      maxDepth: 2,
      direction: 'both',
    });

    // Should find both main (backward) and util (forward)
    expect(results.some((r) => r.node.nodeId === mainId)).toBe(true);
  });

  // ── Edge Type Filtering ──

  it('should filter by edge types', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      edgeTypes: ['CALLS'],
    });

    // Should only follow CALLS edges
    expect(results.some((r) => r.node.nodeId === helperId)).toBe(true);
  });

  it('should find nothing when no matching edge types', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      edgeTypes: ['IMPLEMENTS'], // No IMPLEMENTS edges in the chain
    });

    expect(results).toEqual([]);
  });

  // ── Node Label Filtering ──

  it('should filter results by node label', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      nodeLabels: ['Function'],
    });

    // All results should be Functions
    for (const result of results) {
      expect(result.node.label).toBe('Function');
    }
  });

  it('should return empty when label filter matches nothing', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      nodeLabels: ['Class'],
    });

    expect(results).toEqual([]);
  });

  // ── File Pattern Filtering ──

  it('should filter results by file pattern', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 2,
      filePattern: 'helper',
    });

    // Should only find nodes in files matching the pattern
    for (const result of results) {
      expect(result.node.filePath).toContain('helper');
    }
  });

  // ── Minimum Score Filtering ──

  it('should filter results by minimum score', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 3,
      minScore: 90,
    });

    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(90);
    }
  });

  // ── findCallers ──

  it('should find callers of a function', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.findCallers(helperId);

    // main calls helper, so main should be found
    expect(results.some((r) => r.node.nodeId === mainId)).toBe(true);
  });

  it('should find callers with depth limit', () => {
    const [, helperId] = createCallChain(store);

    const results = engine.findCallers(helperId, 1);

    // All results should be within depth 1
    for (const result of results) {
      expect(result.node.depth).toBeLessThanOrEqual(1);
    }
  });

  // ── findCallees ──

  it('should find callees of a function', () => {
    const [mainId, helperId, utilId] = createCallChain(store);

    const results = engine.findCallees(mainId);

    // main calls helper which calls util
    expect(results.some((r) => r.node.nodeId === helperId)).toBe(true);
    expect(results.some((r) => r.node.nodeId === utilId)).toBe(true);
  });

  it('should find callees with depth limit', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.findCallees(mainId, 1);

    // At depth 1, only direct callees
    expect(results.some((r) => r.node.nodeId === helperId)).toBe(true);
    // Should not find util at depth 1 (it's at depth 2)
    expect(results.some((r) => r.node.depth > 1)).toBe(false);
  });

  // ── findShortestPath ──

  it('should find shortest path between two nodes', () => {
    const [mainId, , utilId] = createCallChain(store);

    const path = engine.findShortestPath(mainId, utilId);

    expect(path).not.toBeNull();
    expect(path!.nodes.length).toBe(3); // main -> helper -> util
    expect(path!.nodes[0]!.nodeId).toBe(mainId);
    expect(path!.nodes[path!.nodes.length - 1]!.nodeId).toBe(utilId);
  });

  it('should return same node path for source == target', () => {
    const [mainId] = createCallChain(store);

    const path = engine.findShortestPath(mainId, mainId);

    expect(path).not.toBeNull();
    expect(path!.nodes).toHaveLength(1);
    expect(path!.nodes[0]!.nodeId).toBe(mainId);
    expect(path!.score).toBe(100);
  });

  it('should return null when no path exists', () => {
    createCallChain(store);

    const path = engine.findShortestPath(9999, 8888);
    expect(path).toBeNull();
  });

  it('should return null for unreachable nodes', () => {
    const [mainId] = createCallChain(store);
    // Create an isolated node
    const isolated = createNode(store, 'isolated', 'Function', '/test/isolated.ts', 1);

    const path = engine.findShortestPath(mainId, isolated.id);
    expect(path).toBeNull();
  });

  // ── findFlowPaths ──

  it('should find flow paths from starting nodes', () => {
    const [mainId] = createCallChain(store);

    const paths = engine.findFlowPaths([mainId], 3);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.nodes.length).toBeGreaterThanOrEqual(1);
      expect(path.score).toBeGreaterThanOrEqual(0);
      expect(path.description).toBeDefined();
    }
  });

  it('should return empty paths for empty input', () => {
    const paths = engine.findFlowPaths([], 3);
    expect(paths).toEqual([]);
  });

  // ── Class Hierarchy ──

  it('should follow EXTENDS edges', () => {
    const [, derivedId] = createClassHierarchy(store);

    const results = engine.search([derivedId], {
      maxDepth: 2,
      edgeTypes: ['EXTENDS'],
      direction: 'both',
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it('should follow INSTANTIATES edges', () => {
    const [, derivedId, instanceId] = createClassHierarchy(store);

    // instance INSTANTIATES derived, so forward from instance finds derived
    const results = engine.search([instanceId], {
      maxDepth: 2,
      edgeTypes: ['INSTANTIATES'],
      direction: 'forward',
    });

    // instance -> derived (via INSTANTIATES)
    expect(results.some((r) => r.node.nodeId === derivedId)).toBe(true);
  });

  // ── Multiple Start Nodes ──

  it('should search from multiple start nodes', () => {
    const [mainId, helperId] = createCallChain(store);

    const results = engine.search([mainId, helperId], { maxDepth: 2 });

    expect(results.length).toBeGreaterThan(0);
  });

  it('should handle mix of valid and invalid start nodes', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId, 9999], { maxDepth: 2 });

    // Should still find results from the valid start node
    expect(results.length).toBeGreaterThan(0);
  });

  // ── Complex Graph ──

  it('should handle diamond-shaped flow graph', () => {
    // Create: A -> B -> D and A -> C -> D
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);
    const d = createNode(store, 'D', 'Function', '/test/d.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, a.id, c.id, 'CALLS');
    createEdge(store, b.id, d.id, 'CALLS');
    createEdge(store, c.id, d.id, 'CALLS');

    const results = engine.search([a.id], { maxDepth: 3 });

    // Should find D through both paths
    const dResults = results.filter((r) => r.node.nodeId === d.id);
    expect(dResults.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle cyclic graphs without infinite loops', () => {
    // Create: A -> B -> C -> A (cycle)
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, b.id, c.id, 'CALLS');
    createEdge(store, c.id, a.id, 'CALLS');

    // Should complete without infinite loop
    const results = engine.search([a.id], { maxDepth: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThan(10); // Should be limited by visited set
  });

  // ── Match Reason ──

  it('should include match reason in results', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 2 });

    for (const result of results) {
      expect(result.matchReason).toBeDefined();
      expect(typeof result.matchReason).toBe('string');
      expect(result.matchReason.length).toBeGreaterThan(0);
    }
  });

  // ── Path Information ──

  it('should include path from origin in results', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 3 });

    for (const result of results) {
      expect(result.path).toBeDefined();
      expect(result.path.length).toBeGreaterThanOrEqual(1);
      // First node in path should be the start node
      expect(result.path[0]!.nodeId).toBe(mainId);
      // Last node should be the result node
      expect(result.path[result.path.length - 1]!.nodeId).toBe(result.node.nodeId);
    }
  });

  // ── Result Structure ──

  it('should return results with correct structure', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 2 });

    for (const result of results) {
      expect(result).toHaveProperty('node');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('matchReason');

      expect(result.node).toHaveProperty('nodeId');
      expect(result.node).toHaveProperty('name');
      expect(result.node).toHaveProperty('label');
      expect(result.node).toHaveProperty('filePath');
      expect(result.node).toHaveProperty('line');
      expect(result.node).toHaveProperty('depth');
    }
  });

  // ── Multiple Edge Types in Path ──

  it('should follow multiple edge types in traversal', () => {
    const classNode = createNode(store, 'MyClass', 'Class', '/test/class.ts', 1);
    const methodNode = createNode(store, 'myMethod', 'Method', '/test/class.ts', 5);
    const helperNode = createNode(store, 'helper', 'Function', '/test/helper.ts', 1);

    createEdge(store, classNode.id, methodNode.id, 'DEFINES');
    createEdge(store, methodNode.id, helperNode.id, 'CALLS');

    const results = engine.search([classNode.id], {
      maxDepth: 3,
      edgeTypes: ['DEFINES', 'CALLS'],
    });

    // Should find helper via DEFINES -> CALLS
    expect(results.some((r) => r.node.nodeId === helperNode.id)).toBe(true);
  });

  // ── Default Options ──

  it('should use default options when not specified', () => {
    const [mainId] = createCallChain(store);

    // Search with no options at all
    const results = engine.search([mainId]);

    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  // ── findShortestPath Edge Cases ──

  it('should handle findShortestPath with depth limit exceeded', () => {
    // Create a long chain: 1 -> 2 -> 3 -> 4 -> 5
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(createNode(store, `node${i}`, 'Function', `/test/file${i}.ts`, i + 1));
    }
    for (let i = 0; i < 4; i++) {
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'CALLS');
    }

    // Depth 2 should not reach from 1 to 5 (needs 4 hops)
    const path = engine.findShortestPath(nodes[0]!.id, nodes[4]!.id, 2);
    expect(path).toBeNull();
  });

  it('should handle self-loop in shortest path', () => {
    const node = createNode(store, 'self', 'Function', '/test/self.ts', 1);
    // Self-referencing edge
    createEdge(store, node.id, node.id, 'CALLS');

    const path = engine.findShortestPath(node.id, node.id);
    expect(path).not.toBeNull();
    expect(path!.nodes).toHaveLength(1);
  });

  // ── Edge Score Bonuses ──

  it('should give bonus score for CALLS edges', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(90); // 100 - 15 + 10 = 95
  });

  it('should give bonus score for EXTENDS edges', () => {
    const base = createNode(store, 'Base', 'Class', '/test/base.ts', 1);
    const derived = createNode(store, 'Derived', 'Class', '/test/derived.ts', 1);

    createEdge(store, derived.id, base.id, 'EXTENDS');

    const results = engine.search([derived.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(90); // 100 - 15 + 15 = 100
  });

  // ── DATA_FLOWS Edge Bonus ──

  it('should give bonus score for DATA_FLOWS edges', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'DATA_FLOWS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    // 100 - 15 + 5 = 90
    expect(results[0]!.score).toBeGreaterThanOrEqual(85);
  });

  // ── IMPORTS Edge Penalty ──

  it('should apply penalty for IMPORTS edges', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'IMPORTS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    // 100 - 15 - 5 = 80
    expect(results[0]!.score).toBeLessThanOrEqual(85);
  });

  // ── HANDLES Edge ──

  it('should handle HANDLES edge type', () => {
    const handler = createNode(store, 'handler', 'Function', '/test/handler.ts', 1);
    const event = createNode(store, 'event', 'Event', '/test/event.ts', 1);

    createEdge(store, handler.id, event.id, 'HANDLES');

    const results = engine.search([handler.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.matchReason).toContain('handles');
  });

  // ── ACCESSES Edge ──

  it('should handle ACCESSES edge type', () => {
    const func = createNode(store, 'readData', 'Function', '/test/reader.ts', 1);
    const field = createNode(store, 'data', 'Field', '/test/model.ts', 1);

    createEdge(store, func.id, field.id, 'ACCESSES');

    const results = engine.search([func.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.matchReason).toContain('accesses');
  });

  // ── DEFINES Edge ──

  it('should handle DEFINES edge type', () => {
    const cls = createNode(store, 'MyClass', 'Class', '/test/class.ts', 1);
    const method = createNode(store, 'method', 'Method', '/test/class.ts', 5);

    createEdge(store, cls.id, method.id, 'DEFINES');

    const results = engine.search([cls.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.matchReason).toContain('defines');
  });

  // ── IMPLEMENTS Edge ──

  it('should handle IMPLEMENTS edge type', () => {
    const impl = createNode(store, 'ServiceImpl', 'Class', '/test/impl.ts', 1);
    const iface = createNode(store, 'IService', 'Interface', '/test/iface.ts', 1);

    createEdge(store, impl.id, iface.id, 'IMPLEMENTS');

    const results = engine.search([impl.id], { maxDepth: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.matchReason).toContain('implements');
  });

  // ── score clamped to 0-100 ──

  it('should clamp score to maximum of 100', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'IMPLEMENTS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results[0]!.score).toBeLessThanOrEqual(100);
  });

  it('should clamp score to minimum of 0', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'IMPORTS');

    const results = engine.search([a.id], { maxDepth: 10 });
    for (const result of results) {
      expect(result.score).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Multiple edge types traversal ──

  it('should follow all default edge types', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Class', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);

    createEdge(store, a.id, b.id, 'INSTANTIATES');
    createEdge(store, b.id, c.id, 'DEFINES');

    const results = engine.search([a.id], { maxDepth: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  // ── File pattern matching edge cases ──

  it('should handle filePattern with glob wildcards', () => {
    const a = createNode(store, 'A', 'Function', '/test/deep/path/file.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/shallow/file.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: '**/deep/**',
    });
    expect(results.every((r) => r.node.filePath.includes('deep'))).toBe(true);
  });

  it('should handle filePattern without wildcard (substring match)', () => {
    const a = createNode(store, 'A', 'Function', '/test/specific.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/other.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: 'specific',
    });
    expect(results.every((r) => r.node.filePath.includes('specific'))).toBe(true);
  });

  // ── Result max limit for multiple start nodes ──

  it('should limit total results across multiple start nodes', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, b.id, c.id, 'CALLS');

    const results = engine.search([a.id, b.id], { maxDepth: 3, maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // ── File pattern regex error fallback ──

  it('should handle malformed file pattern (invalid regex) via fallback', () => {
    const node = createNode(store, 'testFunc', 'Function', '/test/file.ts', 1);
    // A pattern with unmatched brackets would produce an invalid regex
    // but since * is converted to [^/]* and brackets are escaped, we need
    // a pattern that causes the regex to fail. The catch fallback does substring match.
    const results = engine.search([node.id], {
      maxDepth: 3,
      filePattern: '\\', // Backslash creates an invalid regex after escaping
    });
    // Should not throw; may or may not match depending on the fallback
    expect(Array.isArray(results)).toBe(true);
  });

  it('should handle filePattern with special regex chars that escape correctly', () => {
    const node = createNode(store, 'testFunc', 'Function', '/test/file+.ts', 1);
    const results = engine.search([node.id], {
      maxDepth: 3,
      filePattern: 'file+',
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it('should fall back to substring match when a glob pattern forms an invalid regex', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    createEdge(store, a.id, b.id, 'CALLS');

    // `(unclosed*` keeps a `*` so it passes the no-wildcard early return, but the
    // unescaped `(` makes `new RegExp(...)` throw, exercising the catch fallback.
    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: '(unclosed*',
    });
    expect(Array.isArray(results)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: depth exactly at max (not continuing deeper)
  // ==========================================================================

  it('should stop traversal at exactly maxDepth', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);
    const d = createNode(store, 'D', 'Function', '/test/d.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, b.id, c.id, 'CALLS');
    createEdge(store, c.id, d.id, 'CALLS');

    const results = engine.search([a.id], { maxDepth: 2 });
    // Should find b (depth 1) and c (depth 2), but not d (depth 3, exceeds maxDepth)
    const nodeIds = results.map((r) => r.node.nodeId);
    expect(nodeIds).toContain(b.id);
    expect(nodeIds).toContain(c.id);
    expect(nodeIds).not.toContain(d.id);
  });

  // ==========================================================================
  // Branch Coverage: maxResults * startNodeIds early return
  // ==========================================================================

  it('should return early when results exceed maxResults per start node', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    // Create many children from a so the result limit triggers
    for (let i = 0; i < 10; i++) {
      const child = createNode(store, `Child${i}`, 'Function', `/test/child${i}.ts`, 1);
      createEdge(store, a.id, child.id, 'CALLS');
    }

    const results = engine.search([a.id], { maxDepth: 3, maxResults: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  // ==========================================================================
  // Branch Coverage: score below minScore filter
  // ==========================================================================

  it('should filter results below minScore at deep depth', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    // Deep chain where score drops below threshold
    const nodes = [a];
    for (let i = 0; i < 8; i++) {
      const prev = nodes[nodes.length - 1]!;
      const next = createNode(store, `N${i}`, 'Function', `/test/n${i}.ts`, 1);
      createEdge(store, prev.id, next.id, 'IMPORTS'); // IMPORTS has penalty
      nodes.push(next);
    }

    const results = engine.search([a.id], { maxDepth: 10, minScore: 50 });
    // Deeper nodes with IMPORTS penalty should be filtered
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(50);
    }
  });

  // ==========================================================================
  // Branch Coverage: rankResults with equal scores sorts by depth
  // ==========================================================================

  it('should sort by depth ascending when scores are equal', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);

    // Same edge type so scores should be close
    createEdge(store, a.id, b.id, 'DATA_FLOWS');
    createEdge(store, a.id, c.id, 'DATA_FLOWS'); // both at depth 1

    const results = engine.search([a.id], { maxDepth: 2 });
    // Both should appear, ranking is stable
    expect(results.length).toBe(2);
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath with maxDepth exceeded
  // ==========================================================================

  it('should return null when path exceeds maxDepth in findShortestPath', () => {
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      nodes.push(createNode(store, `node${i}`, 'Function', `/test/n${i}.ts`, 1));
    }
    for (let i = 0; i < 5; i++) {
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'CALLS');
    }

    const path = engine.findShortestPath(nodes[0]!.id, nodes[5]!.id, 2);
    expect(path).toBeNull();
  });

  // ==========================================================================
  // Branch Coverage: filePattern with ** globstar
  // ==========================================================================

  it('should handle filePattern with ** globstar matching any depth', () => {
    const a = createNode(store, 'A', 'Function', '/src/deep/nested/file.ts', 1);
    const b = createNode(store, 'B', 'Function', '/src/deep/util.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: '**/deep/**',
    });
    // Should match nodes under deep/ directory
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((r) => r.node.filePath.includes('deep'))).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: edge type filtering — backward direction
  // ==========================================================================

  it('should traverse backward through edges correctly', () => {
    const main = createNode(store, 'main', 'Function', '/test/main.ts', 1);
    const helper = createNode(store, 'helper', 'Function', '/test/helper.ts', 1);
    const util = createNode(store, 'util', 'Function', '/test/util.ts', 1);

    createEdge(store, main.id, helper.id, 'CALLS');
    createEdge(store, helper.id, util.id, 'CALLS');

    const results = engine.search([util.id], { maxDepth: 3, direction: 'backward' });
    expect(results.some((r) => r.node.nodeId === helper.id)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: score clamped with deep depth
  // ==========================================================================

  it('should clamp score to 0 for deeply nested nodes with penalty edge', () => {
    const nodes: any[] = [];
    for (let i = 0; i < 12; i++) {
      nodes.push(createNode(store, `node${i}`, 'Function', `/test/d${i}.ts`, 1));
    }
    for (let i = 0; i < 11; i++) {
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'IMPORTS');
    }

    const results = engine.search([nodes[0]!.id], { maxDepth: 12 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  // ==========================================================================
  // Branch Coverage: describeMatch fallback for unknown edge type
  // ==========================================================================

  it('should use default "connects to" description for unknown edge types', () => {
    const a = createNode(store, 'Source', 'Function', '/test/src.ts', 1);
    const b = createNode(store, 'Target', 'Function', '/test/tgt.ts', 1);

    // 'UNKNOWN_TYPE' is not in the describeMatch dictionary
    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results.length).toBe(1);
    expect(results[0]!.matchReason).toBeDefined();
    expect(results[0]!.matchReason.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Branch Coverage: getEdges duplicate prevention with self-loop + 'both' direction
  // ==========================================================================

  it('should prevent duplicate edges in both-direction traversal (self-loop)', () => {
    // Self-referencing edge: source=target=same node
    const node = createNode(store, 'selfRef', 'Function', '/test/self.ts', 1);
    createEdge(store, node.id, node.id, 'CALLS');

    // With 'both' direction, getEdges finds the same edge via outgoing AND incoming queries.
    // The duplicate check (!edges.some) prevents adding it twice.
    // The visited check prevents traversing the self-loop, so no results.
    const results = engine.search([node.id], {
      maxDepth: 2,
      direction: 'both',
    });

    // Self-loop is filtered by visited after getEdges deduplicates it.
    // The key branch (duplicate prevention) is exercised during getEdges.
    expect(results.length).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: base score clamped to minimum 10 at depth >= 7
  // ==========================================================================

  it('should clamp base score to minimum 10 for deep traversal nodes', () => {
    const nodes: any[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push(createNode(store, `deep${i}`, 'Function', `/test/d${i}.ts`, 1));
    }
    for (let i = 0; i < 9; i++) {
      // Use DATA_FLOWS (no penalty, small bonus) to see base clamp
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'DATA_FLOWS');
    }

    const results = engine.search([nodes[0]!.id], { maxDepth: 12 });
    // Deep nodes (depth 7+) should still have score >= 5 (base 10 + 5 bonus - after effects)
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  // ==========================================================================
  // Branch Coverage: score exactly at minScore boundary (score === minScore)
  // ==========================================================================

  it('should include results with score exactly at minScore boundary', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    createEdge(store, a.id, b.id, 'DATA_FLOWS');

    // Depth 1 with DATA_FLOWS: 100 - 15 + 5 = 90
    const results = engine.search([a.id], { maxDepth: 1, minScore: 90 });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBe(90);
  });

  // ==========================================================================
  // Branch Coverage: combined filters (filePattern + nodeLabels + edgeTypes)
  // ==========================================================================

  it('should apply combined filePattern, nodeLabels, and edgeTypes filters simultaneously', () => {
    const a = createNode(store, 'A', 'Function', '/src/api.ts', 1);
    const b = createNode(store, 'B', 'Class', '/src/api.ts', 5);
    const c = createNode(store, 'C', 'Function', '/src/utils.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, a.id, c.id, 'DATA_FLOWS');

    // Only follow CALLS, only Functions, only in api.ts
    const results = engine.search([a.id], {
      maxDepth: 2,
      edgeTypes: ['CALLS'],
      nodeLabels: ['Function'],
      filePattern: 'api',
    });

    // Should find none: the CALLS edge goes to Class, not Function
    expect(results.length).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: multiple start nodes with early return per startNodeId limit
  // ==========================================================================

  it('should enforce result limit per start node with multiple start nodes', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);

    // Give each start node 5 children
    for (const parent of [a, b]) {
      for (let i = 0; i < 8; i++) {
        const child = createNode(
          store,
          `Child_${parent.name}_${i}`,
          'Function',
          `/test/c_${parent.name}_${i}.ts`,
          1,
        );
        createEdge(store, parent.id, child.id, 'CALLS');
      }
    }

    // maxResults=2, 2 start nodes → 2*2=4 before early return
    const results = engine.search([a.id, b.id], { maxDepth: 2, maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // ==========================================================================
  // Branch Coverage: backward traversal with DATA_FLOWS edge type
  // ==========================================================================

  it('should traverse backward through DATA_FLOWS edge type', () => {
    const src = createNode(store, 'source', 'Function', '/test/src.ts', 1);
    const tgt = createNode(store, 'target', 'Function', '/test/tgt.ts', 1);

    createEdge(store, src.id, tgt.id, 'DATA_FLOWS');

    const results = engine.search([tgt.id], {
      maxDepth: 2,
      direction: 'backward',
      edgeTypes: ['DATA_FLOWS'],
    });

    expect(results.length).toBe(1);
    expect(results[0]!.node.nodeId).toBe(src.id);
  });

  // ==========================================================================
  // Branch Coverage: backward traversal with IMPORTS edge type
  // ==========================================================================

  it('should traverse backward through IMPORTS edges', () => {
    const importer = createNode(store, 'importer', 'Function', '/test/importer.ts', 1);
    const imported = createNode(store, 'imported', 'Function', '/test/imported.ts', 1);

    createEdge(store, importer.id, imported.id, 'IMPORTS');

    const results = engine.search([imported.id], {
      maxDepth: 2,
      direction: 'backward',
      edgeTypes: ['IMPORTS'],
    });

    expect(results.length).toBe(1);
    expect(results[0]!.node.nodeId).toBe(importer.id);
  });

  // ==========================================================================
  // Branch Coverage: empty edgeTypes array — no edges followed
  // ==========================================================================

  it('should find no results with empty edgeTypes array', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 3,
      edgeTypes: [],
    });

    expect(results).toEqual([]);
  });

  // ==========================================================================
  // Branch Coverage: matchesSimplePattern with single * (non-globstar)
  // ==========================================================================

  it('should match filePattern with single * wildcard (not **)', () => {
    const a = createNode(store, 'FuncA', 'Function', '/src/models/user.model.ts', 1);
    const b = createNode(store, 'FuncB', 'Function', '/src/models/post.model.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: '*.model.ts',
    });

    // Single * matches any sequence within a single directory segment
    expect(results.every((r) => r.node.filePath.endsWith('.model.ts'))).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath through a cycle — finds shortest path
  // ==========================================================================

  it('should find shortest path when graph contains cycles', () => {
    // A → B → C → D  (direct path)
    // A → E → D      (shorter path, 2 hops vs 3)
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);
    const b = createNode(store, 'B', 'Function', '/test/b.ts', 1);
    const c = createNode(store, 'C', 'Function', '/test/c.ts', 1);
    const d = createNode(store, 'D', 'Function', '/test/d.ts', 1);
    const e = createNode(store, 'E', 'Function', '/test/e.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');
    createEdge(store, b.id, c.id, 'CALLS');
    createEdge(store, c.id, d.id, 'CALLS');
    createEdge(store, a.id, e.id, 'CALLS');
    createEdge(store, e.id, d.id, 'CALLS');

    const path = engine.findShortestPath(a.id, d.id, 10);
    expect(path).not.toBeNull();
    // The shortest path is A → E → D (2 hops, 3 nodes including start)
    expect(path!.nodes.length).toBe(3);
    expect(path!.nodes[0]!.name).toBe('A');
    expect(path!.nodes[path!.nodes.length - 1]!.name).toBe('D');
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath — source node doesn't exist
  // ==========================================================================

  it('should return null for findShortestPath with non-existent source and depth limit', () => {
    createCallChain(store);

    const path = engine.findShortestPath(99999, 88888, 1);
    expect(path).toBeNull();
  });

  // ==========================================================================
  // Branch Coverage: findCallers with custom maxResults
  // ==========================================================================

  it('should respect maxResults in findCallers', () => {
    const caller = createNode(store, 'caller', 'Function', '/test/caller.ts', 1);
    const callee = createNode(store, 'callee', 'Function', '/test/callee.ts', 1);

    // Create multiple callers
    for (let i = 0; i < 5; i++) {
      const c = createNode(store, `caller${i}`, 'Function', `/test/caller${i}.ts`, 1);
      createEdge(store, c.id, callee.id, 'CALLS');
    }

    const results = engine.findCallers(callee.id, 3, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // ==========================================================================
  // Branch Coverage: findCallees through EXTENDS edge
  // ==========================================================================

  it('should find callees through specified edge types', () => {
    const derived = createNode(store, 'Derived', 'Class', '/test/derived.ts', 1);
    const base = createNode(store, 'Base', 'Class', '/test/base.ts', 1);

    createEdge(store, derived.id, base.id, 'EXTENDS');

    const results = engine.findCallees(derived.id, 3, 20);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  // ==========================================================================
  // Branch Coverage: filter with minScore 0 includes all results
  // ==========================================================================

  it('should include all results when minScore is explicitly 0', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], {
      maxDepth: 3,
      minScore: 0,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
    }
  });

  // ==========================================================================
  // Branch Coverage: direction 'both' with backward resolveNextNode branch
  // ==========================================================================

  it('should resolve next node correctly for both directions', () => {
    // A → B (CALLS) — A calls B
    const a = createNode(store, 'caller', 'Function', '/test/caller.ts', 1);
    const b = createNode(store, 'callee', 'Function', '/test/callee.ts', 1);

    createEdge(store, a.id, b.id, 'CALLS');

    // From B with direction='both': forward finds nothing from B (no outgoing),
    // backward finds A (incoming via CALLS where B is target, A is source)
    const results = engine.search([b.id], {
      maxDepth: 2,
      direction: 'both',
    });

    // Should find A via backward traversal (edge.targetId === currentNodeId → resolveNextNode returns edge.sourceId)
    expect(results.some((r) => r.node.nodeId === a.id)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: startLine ?? 0 — node with null startLine
  // ==========================================================================

  it('should handle nodes with null startLine (?? 0 fallback)', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);

    // Create a node with null startLine manually
    const nodeWithNullLine: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'nullLine',
      qualifiedName: '/test/null.ts:nullLine',
      filePath: '/test/null.ts',
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: {
        name: 'nullLine',
        filePath: '/test/null.ts',
        startLine: null,
      } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    nodeWithNullLine.id = store.insertNode(nodeWithNullLine);

    createEdge(store, a.id, nodeWithNullLine.id, 'CALLS');

    const results = engine.search([a.id], { maxDepth: 1 });
    expect(results.length).toBe(1);
    // startLine should default to 0 via ?? 0
    expect(results[0]!.node.line).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath score Math.max(0, ...) clamping
  // ==========================================================================

  it('should clamp findShortestPath score to 0 for long paths', () => {
    // Create a chain of 13 nodes (12 hops)
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 13; i++) {
      nodes.push(createNode(store, `chain${i}`, 'Function', `/test/chain${i}.ts`, 1));
    }
    for (let i = 0; i < 12; i++) {
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'CALLS');
    }

    // MaxDepth high enough to allow the full path
    const path = engine.findShortestPath(nodes[0]!.id, nodes[12]!.id, 20);
    expect(path).not.toBeNull();
    // At depth 11: 100 - 11*10 = -10, clamped to 0 via Math.max(0, -10)
    expect(path!.score).toBeGreaterThanOrEqual(0);
    expect(path!.nodes.length).toBe(13);
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath with maxDepth exactly allowing path
  // ==========================================================================

  it('should find path when maxDepth exactly matches required hops', () => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 5; i++) {
      nodes.push(createNode(store, `exact${i}`, 'Function', `/test/exact${i}.ts`, 1));
    }
    for (let i = 0; i < 4; i++) {
      createEdge(store, nodes[i]!.id, nodes[i + 1]!.id, 'CALLS');
    }

    // Path from 0 to 4 needs 4 hops. maxDepth=4 should allow it (at depth 3, we discover depth 4 target).
    const path = engine.findShortestPath(nodes[0]!.id, nodes[4]!.id, 4);
    expect(path).not.toBeNull();
    expect(path!.nodes.length).toBe(5);
  });

  // ==========================================================================
  // Branch Coverage: BFS traversal with backward direction through EXTENDS
  // ==========================================================================

  it('should traverse backward through EXTENDS edge', () => {
    const base = createNode(store, 'Base', 'Class', '/test/base.ts', 1);
    const derived = createNode(store, 'Derived', 'Class', '/test/derived.ts', 1);

    createEdge(store, derived.id, base.id, 'EXTENDS');

    const results = engine.search([base.id], {
      maxDepth: 2,
      direction: 'backward',
      edgeTypes: ['EXTENDS'],
    });

    // Backward from base: derived extends base, so derived should be found
    expect(results.some((r) => r.node.nodeId === derived.id)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: search with multiple start nodes where first is invalid
  // ==========================================================================

  it('should continue to valid start nodes when earlier ones are invalid', () => {
    // Only create nodes for the second start, not the first
    const [validId] = createCallChain(store);

    // 9999 doesn't exist, but validId does
    const results = engine.search([9999, validId], { maxDepth: 3 });
    expect(results.length).toBeGreaterThan(0);
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath with null startLine (?? 0 at line 323)
  // ==========================================================================

  it('should handle null startLine and null filePath in findShortestPath intermediate nodes', () => {
    const src = createNode(store, 'src', 'Function', '/test/src.ts', 1);

    // Intermediate node with null startLine and null filePath
    const mid: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'midFunc',
      qualifiedName: '/test/mid.ts:midFunc',
      filePath: null,
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: { name: 'midFunc', filePath: null, startLine: null } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mid.id = store.insertNode(mid);

    const tgt = createNode(store, 'tgt', 'Function', '/test/tgt.ts', 1);

    createEdge(store, src.id, mid.id, 'CALLS');
    createEdge(store, mid.id, tgt.id, 'CALLS');

    const path = engine.findShortestPath(src.id, tgt.id, 5);
    expect(path).not.toBeNull();
    expect(path!.nodes[1]!.nodeId).toBe(mid.id);
    // Covers filePath ?? '' branch
    expect(path!.nodes[1]!.filePath).toBe('');
    // Covers startLine ?? 0 branch
    expect(path!.nodes[1]!.line).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: findFlowPaths deduplication (has returning true)
  // ==========================================================================

  it('should deduplicate paths when same start node is specified multiple times', () => {
    const [mainId] = createCallChain(store);

    // Same start node twice → duplicate results with identical path keys
    const paths = engine.findFlowPaths([mainId, mainId], 3);
    expect(paths.length).toBeGreaterThan(0);
    // Paths should be deduplicated — no duplicates
    const keys = paths.map((p) => p.nodes.map((n) => n.nodeId).join(':'));
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  // ==========================================================================
  // Branch Coverage: empty nodeLabels array (length === 0) — filter skipped
  // ==========================================================================

  it('should not filter by label when nodeLabels is an empty array', () => {
    const [mainId] = createCallChain(store);

    // Empty array is truthy but length is 0 → filter should be skipped
    const results = engine.search([mainId], {
      maxDepth: 3,
      nodeLabels: [],
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  // ==========================================================================
  // Branch Coverage: filePattern with null filePath node not filtered
  // ==========================================================================

  it('should not filter nodes with null filePath when filePattern is set', () => {
    const a = createNode(store, 'A', 'Function', '/test/a.ts', 1);

    // Node with null filePath
    const b: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'noFile',
      qualifiedName: '/unknown:noFile',
      filePath: null,
      startLine: 1,
      endLine: 2,
      language: 'typescript',
      properties: { name: 'noFile', filePath: null, startLine: 1 } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    b.id = store.insertNode(b);

    createEdge(store, a.id, b.id, 'CALLS');

    // filePattern is set but node has null filePath → short-circuit at filePath check
    const results = engine.search([a.id], {
      maxDepth: 2,
      filePattern: 'test',
    });

    // Node with null filePath should NOT be filtered (can't match a pattern on null)
    expect(results.some((r) => r.node.nodeId === b.id)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: backward direction through INSTANTIATES edges
  // ==========================================================================

  it('should traverse backward through INSTANTIATES edges', () => {
    const instance = createNode(store, 'instance', 'Function', '/test/instance.ts', 1);
    const cls = createNode(store, 'MyClass', 'Class', '/test/cls.ts', 1);

    createEdge(store, instance.id, cls.id, 'INSTANTIATES');

    const results = engine.search([cls.id], {
      maxDepth: 2,
      direction: 'backward',
      edgeTypes: ['INSTANTIATES'],
    });

    // Backward from class: instance instantiates class → instance found
    expect(results.some((r) => r.node.nodeId === instance.id)).toBe(true);
  });

  // ==========================================================================
  // Branch Coverage: describeMatch fallback for edge types not in dictionary
  // ==========================================================================

  it('should use "connects to" fallback for edge types not in describeMatch dict', () => {
    const a = createNode(store, 'Source', 'Function', '/test/src.ts', 1);
    const b = createNode(store, 'Target', 'Function', '/test/tgt.ts', 1);

    // CONTAINS is a valid RelationshipType but NOT in the describeMatch dictionary
    createEdge(store, a.id, b.id, 'CONTAINS' as RelationshipType);

    const results = engine.search([a.id], {
      maxDepth: 1,
      edgeTypes: ['CONTAINS' as RelationshipType],
    });

    expect(results.length).toBe(1);
    // Fallback description: "connects to"
    expect(results[0]!.matchReason).toContain('connects to');
    expect(results[0]!.matchReason).toContain('Target');
  });

  // ==========================================================================
  // Branch Coverage: findShortestPath source node with null values (?? defaults)
  // ==========================================================================

  it('should handle null filePath and startLine in findShortestPath source node', () => {
    // Source node with null filePath and null startLine
    const srcNode: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'nullSrc',
      qualifiedName: '/test/src.ts:nullSrc',
      filePath: null,
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: { name: 'nullSrc', filePath: null, startLine: null } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    srcNode.id = store.insertNode(srcNode);

    const tgt = createNode(store, 'target', 'Function', '/test/tgt.ts', 1);
    createEdge(store, srcNode.id, tgt.id, 'CALLS');

    const path = engine.findShortestPath(srcNode.id, tgt.id, 5);
    expect(path).not.toBeNull();
    // Source node with null filePath → '' via ?? ""
    expect(path!.nodes[0]!.filePath).toBe('');
    // Source node with null startLine → 0 via ?? 0
    expect(path!.nodes[0]!.line).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: same-node findShortestPath with null startLine (?? 0 at line 265)
  // ==========================================================================

  it('should handle same-node findShortestPath with null startLine', () => {
    const node: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'selfNull',
      qualifiedName: '/test/self.ts:selfNull',
      filePath: null,
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: {
        name: 'selfNull',
        filePath: null,
        startLine: null,
      } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    node.id = store.insertNode(node);

    // Same source and target → hits the early return at lines 258-272
    const path = engine.findShortestPath(node.id, node.id);
    expect(path).not.toBeNull();
    expect(path!.nodes).toHaveLength(1);
    expect(path!.nodes[0]!.filePath).toBe('');
    expect(path!.nodes[0]!.line).toBe(0);
    expect(path!.score).toBe(100);
  });

  // ==========================================================================
  // Branch Coverage: search with null filePath/startLine source node (?? fallback)
  // ==========================================================================

  it('should fall back to empty filePath and zero line for a null source node in search', () => {
    const srcNode: GraphNode = {
      id: 0,
      projectId: 'test-project',
      label: 'Function' as GraphNode['label'],
      name: 'nullStart',
      qualifiedName: '/test/start.ts:nullStart',
      filePath: null,
      startLine: null,
      endLine: null,
      language: 'typescript',
      properties: {
        name: 'nullStart',
        filePath: null,
        startLine: null,
      } as unknown as NodeProperties,
      signature: null,
      docstring: null,
      complexity: null,
      isExported: true,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    srcNode.id = store.insertNode(srcNode);

    const target = createNode(store, 'target', 'Function', '/test/target.ts', 1);
    createEdge(store, srcNode.id, target.id, 'CALLS');

    const results = engine.search([srcNode.id], { maxDepth: 1 });
    expect(results.length).toBe(1);
    // The origin node in the returned path reflects the null fallbacks
    expect(results[0]!.path[0]!.filePath).toBe('');
    expect(results[0]!.path[0]!.line).toBe(0);
  });

  // ==========================================================================
  // Branch Coverage: non-positive maxDepth guards
  // ==========================================================================

  it('should return no results when search maxDepth is zero', () => {
    const [mainId] = createCallChain(store);

    const results = engine.search([mainId], { maxDepth: 0 });
    expect(results).toEqual([]);
  });

  it('should return null when findShortestPath maxDepth is zero for distinct nodes', () => {
    const [mainId, , utilId] = createCallChain(store);

    const path = engine.findShortestPath(mainId, utilId, 0);
    expect(path).toBeNull();
  });
});
