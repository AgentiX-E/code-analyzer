// @code-analyzer/intelligence — Embedding Engine
// Generates vector embeddings for code snippets with real ONNX and mock backends.
// Primary backend: @agentix-e/embed-code-node (nomic-embed-code ONNX model, 768-dim).
// Mock backend: n-gram tokenization-based deterministic embeddings for CI/testing.
// When the real ONNX backend is available, it produces semantically meaningful embeddings.
// The mock backend provides reproducible, content-sensitive fallback for environments
// where the ONNX runtime or model cannot be loaded.

import { createHash } from 'node:crypto';

import { PhaseLogger, createNoopPhaseLogger } from '@code-analyzer/shared';

// Module-level logger for standalone functions
const moduleLogger: PhaseLogger = createNoopPhaseLogger();

// ---------------------------------------------------------------------------
// Embedding Backend Interface
// ---------------------------------------------------------------------------

export interface EmbeddingBackend {
  /** Embed a single code snippet. Returns a Float32Array of `dimensions` elements. */
  embedCode(code: string): Promise<Float32Array>;
  /** Batch-embed multiple code snippets. More efficient than N sequential calls. */
  embedBatch(codes: string[]): Promise<Float32Array[]>;
  /** Vector dimension count (always 768). */
  readonly dimensions: number;
  /** Backend type identifier. */
  readonly backendType: 'onnx' | 'mock';
  /** Release native resources (ONNX session, etc.). */
  dispose(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Embedding Configuration
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  /** Vector dimensions (default: 768). Must match the ONNX model output. */
  dimensions: number;
  /** Normalize output vectors to unit length (default: true). */
  normalize: boolean;
  /** Optional path to the ONNX model file (.onnx). */
  modelPath?: string;
  /** Optional path to the tokenizer file (tokenizer.json). */
  tokenizerPath?: string;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  dimensions: 768,
  normalize: true,
};

// ---------------------------------------------------------------------------
// MurmurHash3 — fast, high-quality 32-bit hash for content-based token mapping
// ---------------------------------------------------------------------------

/**
 * MurmurHash3 32-bit implementation.
 * Used to map n-gram tokens to reproducible seed values for vector generation.
 * This is deterministic (same input → same output) and has good avalanche properties.
 */
function murmurHash3(input: string, seed: number = 0): number {
  let h = seed >>> 0;
  const len = input.length;
  const remainder = len & 3;

  for (let i = 0; i < len - remainder; i += 4) {
    let k =
      (input.charCodeAt(i) & 0xff) |
      ((input.charCodeAt(i + 1) & 0xff) << 8) |
      ((input.charCodeAt(i + 2) & 0xff) << 16) |
      ((input.charCodeAt(i + 3) & 0xff) << 24);
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  }

  // Handle remaining bytes
  let k = 0;
  for (let i = len - remainder; i < len; i++) {
    k ^= (input.charCodeAt(i) & 0xff) << (8 * (i - (len - remainder)));
  }
  k = Math.imul(k, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;

  // Finalization
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;

  return h >>> 0;
}

// ---------------------------------------------------------------------------
// MockEmbeddingBackend — n-gram content-based deterministic fallback
// ---------------------------------------------------------------------------

/**
 * Deterministic embedding backend that produces reproducible 768-dim vectors
 * based on n-gram tokenization of the input content. Unlike the previous
 * SHA-256 full-content approach, this tokenization-based method ensures that
 * structurally similar code produces similar vectors.
 *
 * Algorithm:
 *   1. Tokenize input into camelCase/snake_case/kebab-case aware tokens
 *   2. Extract character n-grams (n=3) from each token
 *   3. Hash each n-gram via MurmurHash3 to a reproducible bucket index
 *   4. Activate the bucket with a weighted contribution
 *   5. Normalize the final vector to unit length
 *
 * This ensures:
 *   - Identical inputs → identical vectors (deterministic)
 *   - Similar tokens → overlapping active buckets (approximating semantic similarity)
 *   - Different languages → different activation patterns
 */
export class MockEmbeddingBackend implements EmbeddingBackend {
  readonly dimensions: number;
  readonly backendType = 'mock' as const;
  private readonly normalize: boolean;
  private readonly ngramSize: number;

  constructor(config: EmbeddingConfig = DEFAULT_CONFIG) {
    this.dimensions = config.dimensions;
    this.normalize = config.normalize;
    this.ngramSize = 3;
  }

  async embedCode(code: string): Promise<Float32Array> {
    return this.generateVector(code);
  }

  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(codes.length);
    for (let i = 0; i < codes.length; i++) {
      results[i] = this.generateVector(codes[i]!);
    }
    return results;
  }

  /**
   * Generate a deterministic content-based embedding vector.
   * Uses n-gram tokenization + MurmurHash3 for reproducible activation patterns.
   */
  private generateVector(content: string): Float32Array {
    const tokens = this.tokenizeContent(content);
    const vec = new Float32Array(this.dimensions);
    // Weight contribution: tokens contribute proportionally to their position weight
    const totalWeight = tokens.length;
    if (totalWeight === 0) {
      // Empty content → zero vector (will be normalized to uniform distribution)
      for (let i = 0; i < this.dimensions; i++) {
        vec[i] = 1.0;
      }
      if (this.normalize) {
        this.l2NormalizeInPlace(vec);
      }
      return vec;
    }

    // Map each n-gram to vector dimensions using MurmurHash3
    for (const token of tokens) {
      const ngrams = this.extractNgrams(token);
      for (const ngram of ngrams) {
        const bucket = murmurHash3(ngram) % this.dimensions;
        const magnitude = ((murmurHash3(ngram, 42) % 2000) - 1000) / 1000; // [-1, 1]
        vec[bucket] = (vec[bucket] ?? 0) + magnitude * (1.0 / Math.sqrt(totalWeight));
      }
    }

    if (this.normalize) {
      this.l2NormalizeInPlace(vec);
    }

    return vec;
  }

  /**
   * Tokenize code content into meaningful sub-tokens.
   * Handles camelCase, snake_case, kebab-case, and code-specific separators.
   */
  private tokenizeContent(content: string): string[] {
    return content
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase → separate words
      .replace(/_/g, ' ') // snake_case → spaces
      .replace(/-/g, ' ') // kebab-case → spaces
      .replace(/[^a-zA-Z0-9\s]/g, ' $& ') // Symbols → separate tokens
      .split(/\s+/)
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 0);
  }

