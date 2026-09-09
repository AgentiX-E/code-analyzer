// @code-analyzer/analyzer — Pipeline Phase: Embed
// Uses @agentix-e/embed-code-node (nomic-embed-code ONNX) when available.
// Falls back to deterministic hash-based embeddings when ONNX is unavailable.

import type { PipelinePhaseId, PipelineContext, GraphNode } from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { simpleHash } from '../phase-helpers.js';

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

export interface EmbeddingResult {
  nodeId: number;
  embedding: number[];
}

/** The ONNX embedder contract consumed by `generateEmbeddings`. */
export interface Embedder {
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  dispose: () => Promise<void>;
}

/**
 * Generate embeddings for every embeddable graph node.
 *
 * The ONNX backend is loaded through the injectable `loadEmbedder` factory
 * (defaulting to `loadRealEmbedder`). When the backend is unavailable — the
 * ~137MB model is not bundled in CI — the factory resolves to null and a
 * deterministic hash-based fallback is used instead.
 */
export async function generateEmbeddings(
  nodes: Map<number, GraphNode>,
  loadEmbedder: () => Promise<Embedder | null> = loadRealEmbedder,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  // Collect embeddable nodes
  const embeddable: Array<{ nodeId: number; text: string }> = [];
  for (const [nodeId, node] of nodes) {
    // Skip structural and nameless nodes
    if (node.label === 'File' || node.label === 'Folder' || node.label === 'Project') continue;
    if (!node.name) continue;

    // Build text representation
    const textParts: string[] = [node.label, node.name];
    const signature = node.properties.signature;
    if (signature) textParts.push(signature);

    embeddable.push({
      nodeId,
      text: textParts.filter((p) => p.length > 0).join(' '),
    });
  }

  if (embeddable.length === 0) return results;

  // Try the real ONNX backend from @agentix-e/embed-code-node
  let embedder: Embedder | null = null;

  try {
    embedder = await loadEmbedder();
  } catch {
    // ONNX backend unavailable — use deterministic fallback
  }

  if (embedder) {
    // ONNX backend is active — use real nomic-embed-code embeddings
    try {
      // Batch embed for throughput
      const texts = embeddable.map((e) => e.text);
      const vectors = await embedder.embedBatch(texts);
      for (let i = 0; i < embeddable.length; i++) {
        const vector = vectors[i];
        if (vector) {
          results.push({ nodeId: embeddable[i]!.nodeId, embedding: Array.from(vector) });
        }
      }
    } catch {
      // Per-node fallback if batch fails
      for (const { nodeId, text } of embeddable) {
        try {
          const vec = await embedder.embed(text);
          results.push({ nodeId, embedding: Array.from(vec) });
        } catch {
          results.push({ nodeId, embedding: deterministicEmbed(text) });
        }
      }
    } finally {
      try {
        await embedder.dispose();
      } catch {
        // Ignore cleanup errors
      }
    }
  } else {
    // Deterministic fallback for every node
    for (const { nodeId, text } of embeddable) {
      results.push({ nodeId, embedding: deterministicEmbed(text) });
    }
  }

  return results;
}

/**
 * Dynamically load the real ONNX embedder.
 * Uses `createFromPackage()` which loads the model bundled with the npm package.
 * Returns null if the model or ONNX runtime is unavailable.
 *
 * NOTE: Requires @agentix-e/embed-code-node with bundled ONNX model (~137MB).
 * When the model file is not checked into the repository, `createFromPackage()`
 * throws and this resolves to null so callers fall back deterministically.
 */
export async function loadRealEmbedder(): Promise<Embedder | null> {
  const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

  // Try createFromPackage first (bundled model), fall back to create({ modelPath })
  try {
    const nodeEmbedder = NodeEmbedder as unknown as { createFromPackage: () => Promise<Embedder> };
    return await nodeEmbedder.createFromPackage();
  } catch {
    // createFromPackage not available — model not bundled
    return null;
  }
}

function deterministicEmbed(text: string, dimension: number = 768): number[] {
  const embedding = new Array<number>(dimension);
  // Use a deterministic hash to seed the embedding
  const seed = simpleHash(text, 9973);

  // Generate reproducible pseudo-random values seeded from text
  let state = seed;
  for (let i = 0; i < dimension; i++) {
    state = ((state << 5) - state + 0x6b8b4567) | 0;
    embedding[i] = ((state >>> 0) / 0xffffffff) * 2 - 1; // Map to [-1, 1]
  }

  // Normalize to unit length. The LCG output above is never exactly zero
  // (0.5 maps to a non-integer state), so the norm is always > 0 — the
  // guard would be dead and is omitted.
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  for (let i = 0; i < dimension; i++) {
    embedding[i] = embedding[i]! / norm;
  }

  return embedding;
}

// ---------------------------------------------------------------------------
// Phase 18: embed — Generate vector embeddings for graph nodes
// ---------------------------------------------------------------------------

export class EmbedPhase implements ExecutablePhase {
  readonly id: PipelinePhaseId = 'embed';
  readonly dependencies: PipelinePhaseId[] = ['dump'];
  readonly description = 'Generate vector embeddings for graph nodes';
  readonly parallelizable = true;
  private logger: PhaseLogger = createNoopPhaseLogger();

  async execute(ctx: PipelineContext): Promise<PhaseExecutionResult> {
    try {
      if (!ctx.graph) {
        return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: 0 } };
      }

      const embeddings = await generateEmbeddings(ctx.graph.nodes);

      // Store embeddings in node properties
      for (const { nodeId, embedding } of embeddings) {
        // nodeId came from the nodes iteration inside generateEmbeddings and the
        // graph is not mutated in between, so get() always returns the node.
        const node = ctx.graph.nodes.get(nodeId)!;
        node.properties = {
          ...node.properties,
          embedding,
        };
      }

      ctx.phaseData.set('embed', { embeddingsGenerated: embeddings.length });
      return {
        phaseId: this.id,
        status: 'success',
        output: { embeddingsGenerated: embeddings.length },
      };
    } catch (err) {
      this.logger.error(
        'Phase execution failed',
        err instanceof Error ? err : new Error(String(err)),
        { phaseId: this.id, filePath: ctx?.rootPath },
      );
      const message = err instanceof Error ? err.message : String(err);
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
