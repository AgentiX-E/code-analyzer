// @code-analyzer/analyzer — Embed Phase Unit Tests
// Direct unit tests for the embed phase's exported helpers (generateEmbeddings,
// loadRealEmbedder) and EmbedPhase.execute, covering both the deterministic
// fallback and the ONNX backend path via dependency-injected embedders.

import { describe, it, expect } from 'vitest';
import { GraphBuilder } from '../graph/graph-builder.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { PipelineContext, KnowledgeGraph, CodeAnalyzerConfig } from '@code-analyzer/shared';
import { EmbedPhase, generateEmbeddings, loadRealEmbedder } from '../pipeline/phases/embed.js';
import type { Embedder } from '../pipeline/phases/embed.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConfig(projectId: string, rootPath: string): CodeAnalyzerConfig {
  return {
    projectId,
    rootPath,
    excludePatterns: [],
    includePatterns: ['**/*'],
    maxFileSize: 10 * 1024 * 1024,
    maxFiles: 10000,
    parseWorkers: 4,
    ignorePaths: [],
  };
}

function buildGraph(): { graph: KnowledgeGraph; builder: GraphBuilder } {
  const store = new InMemoryGraphStore();
  const builder = new GraphBuilder(store);
  const ctx: PipelineContext = {
    projectId: 'test-proj',
    rootPath: '/tmp/test-proj',
    phaseData: new Map(),
    config: createConfig('test-proj', '/tmp/test-proj'),
  };
  return { graph: builder.build(ctx), builder };
}

function makeContext(graph: KnowledgeGraph): PipelineContext {
  return {
    projectId: 'test-proj',
    rootPath: '/tmp/test-proj',
    phaseData: new Map(),
    config: createConfig('test-proj', '/tmp/test-proj'),
    graph,
  };
}