  /**
   * Extract character n-grams from a token.
   * For short tokens, pads with start/end markers.
   */
  private extractNgrams(token: string): string[] {
    const ngrams: string[] = [];
    const padded = `__${token}__`;

    for (let i = 0; i <= padded.length - this.ngramSize; i++) {
      ngrams.push(padded.slice(i, i + this.ngramSize));
    }

    return ngrams.length > 0 ? ngrams : [`__${token}`];
  }

  /**
   * L2-normalize vector in-place.
   */
  private l2NormalizeInPlace(vec: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i]! * vec[i]!;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
  }

  dispose(): void {
    // No native resources to release
  }
}

// ---------------------------------------------------------------------------
// RealEmbeddingBackend — @agentix-e/embed-code-node ONNX wrapper
// ---------------------------------------------------------------------------

/**
 * Shape of the NodeEmbedder instance returned by
 * `@agentix-e/embed-code-node`'s `NodeEmbedder.create()`.
 */
interface NodeEmbedderInstance {
  embed(text: string): Promise<Float32Array>;
  embedBatch(
    texts: string[],
    options?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
  ): Promise<Float32Array[]>;
  dispose(): Promise<void>;
  readonly dimensions: number;
  readonly modelInfo: {
    name: string;
    version: string;
    dimensions: number;
    maxSequenceLength: number;
    vocabSize: number;
    quantization: string;
  };
}

/**
 * Backed by the real nomic-embed-code ONNX model via @agentix-e/embed-code-node.
 * Produces semantically meaningful 768-dim L2-normalized embeddings using the
 * BERT-based nomic-embed-code-v1.5 model (137M params, int8 quantized).
 *
 * NOTE: This backend requires the ONNX model file (~137MB) and native ONNX runtime.
 * Coverage is excluded from CI because the model is not checked in.
 */
