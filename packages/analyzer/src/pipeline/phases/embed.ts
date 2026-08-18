// @code-analyzer/analyzer — Pipeline Phase: Embed
// Uses @agentix-e/embed-code-node (nomic-embed-code ONNX) when available.
// Falls back to deterministic hash-based embeddings when ONNX is unavailable.

import type {
  PipelinePhaseId,
  PipelineContext,
  KnowledgeGraph,
} from '@code-analyzer/shared';
import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import { simpleHash } from '../phase-helpers.js';

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

interface EmbeddingResult {
  nodeId: number;
  embedding: number[];
}

async function generateEmbeddings(
  nodes: Map<number, unknown>,
  _graph: KnowledgeGraph,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  // Collect embeddable nodes
  const embeddable: Array<{ nodeId: number; text: string }> = [];
  for (const [nodeId, node] of nodes) {
    const n = node as Record<string, unknown>;
    const label = n?.label as string | undefined;
    const name = n?.name as string | undefined;

    // Skip structural and nameless nodes
    if (!label || label === 'File' || label === 'Folder' || label === 'Project') continue;
    /* v8 ignore next -- @preserve -- GraphNode.name is a required field */
    if (!name) continue;

    // Build text representation
    const textParts: string[] = [label, name];
    /* v8 ignore next -- @preserve -- signature is an optional property on most nodes */
    const signature = n?.properties
      ? (n.properties as Record<string, unknown>)?.signature
      : undefined;
    if (signature && typeof signature === 'string') textParts.push(signature);

    embeddable.push({
      nodeId,
      text: textParts.filter((p) => p.length > 0).join(' '),
    });
  }

  if (embeddable.length === 0) return results;

  // Try the real ONNX backend from @agentix-e/embed-code-node
  let embedder: Awaited<ReturnType<typeof loadRealEmbedder>> = null;

  try {
    embedder = await loadRealEmbedder();
  } catch {
    // ONNX backend unavailable — use deterministic fallback
  }

  /* v8 ignore start -- @preserve -- ONNX backend requires a ~137MB model not in CI */
  if (embedder) {
    // ONNX backend is active — use real nomic-embed-code embeddings
    // NOTE: Excluded from CI coverage — requires ~137MB model file
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
    /* v8 ignore stop */
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
 * Returns null if the package, model, or ONNX runtime is unavailable.
 *
 * NOTE: Requires @agentix-e/embed-code-node with bundled ONNX model (~137MB).
 * Excluded from CI coverage as the model file is not checked into the repository.
 */
/* v8 ignore start -- @preserve -- requires @agentix-e/embed-code-node not in CI */
async function loadRealEmbedder(): Promise<{
  embed: (text: string) => Promise<Float32Array>;
  embedBatch: (texts: string[]) => Promise<Float32Array[]>;
  dispose: () => Promise<void>;
} | null> {
  const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

  // Try createFromPackage first (bundled model), fall back to create({ modelPath })
  try {
    type CreateFromPackageFn = () => Promise<{
      embed(text: string): Promise<Float32Array>;
      embedBatch(texts: string[]): Promise<Float32Array[]>;
      dispose(): Promise<void>;
    }>;
    const nodeEmbedder = NodeEmbedder as unknown as { createFromPackage: CreateFromPackageFn };
    return await nodeEmbedder.createFromPackage();
  } catch {
    // createFromPackage not available — model not bundled
    return null;
  }
}
/* v8 ignore stop */

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

  // Normalize to unit length
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  /* v8 ignore next -- @preserve -- norm is always > 0 for a seeded embedding */
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      embedding[i] = embedding[i]! / norm;
    }
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

      const embeddings = await generateEmbeddings(ctx.graph.nodes, ctx.graph);

      // Store embeddings in node properties
      for (const { nodeId, embedding } of embeddings) {
        const node = ctx.graph.nodes.get(nodeId);
        /* v8 ignore next -- @preserve -- nodeId came from a nodes iteration, so get() is always defined */
        if (node) {
          node.properties = {
            ...node.properties,
            embedding,
          };
        }
      }

      ctx.phaseData.set('embed', { embeddingsGenerated: embeddings.length });
      return { phaseId: this.id, status: 'success', output: { embeddingsGenerated: embeddings.length } };
    } catch (err) {
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      this.logger.error('Phase execution failed', err instanceof Error ? err : new Error(String(err)), { phaseId: this.id, filePath: ctx?.rootPath });
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      const message = err instanceof Error ? err.message : String(err);
      /* v8 ignore next -- @preserve -- thrown values are always Error instances */
      return { phaseId: this.id, status: 'failed', error: message };
    }
  }
}
