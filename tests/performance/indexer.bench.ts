/**
 * Performance benchmarks for ParallelIndexer.
 * Measures throughput of parallel indexing, batch writes, FTS search, and traversal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { InMemoryGraphStore } from '../../packages/infra/src/storage/in-memory-graph-store.js';
import { ParallelIndexer } from '../../packages/infra/src/workers/parallel-indexer.js';
import type { GraphNode, GraphEdge, NodeLabel, RelationshipType } from '../../packages/shared/src/types/graph.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDirCounter = 0;

function createTempDir(): string {
  const dir = join(tmpdir(), `code-analyzer-bench-${Date.now()}-${tmpDirCounter++}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function generateProjectFiles(
  rootPath: string,
  fileCount: number,
  symbolsPerFile = 5,
): void {
  const extensions = ['.ts', '.js', '.py', '.go', '.java'];
  for (let i = 0; i < fileCount; i++) {
    const ext = extensions[i % extensions.length]!;
    const dir = join(rootPath, `module_${i % 20}`);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `file_${i}${ext}`);
    const content = generateFileContent(i, symbolsPerFile, ext);
    writeFileSync(filePath, content, 'utf-8');
  }
}

function generateFileContent(
  seed: number,
  symbolCount: number,
  ext: string,
): string {
  const lines: string[] = [];

  if (ext === '.ts' || ext === '.js') {
    lines.push(`// Generated file ${seed}`);
    lines.push(`import { helper_${seed} } from './utils';`);
    lines.push('');
    for (let s = 0; s < symbolCount; s++) {
      lines.push(`export function func_${seed}_${s}(arg: string): void {`);
      lines.push(`  console.log("func_${seed}_${s} called with", arg);`);
      lines.push(`  helper_${seed}(arg);`);
      lines.push(`}`);
      lines.push('');
    }
    lines.push(`export class Class_${seed} {`);
    lines.push(`  constructor() { this.init(); }`);
    lines.push(`  init() { func_${seed}_0("init"); }`);
    lines.push(`}`);
  } else if (ext === '.py') {
    lines.push(`# Generated file ${seed}`);
    lines.push(`from utils import helper_${seed}`);
    lines.push('');
    for (let s = 0; s < symbolCount; s++) {
      lines.push(`def func_${seed}_${s}(arg):`);
      lines.push(`    print(f"func_${seed}_${s} called with {arg}")`);
      lines.push(`    helper_${seed}(arg)`);
      lines.push('');
    }
    lines.push(`class Class_${seed}:`);
    lines.push(`    def __init__(self):`);
    lines.push(`        self.init()`);
    lines.push(`    def init(self):`);
    lines.push(`        func_${seed}_0("init")`);
  } else if (ext === '.go') {
    lines.push(`package module_${seed % 20}`);
    lines.push('');
    lines.push(`import "fmt"`);
    lines.push('');
    for (let s = 0; s < symbolCount; s++) {
      lines.push(`func Func_${seed}_${s}(arg string) {`);
      lines.push(`  fmt.Println("Func_${seed}_${s} called with", arg)`);
      lines.push(`}`);
      lines.push('');
    }
    lines.push(`type Class_${seed} struct {`);
    lines.push(`}`);
  } else if (ext === '.java') {
    lines.push(`package module_${seed % 20};`);
    lines.push('');
    for (let s = 0; s < symbolCount; s++) {
      lines.push(`class Func_${seed}_${s} {`);
      lines.push(`  void run(String arg) {`);
      lines.push(`    System.out.println("func_${seed}_${s} called with " + arg);`);
      lines.push(`  }`);
      lines.push(`}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function generateNodes(count: number, projectId = 'perf-test'): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push({
      id: 0,
      projectId,
      label: i % 10 === 0 ? ('Class' as NodeLabel) : ('Function' as NodeLabel),
      name: `node_${i}`,
      qualifiedName: `${projectId}::node_${i}`,
      filePath: `src/module_${i % 50}/file_${i}.ts`,
      startLine: i * 5 + 1,
      endLine: i * 5 + 10,
      language: 'typescript',
      properties: {
        name: `node_${i}`,
        returnType: 'void',
        parameterCount: i % 5,
        isAsync: i % 3 === 0,
      },
      signature: `function node_${i}(arg: string): void`,
      docstring: `Documentation for node_${i}`,
      complexity: i % 20,
      isExported: i % 3 === 0,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  return nodes;
}

function generateEdges(nodeIds: number[], edgesPerNode: number, projectId = 'perf-test'): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const types: RelationshipType[] = ['CALLS', 'DEFINES', 'IMPORTS', 'REFERENCES'];
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = 0; j < edgesPerNode; j++) {
      const targetIdx = (i + j + 1) % nodeIds.length;
      edges.push({
        id: 0,
        projectId,
        sourceId: nodeIds[i]!,
        targetId: nodeIds[targetIdx]!,
        type: types[j % types.length]!,
        properties: {},
        weight: 1,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('ParallelIndexer Benchmarks', () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  // ── Small Project ──

  it('small project (100 files) under 1 second', async () => {
    const rootPath = createTempDir();
    try {
      generateProjectFiles(rootPath, 100, 3);

      const indexer = new ParallelIndexer(store, {
        concurrency: 4,
        batchSize: 25,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesDiscovered).toBeGreaterThanOrEqual(90);
      expect(result.filesParsed).toBeGreaterThanOrEqual(80);
      expect(result.durationMs).toBeLessThan(1000);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Medium Project ──

  it('medium project (1,000 files) under 10 seconds', async () => {
    const rootPath = createTempDir();
    try {
      generateProjectFiles(rootPath, 1000, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 8,
        batchSize: 100,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesDiscovered).toBeGreaterThanOrEqual(950);
      expect(result.durationMs).toBeLessThan(10000);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Large Project ──

  it('large project (10,000 files) under 60 seconds', async () => {
    const rootPath = createTempDir();
    try {
      generateProjectFiles(rootPath, 10000, 3);

      const indexer = new ParallelIndexer(store, {
        concurrency: 8,
        batchSize: 200,
        enableStreaming: true,
        enableIncremental: false,
      });

      const result = await indexer.indexDirectory(rootPath);

      expect(result.filesDiscovered).toBeGreaterThanOrEqual(9500);
      expect(result.durationMs).toBeLessThan(60000);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Incremental ──

  it('incremental (1 file changed) under 100ms', async () => {
    const rootPath = createTempDir();
    try {
      generateProjectFiles(rootPath, 100, 5);

      const indexer = new ParallelIndexer(store, {
        concurrency: 4,
        batchSize: 25,
        enableStreaming: true,
        enableIncremental: true,
      });

      // First full index
      await indexer.indexDirectory(rootPath);

      // Change one file
      const firstFilePath = join(rootPath, 'module_0', 'file_0.ts');
      writeFileSync(firstFilePath, 'export function updated_func(): void {}\n', 'utf-8');

      // Incremental re-index
      const start = performance.now();
      await indexer.indexDirectory(rootPath);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
    } finally {
      rmSync(rootPath, { recursive: true, force: true });
    }
  });

  // ── Batch Insert ──

  it('batch insert (10,000 nodes) under 500ms', async () => {
    const nodes = generateNodes(10_000);
    const start = performance.now();
    store.insertNodes(nodes);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(store.getNodeCount()).toBe(10_000);
  });

  // ── FTS5 Search ──

  it('FTS5 search (100K nodes) under 10ms', async () => {
    const nodes = generateNodes(100_000);
    store.insertNodes(nodes);

    const start = performance.now();
    const results = store.searchFts('node_500', { limit: 20 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(results.length).toBeGreaterThan(0);
  });

  // ── BFS Traversal ──

  it('BFS traversal depth 5 under 50ms', async () => {
    const nodes = generateNodes(50_000);
    const nodeIds = store.insertNodes(nodes);
    const edges = generateEdges(nodeIds, 3);
    store.insertEdges(edges);

    const start = performance.now();
    const result = store.bfs(nodeIds[0]!, 5);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});