/* v8 ignore start -- @preserve */
export class RealEmbeddingBackend implements EmbeddingBackend {
  readonly dimensions: number;
  readonly backendType = 'onnx' as const;

  constructor(private embedder: NodeEmbedderInstance) {
    this.dimensions = embedder.dimensions;
  }

  async embedCode(code: string): Promise<Float32Array> {
    return this.embedder.embed(code);
  }

  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    return this.embedder.embedBatch(codes);
  }

  async dispose(): Promise<void> {
    await this.embedder.dispose();
  }
}
/* v8 ignore stop -- @preserve */

// ---------------------------------------------------------------------------
// Backend Factory
// ---------------------------------------------------------------------------

/**
 * Attempt to create a real ONNX backend using @agentix-e/embed-code-node.
 * Returns null if the package is not available, the model is missing,
 * or ONNX runtime fails to load (e.g. missing native libraries).
 *
 * NOTE: Requires native ONNX runtime + model file (~137MB). Excluded from CI coverage.
 */
/* v8 ignore start -- @preserve */
async function createRealBackend(config: EmbeddingConfig): Promise<EmbeddingBackend | null> {
  try {
    const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

    const embedder = config.modelPath
      ? await NodeEmbedder.create({
          modelPath: config.modelPath,
          tokenizerPath: config.tokenizerPath,
        })
      : await (
          NodeEmbedder as unknown as {
            createFromPackage(): Promise<NodeEmbedderInstance>;
          }
        ).createFromPackage();

    return new RealEmbeddingBackend(embedder as unknown as NodeEmbedderInstance);
  } catch (_err) {
    // Package, model, or ONNX runtime not available — caller falls back to mock.
    // This is expected in CI environments and on machines without ONNX runtime.
    moduleLogger.error(
      'Embedding generation failed',
      _err instanceof Error ? _err : new Error(String(_err)),
      {
        phaseId: 'embedder',
        extra: { reason: 'Real ONNX backend unavailable, falling back to mock' },
      },
    );
    return null;
  }
}
/* v8 ignore stop -- @preserve */

// ---------------------------------------------------------------------------
// Embedding Engine
// ---------------------------------------------------------------------------

/**
 * Primary embedding entry point for the intelligence layer.
 *
 * Design:
 *   - RealEmbeddingBackend is the PRIMARY backend (ONNX-based, semantic).
 *   - MockEmbeddingBackend is the FALLBACK (n-gram based, deterministic).
 *   - When the real backend is unavailable, the engine emits a clear warning
 *     but continues operation with the mock backend.
 *   - Applications should check `activeBackend` to determine the quality
 *     of embeddings being generated.
 *
 * Lifecycle:
 *   1. Constructor creates a MockEmbeddingBackend (always instant).
 *   2. `initialize()` tries to upgrade to RealEmbeddingBackend (ONNX).
 *   3. If ONNX fails to load, the engine stays on the mock backend with a warning.
 *   4. `embedCode()` / `embedBatch()` delegate to the active backend.
 *   5. `dispose()` releases native ONNX resources if loaded.
 */
