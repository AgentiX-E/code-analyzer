// @code-analyzer/infra — Graph Index Tests

import { describe, it, expect } from 'vitest';
import { NodeIndex } from '../storage/graph-index.js';
import type { GraphNode, NodeLabel } from '@code-analyzer/shared';

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
