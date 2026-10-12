// Which backend produced an embedding, said out loud.
//
// `embed.ts` tries the real ONNX backend first and falls back to a hash-seeded pseudo-random vector when the
// ~137MB model is not bundled. The 2026-08-17 audit recorded the fallback as the defect — "a single-hash-seeded
// PRNG, not semantic" — which is true of the fallback and not of the whole path. What was actually wrong is that
// the choice was silent: a caller could not tell a semantic vector from a hash.
//
// The factory is injectable, so both paths are exercised here without a model or an ONNX runtime.

import { describe, it, expect } from 'vitest';

import { generateEmbeddings } from '../pipeline/phases/embed.js';

import type { Embedder } from '../pipeline/phases/embed.js';
import type { GraphNode } from '@code-analyzer/shared';

/** A node the phase will consider embeddable: named, and not structural. */
function node(id: number, name: string): GraphNode {
  return {
    id,
    label: 'Function',
    name,
    properties: { signature: `${name}(): void` },
  } as unknown as GraphNode;
}

const nodes = new Map<number, GraphNode>([
  [1, node(1, 'alpha')],
  [2, node(2, 'beta')],
]);

/** An embedder that returns a constant vector, so no model is needed. */
const fakeEmbedder: Embedder = {
  embed: async () => new Float32Array([1, 0, 0]),
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0])),
  dispose: async () => undefined,
};

describe('generateEmbeddings, and which backend it used', () => {
  it('reports the onnx backend when the factory supplies one', async () => {
    const results = await generateEmbeddings(nodes, async () => fakeEmbedder);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.backend === 'onnx')).toBe(true);
    expect(results[0]!.embedding).toEqual([1, 0, 0]);
  });

  it('reports the deterministic backend when the factory supplies none', async () => {
    // The state CI runs in: no bundled model, so the factory resolves to null.
    const results = await generateEmbeddings(nodes, async () => null);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.backend === 'deterministic')).toBe(true);
  });

  it('reports the deterministic backend when the embedder throws per node', async () => {
    const failing: Embedder = {
      embed: async () => {
        throw new Error('no model');
      },
      embedBatch: async () => {
        throw new Error('no model');
      },
      dispose: async () => undefined,
    };

    const results = await generateEmbeddings(nodes, async () => failing);

    // The batch failed and each node failed, so every vector came from the fallback — and says so.
    expect(results.every((r) => r.backend === 'deterministic')).toBe(true);
  });

  it('produces vectors of the documented dimension on the fallback path', async () => {
    const results = await generateEmbeddings(nodes, async () => null);

    for (const result of results) expect(result.embedding).toHaveLength(768);
  });

  it('distinguishes two different texts on the fallback, and repeats for the same one', async () => {
    // The fallback is not semantic, but it is deterministic and text-dependent — which is what makes it usable in
    // tests and useless for similarity. Saying both of those plainly is the point of the `backend` field.
    const [a, b] = await generateEmbeddings(nodes, async () => null);
    const again = await generateEmbeddings(nodes, async () => null);

    expect(a!.embedding).not.toEqual(b!.embedding);
    expect(a!.embedding).toEqual(again[0]!.embedding);
  });
});
