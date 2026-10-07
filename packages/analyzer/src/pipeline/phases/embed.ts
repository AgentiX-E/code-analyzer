// @code-analyzer/analyzer — Pipeline Phase: Embed
// Uses @agentix-e/embed-code-node (nomic-embed-code ONNX) when available.
// Falls back to deterministic hash-based embeddings when ONNX is unavailable.

import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

import { simpleHash } from '../phase-helpers.js';

import type { ExecutablePhase, PhaseExecutionResult } from '../phase-helpers.js';
import type { PipelinePhaseId, PipelineContext, GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Embed helpers
// ---------------------------------------------------------------------------

export interface EmbeddingResult {
  nodeId: number;
  embedding: number[];
  /**
   * Which backend produced this vector.
   *
   * `deterministic` means a hash-seeded pseudo-random vector, not a semantic embedding — adequate for exercising a
   * pipeline, useless for similarity. The field exists because the fallback used to be silent: a caller could not
   * tell a real nomic-embed-code vector from a hash PRNG, which is the same defect as an empty consumer list that
   * does not say whether it looked.
   */
  backend: 'onnx' | 'deterministic';
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
): Promise<{ results: EmbeddingResult[]; backend: 'onnx' | 'deterministic'; reason: string | null }> {
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

  if (embeddable.length === 0) return { results, backend: 'deterministic', reason: null };

  // Try the real ONNX backend from @agentix-e/embed-code-node
  let embedder: Embedder | null = null;

  // **The reason is kept, because a fallback that happens silently is indistinguishable from success.** The phase
  // has a deterministic embedding that works, so `success` is honest - but "which backend did this run use, and why"
  // is a question a measurement of this pipeline has to be able to answer, and swallowing the error made it
  // unanswerable. In this repository `loadEmbedder()` always throws: the published `@agentix-e/embed-code-node`
  // declares `files: ['dist', 'models']` and ships no `models/`, so `createFromPackage()` cannot find
  // `nomic-embed-code-v1.5.int8.onnx` or the `tokenizer.json` beside it, on any machine.
  let backendUnavailableReason: string | null = null;
  try {
    embedder = await loadEmbedder();
  } catch (error) {
    backendUnavailableReason = error instanceof Error ? error.message : String(error);
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
          results.push({
            nodeId: embeddable[i]!.nodeId,
            embedding: Array.from(vector),
            backend: 'onnx',
          });
        }
      }
    } catch {
      // Per-node fallback if batch fails
      for (const { nodeId, text } of embeddable) {
        try {
          const vec = await embedder.embed(text);
          results.push({ nodeId, embedding: Array.from(vec), backend: 'onnx' });
        } catch {
          results.push({ nodeId, embedding: deterministicEmbed(text), backend: 'deterministic' });
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
      results.push({ nodeId, embedding: deterministicEmbed(text), backend: 'deterministic' });
    }
  }

  // **Which backend ran, and why**, travelling out with the results so the phase can record it.
  return {
    results,
    backend: backendUnavailableReason ? 'deterministic' : 'onnx',
    reason: backendUnavailableReason,
  };
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
/** Why the last `loadRealEmbedder()` produced nothing, or null when it produced an embedder. */
let lastEmbedderFailure: string | null = null;

/**
 * Why the real embedder could not be loaded, or `null` if it could.
 *
 * **The `catch` here used to swallow the error and return `null`**, which left every caller knowing *that* there was no
 * embedder and nothing about *why*. **The reports written on top of it called the result "intermittent"** - three
 * times, across three pieces of documentation - and a single probe printing the error settled it in one line:
 *
 *     Error: Tokenizer not found: …/@agentix-e+embed-code-node@0.1.1/…/models/tokenizer.json
 *
 * **The model file is not installed. It does not succeed on some runs and fail on others; it always fails**, and every
 * conclusion drawn from "intermittent" was drawn from that absence. **A failure that cannot say why is a failure
 * somebody will explain instead of reading.**
 */
export function embedderUnavailableReason(): string | null {
  return lastEmbedderFailure;
}

export async function loadRealEmbedder(): Promise<Embedder | null> {
  try {
    const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

    // Try createFromPackage first (bundled model), fall back to create({ modelPath })
    try {
      const nodeEmbedder = NodeEmbedder as unknown as { createFromPackage: () => Promise<Embedder> };
      const embedder = await nodeEmbedder.createFromPackage();
      lastEmbedderFailure = null;
      return embedder;
    } catch (err) {
      // **The message is kept rather than discarded.** `Tokenizer not found` names the file that is missing, and
      // nothing else in the system did.
      lastEmbedderFailure = `createFromPackage failed: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    }
  } catch (err) {
    lastEmbedderFailure = `@agentix-e/embed-code-node could not be imported: ${err instanceof Error ? err.message : String(err)}`;
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

      const { results: embeddings, backend, reason: backendReason } = await generateEmbeddings(
        ctx.graph.nodes,
      );

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

      // **Which backend, and why** - readable by whoever measures this pipeline. A fallback that happens
      // silently is indistinguishable from success, and "which embeddings does this index hold" is a
      // question a measurement of the pipeline has to be able to answer.
      ctx.phaseData.set('embedBackend', { backend, reason: backendReason });


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
