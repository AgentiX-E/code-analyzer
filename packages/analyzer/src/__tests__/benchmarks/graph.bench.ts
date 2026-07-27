// @code-analyzer/analyzer — Graph Benchmarks
// Measures knowledge graph construction efficiency (nodes/sec, edges/sec).

import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './harness.js';
import type { BenchmarkCase } from './harness.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { GraphBuilder } from '../../../src/graph/graph-builder.js';
import type {
  KnowledgeGraph,
  PipelineContext,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPipelineContext(projectId: string): PipelineContext {
  return {
    projectId,
    rootPath: `/projects/${projectId}`,
    config: {},
    files: [],
    parsed: new Map(),
    graph: undefined,
    semanticModel: { id: projectId, symbols: [], references: [], scopes: [] },
    metadata: {},
  };
}

function createStore(): InMemoryGraphStore {
  return new InMemoryGraphStore();
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Graph Benchmarks', () => {
  it(
    'should build empty graph quickly',
    { timeout: 30_000 },
    async () => {
      const store = createStore();
      const builder = new GraphBuilder(store);
      const ctx = createPipelineContext('test-project');

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'build-empty-graph',
        category: 'graph',
        warmupIterations: 5,
        iterations: 100,
        fn: async () => {
          const graph = builder.build(ctx);
          expect(graph.nodes.size).toBeGreaterThan(0);
          expect(graph.edges.size).toBeGreaterThan(0);
        },
      };

      const stats = await runner.runCase(benchCase);
      expect(stats.duration.mean).toBeLessThan(5); // <5ms
    },
  );

  it(
    'should add nodes at high throughput',
    { timeout: 30_000 },
    async () => {
      const store = createStore();
      const builder = new GraphBuilder(store);
      const ctx = createPipelineContext('perf-test');
      const graph = builder.build(ctx);

      const labels: NodeLabel[] = ['Class', 'Function', 'Method', 'Interface', 'Type', 'Constant', 'Enum', 'Module'];
      let totalNodes = 0;

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'add-nodes-1000',
        category: 'graph',
        warmupIterations: 2,
        iterations: 20,
        fn: async () => {
          let count = 0;
          for (let i = 0; i < 1000; i++) {
            const label = labels[i % labels.length]!;
            const name = `Node${totalNodes + i}`;
            const qname = `${label.toLowerCase()}:Node${totalNodes + i}`;
            builder.addNode(graph, label, name, {
              name,
              startLine: totalNodes + i,
              endLine: totalNodes + i + 5,
              isExported: (totalNodes + i) % 3 === 0,
              complexity: (totalNodes + i) % 20,
            }, qname);
            count++;
          }
          totalNodes += count;
        },
      };

      const stats = await runner.runCase(benchCase);
      const expectedNodes = (2 + 20) * 1000; // warmup + iterations
      expect(totalNodes).toBe(expectedNodes);

      // 1000 nodes in <500ms => at least 2000 nodes/sec
      expect(stats.duration.mean).toBeLessThan(500);
      console.log(`Add 1000 nodes: mean=${stats.duration.mean.toFixed(2)}ms, nodes/sec=${(1000 / (stats.duration.mean / 1000)).toFixed(0)}`);
    },
  );

  it(
    'should add edges at high throughput',
    { timeout: 30_000 },
    async () => {
      const store = createStore();
      const builder = new GraphBuilder(store);
      const ctx = createPipelineContext('edge-test');
      const graph = builder.build(ctx);

      // Pre-create 1000 nodes
      for (let i = 0; i < 1000; i++) {
        builder.addNode(graph, 'Function', `Func${i}`, {
          name: `Func${i}`,
          startLine: i,
          endLine: i + 2,
          isExported: false,
          complexity: 1,
        }, `func:Func${i}`);
      }

      const types: RelationshipType[] = ['CALLS', 'IMPLEMENTS', 'IMPORTS', 'CONTAINS', 'REFERENCES', 'DEFINES', 'RETURNS', 'THROWS'];

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'add-edges-1000',
        category: 'graph',
        warmupIterations: 2,
        iterations: 20,
        fn: async () => {
          for (let i = 0; i < 1000; i++) {
            const sourceId = 1 + i;
            const targetId = 1 + ((i + 1) % 1000);
            const type = types[i % types.length]!;
            builder.addEdge(graph, sourceId, targetId, type, 'edge-test');
          }
        },
      };

      const stats = await runner.runCase(benchCase);
      expect(graph.edges.size).toBeGreaterThanOrEqual(1000);

      expect(stats.duration.mean).toBeLessThan(500);
      console.log(`Add 1000 edges: mean=${stats.duration.mean.toFixed(2)}ms, edges/sec=${(1000 / (stats.duration.mean / 1000)).toFixed(0)}`);
    },
  );

  it(
    'should validate large graphs efficiently',
    { timeout: 30_000 },
    async () => {
      const store = createStore();
      const builder = new GraphBuilder(store);
      const ctx = createPipelineContext('validate-test');
      const graph = builder.build(ctx);

      // Build a graph with 5000 nodes + 5000 edges
      for (let i = 0; i < 5000; i++) {
        builder.addNode(graph, 'Function', `F${i}`, {
          name: `F${i}`,
          startLine: i,
          endLine: i + 2,
          isExported: i % 2 === 0,
          complexity: i % 15,
        }, `func:F${i}`);
      }
      for (let i = 0; i < 5000; i++) {
        builder.addEdge(graph, 1 + i, 1 + ((i + 7) % 5000), 'CALLS', 'validate-test');
      }

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'validate-5000-nodes',
        category: 'graph',
        warmupIterations: 2,
        iterations: 10,
        fn: async () => {
          const report = builder.validate(graph);
          expect(report.valid).toBe(true);
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Validate 5000 nodes + 5000 edges: mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );

  it(
    'should dump to store efficiently',
    { timeout: 30_000 },
    async () => {
      const store = createStore();
      const builder = new GraphBuilder(store);
      const ctx = createPipelineContext('dump-test');
      const graph = builder.build(ctx);

      // Build graph
      for (let i = 0; i < 2000; i++) {
        const node = builder.addNode(graph, 'Class', `Class${i}`, {
          name: `Class${i}`,
          startLine: i * 10,
          endLine: i * 10 + 50,
          isExported: true,
          complexity: i % 30,
        }, `class:Class${i}`);
        builder.addEdge(graph, 1, node.id, 'CONTAINS', 'dump-test');
      }

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'dump-2000-to-store',
        category: 'graph',
        warmupIterations: 2,
        iterations: 10,
        setup: () => {
          // Fresh store each time to avoid accumulation
        },
        fn: async () => {
          const freshStore = createStore();
          const freshBuilder = new GraphBuilder(freshStore);
          freshBuilder.dumpToStore(graph, 'dump-test');
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Dump 2000 nodes to store: mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );
});
