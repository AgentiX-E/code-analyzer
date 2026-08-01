// @code-analyzer — CA-Bench: Throughput Suite
// Measures indexing throughput, memory usage, and query latency
// at different scale points using seeded graph data.
/* v8 ignore file -- @preserve */

import type { BenchmarkSuite, BenchmarkResult } from '../runner.js';
import { measurement, makeResult } from '../reporter.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { HybridSearchEngine } from '@code-analyzer/intelligence';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

export class ThroughputSuite implements BenchmarkSuite {
  readonly name = 'throughput';
  readonly description = 'Measures indexing throughput, memory usage, and query latency at scale';

  async run(): Promise<BenchmarkResult> {
    const store = new InMemoryGraphStore();
    const details: string[] = [];
    const measurements = [];

    // Test 1: Indexing throughput — insert 1000 nodes
    const nodeCount = 1000;
    const insertStart = Date.now();

    for (let i = 1; i <= nodeCount; i++) {
      store.insertNode(this.makeNode(i, `Symbol${i}`));
    }

    const insertDurationMs = Date.now() - insertStart;
    const nodesPerSec = (nodeCount / insertDurationMs) * 1000;

    measurements.push(
      measurement('Nodes Inserted', nodeCount, 'count', { target: nodeCount, min: nodeCount }),
      measurement('Insert Duration', insertDurationMs, 'ms', { target: 100, max: 500 }),
      measurement('Insert Throughput', Math.round(nodesPerSec), 'nodes/s', { target: 5000, min: 1000 }),
    );

    // Test 2: Node count verification
    const nodeCountResult = store.getNodeCount();
    measurements.push(
      measurement('Node Count Accuracy', nodeCountResult === nodeCount ? 1 : 0, 'boolean', { target: 1, min: 1 }),
    );

    // Test 3: Search engine initialization time
    const engine = new HybridSearchEngine(store);
    const indexStart = Date.now();
    engine.initialize();
    const indexDurationMs = Date.now() - indexStart;

    measurements.push(
      measurement('Index Build Time', indexDurationMs, 'ms', { target: 100, max: 500 }),
    );

    // Test 4: Query latency
    const queryStart = Date.now();
    const results = await engine.search({ query: 'Symbol500', limit: 5 });
    const queryDurationMs = Date.now() - queryStart;

    measurements.push(
      measurement('Query Latency (1K nodes)', queryDurationMs, 'ms', { target: 20, max: 100 }),
      measurement('Query Results Count', results.length, 'count', { target: 1, min: 1 }),
    );

    // Test 5: Memory usage (approximate)
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

    measurements.push(
      measurement('Heap Used (after 1K nodes)', heapUsedMB, 'MB', { target: 100, max: 500 }),
    );

    // Test 6: Edge insertion throughput
    const edgeCount = 500;
    const edgeStart = Date.now();
    for (let i = 1; i <= edgeCount; i++) {
      store.insertEdge({
        id: nodeCount + i,
        sourceId: i,
        targetId: i + 1,
        type: 'calls',
        properties: {},
      });
    }
    const edgeDurationMs = Date.now() - edgeStart;
    const edgesPerSec = (edgeCount / edgeDurationMs) * 1000;

    measurements.push(
      measurement('Edge Insert Throughput', Math.round(edgesPerSec), 'edges/s', { target: 5000, min: 1000 }),
    );

    details.push(
      `Indexed ${nodeCount} nodes and ${edgeCount} edges`,
      `Total duration: ${insertDurationMs + indexDurationMs + edgeDurationMs}ms`,
    );

    return makeResult(this.name, this.description, measurements, details);
  }

  private makeNode(id: number, name: string): GraphNode {
    return {
      id,
      name,
      label: 'Function',
      filePath: `src/module${id % 10}/${name.toLowerCase()}.ts`,
      startLine: 1,
      endLine: 10,
      signature: `function ${name}(arg: string): void`,
      properties: { filePath: `src/module${id % 10}/${name.toLowerCase()}.ts` },
      dependencies: [],
      callers: [],
      complexity: 1 + (id % 20),
    };
  }
}
