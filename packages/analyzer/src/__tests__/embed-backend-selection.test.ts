// Which embedding backend a run uses, and why it is not the one that was there.
//
// **Both success arms were unreachable from a test, and that is a fact about the machine rather than about the code**:
// the ONNX backend needs a 137MB model that the published package does not ship, and the API backend needs a key.
// **The seam closes that without mocking anything**: the two loaders are parameters with the production defaults, so
// "the ONNX backend won", "the API backend won" and "neither did, and here is both reasons" become three ordinary
// cases that run anywhere.
//
// **The reason string is the part that matters commercially.** A report that says *"no embeddings"* is a report nobody
// can act on, and the field that says *which* backend produced a vector is the field whose absence once let a lexical
// figure be quoted as a semantic one.

import { describe, expect, it } from 'vitest';

import {
  embedderUnavailableReason,
  generateEmbeddings,
  loadEmbedder,
} from '../pipeline/phases/embed.js';

import type { Embedder } from '../pipeline/phases/embed.js';
import type { KnowledgeGraph } from '@code-analyzer/shared';

function embedderOf(tag: number): Embedder {
  const vector = () => Float32Array.from([tag, 0, 0]);
  return {
    embed: async () => vector(),
    embedBatch: async (texts: string[]) => texts.map(() => vector()),
    dispose: async () => undefined,
  };
}

/** Two named nodes, which is all `generateEmbeddings` needs to have something to embed. */
function graphWithTwoNodes(): KnowledgeGraph {
  const node = (id: number, name: string) => ({
    id,
    projectId: 'p',
    label: 'Function',
    name,
    qualifiedName: `p:src/a.ts:${name}`,
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 2,
    language: 'TypeScript',
    properties: {},
  });
  return {
    nodes: new Map([
      [1, node(1, 'alpha')],
      [2, node(2, 'beta')],
    ]),
    edges: new Map(),
  } as unknown as KnowledgeGraph;
}

describe('choosing a backend', () => {
  it('prefers the ONNX backend when it loads, because it needs no network and no key', async () => {
    const chosen = await loadEmbedder(
      async () => embedderOf(1),
      async () => null,
    );

    expect(chosen?.backend).toBe('onnx');
  });

  it('falls back to the API backend when the ONNX model is absent', async () => {
    const chosen = await loadEmbedder(
      async () => null,
      async () => ({ embedder: embedderOf(2), backend: 'api' as const }),
    );

    expect(chosen?.backend).toBe('api');
  });

  it('reports both reasons when neither backend loads', async () => {
    // **The losing backend's reason is the evidence for the conclusion**, and one message naming only the last
    // attempt hides half the answer.
    const chosen = await loadEmbedder(
      async () => null,
      async () => null,
    );

    expect(chosen).toBeNull();
    expect(embedderUnavailableReason()).toMatch(/onnx:/);
    expect(embedderUnavailableReason()).toMatch(/api:/);
  });
});

describe('generating vectors', () => {
  it('uses the injected embedder and reports which backend ran', async () => {
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => embedderOf(3));

    expect(result.backend).toBe('onnx');
    expect(result.results.length).toBe(2);
    expect(result.results[0]!.embedding[0]).toBe(3);
  });

  it('falls back to the deterministic embedding when no backend loads, and says why', async () => {
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => null);

    expect(result.backend).toBe('deterministic');
    expect(result.reason).toBeTruthy();
    expect(result.results.length).toBe(2);
  });

  it('reports a loader that throws something other than an Error', async () => {
    // **A `throw` of a string is legal JavaScript**, and the message is what a report has to show; an
    // `error instanceof Error ? … : String(error)` that only ever saw `Error`s had never been asked.
    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => {
      // A string, which is what a loader written without `Error` in mind produces; the phase has to record it.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'model file missing';
    });

    expect(result.backend).toBe('deterministic');
    expect(result.reason).toContain('model file missing');
  });

  it('skips the nodes that carry no text of their own', async () => {
    // **A file, a folder, a package and a nameless node are not embeddable** - embedding them would put a vector on a
    // container whose contents are already vectors.
    const nodes = new Map<number, unknown>([
      [1, { id: 1, label: 'File', name: 'a.ts', properties: {} }],
      [2, { id: 2, label: 'Folder', name: 'src', properties: {} }],
      [3, { id: 3, label: 'Function', name: '', properties: {} }],
      [4, { id: 4, label: 'Function', name: 'real', properties: {} }],
    ]);

    const result = await generateEmbeddings(nodes as never, async () => embedderOf(5));

    expect(result.results.map((r) => r.nodeId)).toEqual([4]);
  });

  it('keeps the results it has when the backend returns fewer vectors than texts', async () => {
    // **A backend that answers short is a failure the caller must see as a shorter result**, not as an exception that
    // loses the whole run - the per-node fallback below it exists for exactly this.
    const short: Embedder = {
      embed: async () => Float32Array.from([1, 0, 0]),
      embedBatch: async () => [Float32Array.from([1, 0, 0])],
      dispose: async () => undefined,
    };

    const result = await generateEmbeddings(graphWithTwoNodes().nodes, async () => short);

    expect(result.results).toHaveLength(1);
    expect(result.backend).toBe('onnx');
  });

  it('reports a deterministic result for a graph with nothing to embed', async () => {
    const result = await generateEmbeddings(new Map(), async () => embedderOf(1));

    expect(result.backend).toBe('deterministic');
    expect(result.results).toEqual([]);
  });
});
