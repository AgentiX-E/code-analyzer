// @code-analyzer/infra — Graph Index Tests

import { describe, it, expect } from 'vitest';
import { NodeIndex, EdgeIndex } from '../storage/graph-index.js';
import type { GraphNode, NodeLabel, GraphEdge, RelationshipType } from '@code-analyzer/shared';

function node(id: number, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: 'Function' as NodeLabel,
    name: `fn_${id}`,
    qualifiedName: `mod::fn_${id}`,
    projectId: 'test/proj',
    filePath: `src/file_${id}.ts`,
    startLine: id,
    endLine: id + 3,
    complexity: 5,
    isExported: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

describe('NodeIndex', () => {
  describe('add', () => {
    it('should add a single node', () => {
      const idx = new NodeIndex();
      idx.add(node(1));
      expect(idx.has(1)).toBe(true);
      expect(idx.getStats().totalNodes).toBe(1);
    });

    it('should add multiple nodes', () => {
      const idx = new NodeIndex();
      idx.add(node(1));
      idx.add(node(2));
      idx.add(node(3));
      expect(idx.getStats().totalNodes).toBe(3);
    });
  });

  describe('addBatch', () => {
    it('should add a batch of nodes', () => {
      const idx = new NodeIndex();
      const nodes = [node(1), node(2), node(3)];
      idx.addBatch(nodes);
      expect(idx.getStats().totalNodes).toBe(3);
    });
  });

  describe('findByName', () => {
    it('should find nodes by exact name', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'UserService' }));
      idx.add(node(2, { name: 'AuthService' }));
      const results = idx.findByName('UserService');
      expect(results).toHaveLength(1);
      expect(results[0]!.name).toBe('UserService');
    });

    it('should find nodes by name case-insensitively', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'UserService' }));
      const results = idx.findByName('userservice');
      expect(results).toHaveLength(1);
    });

    it('should return empty for non-existent name', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'UserService' }));
      expect(idx.findByName('NonExistent')).toEqual([]);
    });

    it('should deduplicate exact and case-insensitive matches', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'test' }));
      idx.add(node(2, { name: 'TEST' }));
      const results = idx.findByName('test');
      expect(results.length).toBe(2);
    });
  });

  describe('findByLabel', () => {
    it('should find nodes by label', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { label: 'Class' as NodeLabel }));
      idx.add(node(2, { label: 'Function' as NodeLabel }));
      const results = idx.findByLabel('Class');
      expect(results).toHaveLength(1);
      expect(results[0]!.label).toBe('Class');
    });

    it('should return empty for non-existent label', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { label: 'Function' as NodeLabel }));
      expect(idx.findByLabel('NonExistent')).toEqual([]);
    });
  });

  describe('findByProject', () => {
    it('should find nodes by project', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { projectId: 'org/A' }));
      idx.add(node(2, { projectId: 'org/B' }));
      const results = idx.findByProject('org/A');
      expect(results).toHaveLength(1);
    });

    it('should handle nodes without projectId', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { projectId: undefined as unknown as string }));
      expect(idx.findByProject('missing')).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should remove a node from all indexes', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'UserService', label: 'Class' as NodeLabel }));
      idx.remove(1);
      expect(idx.has(1)).toBe(false);
      expect(idx.findByName('UserService')).toEqual([]);
      expect(idx.findByLabel('Class')).toEqual([]);
    });

    it('should handle removing non-existent node', () => {
      const idx = new NodeIndex();
      idx.add(node(1));
      idx.remove(999);
      expect(idx.has(1)).toBe(true);
    });

    it('should clean up empty index entries', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'Only' }));
      idx.remove(1);
      const stats = idx.getStats();
      expect(stats.totalNodes).toBe(0);
    });
  });

  describe('clear', () => {
    it('should clear all indexes', () => {
      const idx = new NodeIndex();
      idx.add(node(1));
      idx.add(node(2));
      idx.clear();
      expect(idx.getStats().totalNodes).toBe(0);
      expect(idx.has(1)).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return accurate stats', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: 'A', label: 'Class' as NodeLabel }));
      idx.add(node(2, { name: 'B', label: 'Function' as NodeLabel }));
      const stats = idx.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.uniqueLabels).toBe(2);
      expect(stats.uniqueNames).toBeGreaterThanOrEqual(1);
      expect(stats.uniqueProjects).toBe(1);
    });
  });

  describe('bulkAdd', () => {
    it('adds a batch of nodes', () => {
      const idx = new NodeIndex();
      idx.bulkAdd([node(1), node(2)]);
      expect(idx.getStats().totalNodes).toBe(2);
    });
  });

  describe('allIds', () => {
    it('returns all known node IDs', () => {
      const idx = new NodeIndex();
      idx.bulkAdd([node(7), node(9)]);
      expect(idx.allIds.sort((a, b) => a - b)).toEqual([7, 9]);
    });
  });

  describe('size getter', () => {
    it('reflects the current indexed node count', () => {
      const idx = new NodeIndex();
      expect(idx.size).toBe(0);
      idx.add(node(1));
      expect(idx.size).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle node without name', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { name: '' }));
      expect(idx.has(1)).toBe(true);
    });

    it('should handle node without label', () => {
      const idx = new NodeIndex();
      idx.add(node(1, { label: '' as NodeLabel }));
      expect(idx.has(1)).toBe(true);
    });

    it('should handle duplicate node IDs gracefully', () => {
      const idx = new NodeIndex();
      idx.add(node(1));
      idx.add(node(1, { name: 'Updated' })); // Same ID, different name
      // The second add overwrites in byId but appends to list indexes
      expect(idx.has(1)).toBe(true);
    });

    it('should maintain consistency after mixed operations', () => {
      const idx = new NodeIndex();
      idx.addBatch([node(1), node(2), node(3), node(4), node(5)]);
      idx.remove(2);
      idx.remove(4);
      idx.add(node(6));
      expect(idx.getStats().totalNodes).toBe(4);
      expect(idx.has(1)).toBe(true);
      expect(idx.has(2)).toBe(false);
      expect(idx.has(3)).toBe(true);
      expect(idx.has(4)).toBe(false);
      expect(idx.has(5)).toBe(true);
      expect(idx.has(6)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// EdgeIndex
// ---------------------------------------------------------------------------

function edge(id: number, overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    projectId: 'test/proj',
    sourceId: id * 10,
    targetId: id * 10 + 1,
    type: 'CALLS' as RelationshipType,
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('EdgeIndex', () => {
  describe('add', () => {
    it('adds a single edge to all indexes', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      expect(idx.size).toBe(1);
      expect(idx.getById(1)?.sourceId).toBe(10);
    });

    it('accumulates edges sharing the same source/target/type', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 5, targetId: 9, type: 'CALLS' as RelationshipType }));
      idx.add(edge(2, { sourceId: 5, targetId: 9, type: 'CALLS' as RelationshipType }));
      expect(idx.findBySource(5)).toHaveLength(2);
      expect(idx.findByTarget(9)).toHaveLength(2);
      expect(idx.findByType('CALLS')).toHaveLength(2);
    });
  });

  describe('findBySource', () => {
    it('returns edges by source node', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 10 }));
      idx.add(edge(2, { sourceId: 20 }));
      expect(idx.findBySource(10)).toHaveLength(1);
      expect(idx.findBySource(10)[0]!.id).toBe(1);
    });

    it('returns empty for unknown source', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      expect(idx.findBySource(999)).toEqual([]);
    });
  });

  describe('findByTarget', () => {
    it('returns edges by target node', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { targetId: 11 }));
      idx.add(edge(2, { targetId: 21 }));
      expect(idx.findByTarget(11)).toHaveLength(1);
      expect(idx.findByTarget(21)[0]!.id).toBe(2);
    });

    it('returns empty for unknown target', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      expect(idx.findByTarget(999)).toEqual([]);
    });
  });

  describe('findByType', () => {
    it('returns edges by relationship type', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { type: 'CALLS' as RelationshipType }));
      idx.add(edge(2, { type: 'IMPORTS' as RelationshipType }));
      expect(idx.findByType('CALLS')).toHaveLength(1);
      expect(idx.findByType('IMPORTS')[0]!.id).toBe(2);
    });

    it('returns empty for unknown type', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      expect(idx.findByType('NOPE')).toEqual([]);
    });
  });

  describe('findBySourceAndType', () => {
    it('filters edges by source AND type', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 5, type: 'CALLS' as RelationshipType }));
      idx.add(edge(2, { sourceId: 5, type: 'IMPORTS' as RelationshipType }));
      idx.add(edge(3, { sourceId: 6, type: 'CALLS' as RelationshipType }));
      expect(idx.findBySourceAndType(5, 'CALLS')).toHaveLength(1);
      expect(idx.findBySourceAndType(5, 'CALLS')[0]!.id).toBe(1);
    });

    it('returns empty when no edge matches source+type', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 5, type: 'CALLS' as RelationshipType }));
      expect(idx.findBySourceAndType(5, 'IMPORTS')).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns edge by ID', () => {
      const idx = new EdgeIndex();
      idx.add(edge(3));
      expect(idx.getById(3)?.id).toBe(3);
      expect(idx.getById(4)).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('removes an edge from all indexes', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 5, targetId: 9, type: 'CALLS' as RelationshipType }));
      expect(idx.remove(1)).toBe(true);
      expect(idx.size).toBe(0);
      expect(idx.findBySource(5)).toEqual([]);
      expect(idx.findByTarget(9)).toEqual([]);
      expect(idx.findByType('CALLS')).toEqual([]);
      expect(idx.getById(1)).toBeUndefined();
    });

    it('returns false for unknown edge ID', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      expect(idx.remove(999)).toBe(false);
      expect(idx.size).toBe(1);
    });

    it('removes a single edge while leaving shared-list siblings intact', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1, { sourceId: 5, targetId: 9 }));
      idx.add(edge(2, { sourceId: 5, targetId: 8 }));
      idx.remove(1);
      expect(idx.findBySource(5)).toHaveLength(1);
      expect(idx.findBySource(5)[0]!.id).toBe(2);
    });
  });

  describe('clear', () => {
    it('clears all indexes', () => {
      const idx = new EdgeIndex();
      idx.add(edge(1));
      idx.add(edge(2));
      idx.clear();
      expect(idx.size).toBe(0);
      expect(idx.findBySource(10)).toEqual([]);
    });
  });

  describe('bulkAdd', () => {
    it('adds a batch of edges', () => {
      const idx = new EdgeIndex();
      idx.bulkAdd([edge(1), edge(2), edge(3)]);
      expect(idx.size).toBe(3);
    });
  });
});
