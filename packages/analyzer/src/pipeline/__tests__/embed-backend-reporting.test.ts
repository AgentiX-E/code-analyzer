// The embedding backend, and the reason it was not used.
//
// **The defect this exists for.** `generateEmbeddings` has a deterministic fallback that works, so the phase reported
// `success` - honestly, because it produced embeddings. **But it swallowed the error that sent it there**:
//
//   try { embedder = await loadEmbedder(); } catch { /* ONNX backend unavailable — use deterministic fallback */ }
//
// **So "which embeddings does this index hold" was unanswerable from the pipeline's own output.** That matters
// because a measurement of indexing has to name its environment, and because in this repository the ONNX backend
// **always** fails: the published `@agentix-e/embed-code-node` declares `files: ['dist', 'models']` and ships no
// `models/`, so `createFromPackage()` cannot find `nomic-embed-code-v1.5.int8.onnx` or the `tokenizer.json` beside
// it, on any machine.
//
// **The assertion is that the reason travels out with the results**, not that a backend is available - a test that
// required the model would fail everywhere, and one that ignored the reason would have passed before this change.

import { describe, expect, it } from 'vitest';

import { generateEmbeddings } from '../phases/embed.js';

/** One node, so the function reaches the loader rather than returning early. */
function oneNode(): Map<number, object> {
  return new Map([[1, { id: 1, label: 'Function', name: 'f', qualifiedName: 'p:f', properties: { filePath: '/f.ts' } }]]);
}

describe('the embedding backend report', () => {
  it('carries the reason the real backend was not used', async () => {
    const { results, backend, reason } = await generateEmbeddings(oneNode() as never, async () => {
      throw new Error('Tokenizer not found: /pkg/models/tokenizer.json');
    });

    // The fallback still produces embeddings - it is a real option, not a failure.
    expect(results.length).toBeGreaterThan(0);
    expect(backend).toBe('deterministic');
    // **And the reason is readable**, which is the point: it names what was missing.
    expect(reason).toContain('Tokenizer not found');
  });

  it('says onnx when a backend did load', async () => {
    const embedder = {
      embedBatch: async (texts: string[]) => texts.map(() => Float32Array.from([1, 0, 0])),
      embed: async () => Float32Array.from([1, 0, 0]),
      dispose: async () => undefined,
    };
    const { backend, reason } = await generateEmbeddings(oneNode() as never, async () => embedder as never);
    expect(backend).toBe('onnx');
    expect(reason).toBeNull();
  });
});