/** An in-memory Embedder test double — a real implementation, not a mock. */
function makeEmbedder(overrides: Partial<Embedder> = {}): Embedder {
  return {
    embed: async (text: string) => new Float32Array([text.length]),
    embedBatch: async (texts: string[]) => texts.map((t) => new Float32Array([t.length])),
    dispose: async () => undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateEmbeddings — deterministic fallback
// ---------------------------------------------------------------------------

describe('generateEmbeddings — deterministic fallback', () => {
  it('returns empty when there are no embeddable nodes', async () => {
    const { graph } = buildGraph();
    // graph only has Project + Folder (structural) nodes
    const results = await generateEmbeddings(graph.nodes);
    expect(results).toEqual([]);
  });

  it('skips structural and nameless nodes', async () => {
    const { graph, builder } = buildGraph();
    const fn = builder.addNode(graph, 'Function', 'foo', { name: 'foo' });
    const cls = builder.addNode(graph, 'Class', 'Bar', { name: 'Bar' });
    builder.addNode(graph, 'File', 'skip.ts', { name: 'skip.ts', filePath: '/tmp/skip.ts' });
    builder.addNode(graph, 'Folder', '/tmp/dir', { name: '/tmp/dir' });
    builder.addNode(graph, 'Project', 'p', { name: 'p' });
    builder.addNode(graph, 'Function', '', { name: '' }); // nameless

    const results = await generateEmbeddings(graph.nodes);
    const ids = results.map((r) => r.nodeId).sort();
    expect(ids).toEqual([fn.id, cls.id].sort());
  });

  it('produces 768-dim normalized deterministic embeddings', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'foo', { name: 'foo' });

    const results = await generateEmbeddings(graph.nodes);
    expect(results).toHaveLength(1);
    const embedding = results[0]!.embedding;
    expect(embedding).toHaveLength(768);
    for (const v of embedding) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('falls back when the loader throws', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'foo', { name: 'foo' });

    const results = await generateEmbeddings(graph.nodes, async () => {
      throw new Error('ONNX unavailable');
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.embedding).toHaveLength(768);
  });

  it('includes the signature in the embedding text', async () => {
    const { graph, builder } = buildGraph();
    const signed = builder.addNode(graph, 'Function', 'signed', {
      name: 'signed',
      signature: '(a: number): number',
    });
    const unsigned = builder.addNode(graph, 'Function', 'unsigned', { name: 'unsigned' });

    // Different text (with vs. without signature) must yield different embeddings.
    const results = await generateEmbeddings(graph.nodes);
    const byId = new Map(results.map((r) => [r.nodeId, r.embedding]));
    const signedEmb = byId.get(signed.id)!;
    const unsignedEmb = byId.get(unsigned.id)!;
    expect(signedEmb).not.toEqual(unsignedEmb);
  });
});

// ---------------------------------------------------------------------------
// generateEmbeddings — ONNX backend path
// ---------------------------------------------------------------------------

describe('generateEmbeddings — ONNX backend', () => {
  it('uses batch embedding when the backend is available', async () => {
    const { graph, builder } = buildGraph();
    const a = builder.addNode(graph, 'Function', 'a', { name: 'a' });
    const b = builder.addNode(graph, 'Class', 'b', { name: 'b' });

    const results = await generateEmbeddings(graph.nodes, async () =>
      makeEmbedder({
        embedBatch: async () => [new Float32Array([42]), new Float32Array([43])],
      }),
    );
    expect(results).toHaveLength(2);
    const byId = new Map(results.map((r) => [r.nodeId, r.embedding]));
    expect(Array.from(byId.get(a.id)!)).toEqual([42]);
    expect(Array.from(byId.get(b.id)!)).toEqual([43]);
  });

  it('skips nodes whose batch vector is falsy', async () => {
    const { graph, builder } = buildGraph();
    const a = builder.addNode(graph, 'Function', 'a', { name: 'a' });
    builder.addNode(graph, 'Function', 'b', { name: 'b' });

    const results = await generateEmbeddings(graph.nodes, async () =>
      makeEmbedder({
        embedBatch: async () => [new Float32Array([42]), null as unknown as Float32Array],
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.nodeId).toBe(a.id);
  });

  it('falls back to per-node embedding when the batch fails', async () => {
    const { graph, builder } = buildGraph();
    const a = builder.addNode(graph, 'Function', 'a', { name: 'a' });
    const b = builder.addNode(graph, 'Function', 'b', { name: 'b' });

    const results = await generateEmbeddings(graph.nodes, async () =>
      makeEmbedder({
        embedBatch: async () => {
          throw new Error('batch failed');
        },
        embed: async () => new Float32Array([99]),
      }),
    );
    expect(results).toHaveLength(2);
    const byId = new Map(results.map((r) => [r.nodeId, r.embedding]));
    expect(Array.from(byId.get(a.id)!)).toEqual([99]);
    expect(Array.from(byId.get(b.id)!)).toEqual([99]);
  });

  it('falls back to deterministic embedding when per-node embedding also fails', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'a', { name: 'a' });

    const results = await generateEmbeddings(graph.nodes, async () =>
      makeEmbedder({
        embedBatch: async () => {
          throw new Error('batch failed');
        },
        embed: async () => {
          throw new Error('embed failed');
        },
      }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.embedding).toHaveLength(768); // deterministic fallback
  });

  it('ignores dispose errors', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'a', { name: 'a' });

    const results = await generateEmbeddings(graph.nodes, async () =>
      makeEmbedder({
        dispose: async () => {
          throw new Error('dispose failed');
        },
      }),
    );
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadRealEmbedder
// ---------------------------------------------------------------------------

describe('loadRealEmbedder', () => {
  it('resolves to null when the bundled ONNX model is not present', async () => {
    // The nomic-embed-code model (~137MB) is not checked into CI, so
    // createFromPackage() throws and the loader resolves to null.
    const embedder = await loadRealEmbedder();
    expect(embedder).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EmbedPhase.execute
// ---------------------------------------------------------------------------

describe('EmbedPhase.execute', () => {
  it('returns success with zero embeddings when the graph is absent', async () => {
    const ctx = makeContext(undefined as unknown as KnowledgeGraph);
    delete ctx.graph;
    const phase = new EmbedPhase();
    const result = await phase.execute(ctx);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ embeddingsGenerated: 0 });
  });

  it('stores deterministic embeddings in node properties', async () => {
    const { graph, builder } = buildGraph();
    const fn = builder.addNode(graph, 'Function', 'foo', { name: 'foo' });
    const phase = new EmbedPhase();
    const result = await phase.execute(makeContext(graph));
    expect(result.status).toBe('success');
    const node = graph.nodes.get(fn.id)!;
    expect(Array.isArray(node.properties['embedding'])).toBe(true);
    expect((node.properties['embedding'] as number[]).length).toBe(768);
  });

  it('returns failed status when a real Error is thrown', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'foo', { name: 'foo' });
    const ctx = makeContext(graph);
    const real = graph.nodes;
    ctx.graph!.nodes = new Proxy(real, {
      get(target, prop) {
        if (prop === 'get') {
          return () => {
            throw new Error('boom');
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const phase = new EmbedPhase();
    const result = await phase.execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });

  it('returns failed status when a non-Error value is thrown', async () => {
    const { graph, builder } = buildGraph();
    builder.addNode(graph, 'Function', 'foo', { name: 'foo' });
    const ctx = makeContext(graph);
    const real = graph.nodes;
    ctx.graph!.nodes = new Proxy(real, {
      get(target, prop) {
        if (prop === 'get') {
          return () => {
            throw 'not-an-error';
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    const phase = new EmbedPhase();
    const result = await phase.execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('not-an-error');
  });
});