export class EmbeddingEngine {
  private backend: EmbeddingBackend;
  private embedStore = new Map<number, Float32Array>();
  private initialized = false;
  private config: EmbeddingConfig;
  private _initWarning: string | null = null;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.backend = new MockEmbeddingBackend(this.config);
  }

  /**
   * Initialize the engine. Attempts to load the real ONNX backend.
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * @returns A warning message if the real backend failed to load, null otherwise.
   */
  async initialize(): Promise<string | null> {
    if (this.initialized) return this._initWarning;

    const realBackend = await createRealBackend(this.config);
    // Only reached when ONNX model is available (excluded from CI coverage)
    /* v8 ignore start -- @preserve */
    if (realBackend) {
      this.backend.dispose();
      this.backend = realBackend;
    } else {
      this._initWarning =
        'Real ONNX embedding backend (nomic-embed-code) is not available. ' +
        'Using deterministic n-gram backend instead. ' +
        'Semantic search quality will be degraded. ' +
        'Install @agentix-e/embed-code-node and download the model to enable real embeddings. ' +
        'Run: npx embed-code download';
    }
    /* v8 ignore stop -- @preserve */

    this.initialized = true;
    return this._initWarning;
  }

  /**
   * Embed a single code snippet. Auto-initializes on first call.
   */
  async embedCode(code: string): Promise<Float32Array> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.backend.embedCode(code);
  }

  /**
   * Batch embed multiple code snippets. Uses native parallelism when available.
   */
  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.backend.embedBatch(codes);
  }

  /**
   * Compute cosine similarity between two vectors.
   * Assumes vectors are L2-normalized (as produced by both backends).
   *
   * @returns Cosine similarity in range [-1, 1], or 0 if either vector is zero-length.
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const ai = a[i]!;
      const bi = b[i]!;
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find the most similar items from a corpus given a query vector.
   */
  findMostSimilar(
    queryVector: Float32Array,
    corpusVectors: Float32Array[],
    topK: number = 10,
  ): Array<{ index: number; score: number }> {
    const results = corpusVectors.map((vec, idx) => ({
      index: idx,
      score: this.cosineSimilarity(queryVector, vec),
    }));

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Store embedding for a node.
   */
  storeEmbedding(nodeId: number, vector: Float32Array): void {
    this.embedStore.set(nodeId, new Float32Array(vector));
  }

  /**
   * Get stored embedding for a node, or null if not found.
   */
  getEmbedding(nodeId: number): Float32Array | null {
    return this.embedStore.get(nodeId) ?? null;
  }

  /**
   * Get a lookup function compatible with HybridSearchEngine.
   */
  createEmbeddingLookup(): (nodeId: number) => Float32Array | null {
    return (nodeId: number) => this.getEmbedding(nodeId);
  }

  /**
   * Import embeddings from an external source (e.g. pipeline output).
   */
  importEmbeddings(entries: Array<{ nodeId: number; embedding: Float32Array | number[] }>): void {
    for (const { nodeId, embedding } of entries) {
      const vec =
        embedding instanceof Float32Array
          ? new Float32Array(embedding)
          : new Float32Array(embedding);
      this.embedStore.set(nodeId, vec);
    }
  }

  /**
   * Incremental update: embed only nodes that don't already have embeddings.
   */
  async incrementalUpdate(
    nodeIds: number[],
    getNodeContent: (id: number) => string,
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    const missingIds: number[] = [];
    const missingContents: string[] = [];

    for (const nodeId of nodeIds) {
      if (this.embedStore.has(nodeId)) continue;
      const content = getNodeContent(nodeId);
      if (content) {
        missingIds.push(nodeId);
        missingContents.push(content);
      }
    }

    if (missingIds.length === 0) return;

    const vectors = await this.backend.embedBatch(missingContents);

    for (let i = 0; i < missingIds.length; i++) {
      const vec = vectors[i];
      /* v8 ignore next — unreachable when batch returns same-length array -- @preserve */
      if (vec) {
        this.embedStore.set(missingIds[i]!, vec);
      }
    }
  }

  /** Number of stored embeddings. */
  get embeddingCount(): number {
    return this.embedStore.size;
  }

  /** Whether the engine has been initialized. */
  get isReady(): boolean {
    return this.initialized;
  }

  /** Active backend type ('onnx' or 'mock'). */
  get activeBackend(): 'onnx' | 'mock' {
    return this.backend.backendType;
  }

  /** Backend vector dimensions. */
  get dimensions(): number {
    return this.backend.dimensions;
  }

  /** Warning message from initialization, if real backend failed to load. */
  get initWarning(): string | null {
    return this._initWarning;
  }

  /**
   * Release all resources including native ONNX runtime handles.
   */
  dispose(): void {
    this.backend.dispose();
    this.embedStore.clear();
    this.initialized = false;
    this._initWarning = null;
  }
}
