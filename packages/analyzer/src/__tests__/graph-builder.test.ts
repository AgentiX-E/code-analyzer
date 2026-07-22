import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect } from 'vitest';

import { GraphBuilder } from '../graph/graph-builder.js';

import type { PipelineContext } from '@code-analyzer/shared';

function createMockContext(): PipelineContext {
  return {
    projectId: 'test-project',
    rootPath: '/test/project',
    phaseData: new Map(),
    config: {
      projectId: 'test-project',
      rootPath: '/test/project',
      excludePatterns: [],
      includePatterns: ['**/*'],
      maxFileSize: 1048576,
      maxFiles: 10000,
      parseWorkers: 4,
      ignorePaths: [],
    },
  };
}

describe('GraphBuilder', () => {
  describe('build', () => {
    it('should create a graph with project and root folder nodes', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      expect(graph.projectId).toBe('test-project');
      expect(graph.nodes.size).toBe(2); // Project + Root Folder
      expect(graph.edges.size).toBe(1); // Project -> Root Folder

      // Check Project node
      const projectNodes = Array.from(graph.nodes.values()).filter(
        (n) => n.label === 'Project',
      );
      expect(projectNodes).toHaveLength(1);
      expect(projectNodes[0]!.name).toBe('test-project');

      // Check Folder node
      const folderNodes = Array.from(graph.nodes.values()).filter(
        (n) => n.label === 'Folder',
      );
      expect(folderNodes).toHaveLength(1);
      expect(folderNodes[0]!.name).toBe('/test/project');
    });

    it('should create qname index for the project node', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      expect(graph.qnameIndex.size).toBe(1);
      expect(graph.qnameIndex.get('project:test-project')).toBeDefined();
    });

    it('should create file index for the root folder', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      expect(graph.fileIndex.size).toBe(1);
      expect(graph.fileIndex.get('/test/project')).toBeDefined();
    });
  });

  describe('dumpToStore', () => {
    it('should dump graph nodes and edges to in-memory graph store', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      builder.dumpToStore(graph, 'test-project');

      expect(store.getNodeCount()).toBe(2);
      expect(store.getEdgeCount()).toBe(1);
    });

    it('should dump data with correct project ID', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      builder.dumpToStore(graph, 'custom-project');

      const allNodes = store.getAllNodes();
      expect(allNodes.length).toBe(2);
      expect(allNodes.every((n) => n.projectId === 'custom-project')).toBe(true);
    });
  });

  describe('validate', () => {
    it('should validate a clean graph', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      const report = builder.validate(graph);
      expect(report.valid).toBe(true);
      expect(report.nodeCount).toBe(2);
      expect(report.edgeCount).toBe(1);
      expect(report.issues).toHaveLength(0);
    });

    it('should detect orphan edges', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      // Add an edge referencing a non-existent target node
      graph.edges.set(999, {
        id: 999,
        projectId: 'test-project',
        sourceId: 1,
        targetId: 9999, // Non-existent
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });

      const report = builder.validate(graph);
      expect(report.valid).toBe(false);
      expect(report.orphanEdges).toBeGreaterThan(0);
      expect(report.issues.length).toBeGreaterThan(0);
    });

    it('should detect orphan edge with missing source node', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      // Add an edge referencing a non-existent source node
      graph.edges.set(777, {
        id: 777,
        projectId: 'test-project',
        sourceId: 8888, // Non-existent source
        targetId: 2, // Valid target (root folder)
        type: 'CALLS',
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });

      const report = builder.validate(graph);
      expect(report.valid).toBe(false);
      expect(report.orphanEdges).toBeGreaterThan(0);
      expect(report.issues.some((i) => i.includes('missing source node'))).toBe(true);
    });

    it('should detect duplicate qualified names', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      // Add a duplicate project node
      graph.nodes.set(999, {
        id: 999,
        projectId: 'test-project',
        label: 'Project',
        name: 'test-project',
        qualifiedName: 'project:test-project', // Same qname
        filePath: null,
        startLine: null,
        endLine: null,
        language: null,
        properties: { name: 'test-project' },
        signature: null,
        docstring: null,
        complexity: null,
        isExported: false,
        fingerprint: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const report = builder.validate(graph);
      expect(report.valid).toBe(false);
      expect(report.duplicateQnames).toBeGreaterThan(0);
    });
  });

  describe('graph structure', () => {
    it('should create CONTAINS edge from Project to Folder', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      const edges = Array.from(graph.edges.values());
      expect(edges).toHaveLength(1);
      expect(edges[0]!.type).toBe('CONTAINS');
    });

    it('ensureFolderPath creates intermediate folder nodes', () => {
      const store = new InMemoryGraphStore();
      const builder = new GraphBuilder(store);
      const ctx = createMockContext();
      const graph = builder.build(ctx);

      const initialNodeCount = graph.nodes.size;
      const initialEdgeCount = graph.edges.size;

      const folderId = builder.ensureFolderPath(
        graph,
        ctx.rootPath,
        'src/utils',
      );

      expect(folderId).toBeGreaterThan(0);
      // Should create 'src' and 'utils' folder nodes
      expect(graph.nodes.size).toBe(initialNodeCount + 2);
      expect(graph.edges.size).toBe(initialEdgeCount + 2);

      // Verify the nodes exist
      const folderNodes = Array.from(graph.nodes.values()).filter(
        (n) => n.label === 'Folder',
      );
      expect(folderNodes.length).toBe(3); // root + src + utils
    });
  });
});
