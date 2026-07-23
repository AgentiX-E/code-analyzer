// @code-analyzer/intelligence — Embedding Engine
// Generates vector embeddings for code snippets with real ONNX and mock backends.
// Uses @agentix-e/embed-code-node for nomic-embed-code inference when available.
// Falls back to deterministic hash-based embeddings when ONNX runtime is unavailable.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Embedding Backend Interface
// ---------------------------------------------------------------------------

export interface EmbeddingBackend {
  embedCode(code: string): Promise<Float32Array>;
  embedBatch(codes: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
  readonly backendType: 'onnx' | 'mock';
  dispose(): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Embedding Configuration
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  /** Vector dimensions (default: 768) */
  dimensions: number;
  /** Normalize output vectors to unit length (default: true) */
  normalize: boolean;
  /** Optional path to ONNX model file */
  modelPath?: string;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  dimensions: 768,
  normalize: true,
};

// ---------------------------------------------------------------------------
// DeterministicRNG — reproducible pseudo-random number generator
// ---------------------------------------------------------------------------

class DeterministicRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return (this.state >>> 0) / 0x100000000;
  }
}

// ---------------------------------------------------------------------------
// MockEmbeddingBackend — deterministic hash-based fallback
// ---------------------------------------------------------------------------

export class MockEmbeddingBackend implements EmbeddingBackend {
  readonly dimensions: number;
  readonly backendType = 'mock' as const;
  private readonly normalize: boolean;

  constructor(config: EmbeddingConfig = DEFAULT_CONFIG) {
    this.dimensions = config.dimensions;
    this.normalize = config.normalize;
  }

  async embedCode(code: string): Promise<Float32Array> {
    return this.generateVector(code);
  }

  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const code of codes) {
      results.push(this.generateVector(code));
    }
    return results;
  }

  private generateVector(content: string): Float32Array {
    const hash = createHash('sha256').update(content).digest();
    const seed = hash.readUInt32BE(0) ^ hash.readUInt32BE(4) ^
      hash.readUInt32BE(8) ^ hash.readUInt32BE(12);

    const rng = new DeterministicRNG(seed);
    const vec = new Float32Array(this.dimensions);

    for (let i = 0; i < this.dimensions; i++) {
      vec[i] = rng.next() * 2 - 1;
    }

    if (this.normalize) {
      this.normalizeVector(vec);
    }

    return vec;
  }

  private normalizeVector(vec: Float32Array): void {
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
  embedBatch(texts: string[], options?: { concurrency?: number; onProgress?: (done: number, total: number) => void }): Promise<Float32Array[]>;
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
 * Produces semantically meaningful 768-dim L2-normalized embeddings.
 *
 * NOTE: This backend requires the ONNX model file and native runtime.
 * Coverage is excluded from CI because the model (~137MB) is not checked in.
 */
/* v8 ignore next 22 */
export class RealEmbeddingBackend implements EmbeddingBackend {
  readonly dimensions: number;
  readonly backendType = 'onnx' as const;

  constructor(
    private embedder: NodeEmbedderInstance,
  ) {
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
/* v8 ignore next 14 */
async function createRealBackend(config: EmbeddingConfig): Promise<EmbeddingBackend | null> {
  try {
    const { NodeEmbedder } = await import('@agentix-e/embed-code-node');

    const modelPath = config.modelPath;
    const embedder = modelPath
      ? await NodeEmbedder.create({ modelPath })
      : await (NodeEmbedder as unknown as { createFromPackage(): Promise<NodeEmbedderInstance> }).createFromPackage();

    return new RealEmbeddingBackend(embedder as unknown as NodeEmbedderInstance);
  } catch {
    // Package, model, or ONNX runtime not available — caller falls back to mock
    return null;
  }
}

// ---------------------------------------------------------------------------
// Embedding Engine
// ---------------------------------------------------------------------------

/**
 * Primary embedding entry point for the intelligence layer.
 *
 * Lifecycle:
 *   1. Constructor creates a MockEmbeddingBackend (always available).
 *   2. `initialize()` tries to upgrade to RealEmbeddingBackend (ONNX).
 *   3. `embedCode()` / `embedBatch()` delegate to the active backend.
 *   4. `dispose()` releases native ONNX resources if loaded.
 */
export class EmbeddingEngine {
  private backend: EmbeddingBackend;
  private embedStore = new Map<number, Float32Array>();
  private initialized = false;
  private config: EmbeddingConfig;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.backend = new MockEmbeddingBackend(this.config);
  }

  /**
   * Initialize the engine. Attempts to load the real ONNX backend.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const realBackend = await createRealBackend(this.config);
    // Only reached when ONNX model is available (excluded from CI coverage)
    /* v8 ignore next 4 */
    if (realBackend) {
      // Dispose the mock backend before replacing
      this.backend.dispose();
      this.backend = realBackend;
    }

    this.initialized = true;
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
   * Get a lookup function compatible with HybridSearchEngine.registerEmbeddings.
   */
  createEmbeddingLookup(): (nodeId: number) => Float32Array | null {
    return (nodeId: number) => this.getEmbedding(nodeId);
  }

  /**
   * Import embeddings from an external source (e.g. pipeline output).
   * Accepts both Float32Array and number[] for flexibility.
   */
  importEmbeddings(entries: Array<{ nodeId: number; embedding: Float32Array | number[] }>): void {
    for (const { nodeId, embedding } of entries) {
      const vec = embedding instanceof Float32Array
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
      if (vec) {
        this.embedStore.set(missingIds[i]!, vec);
      }
    }
  }

  /**
   * Number of stored embeddings.
   */
  get embeddingCount(): number {
    return this.embedStore.size;
  }

  /**
   * Whether the engine has been initialized.
   */
  get isReady(): boolean {
    return this.initialized;
  }

  /**
   * Active backend type ('onnx' or 'mock').
   */
  get activeBackend(): 'onnx' | 'mock' {
    return this.backend.backendType;
  }

  /**
   * Backend vector dimensions.
   */
  get dimensions(): number {
    return this.backend.dimensions;
  }

  /**
   * Release all resources including native ONNX runtime handles.
   */
  dispose(): void {
    this.backend.dispose();
    this.embedStore.clear();
    this.initialized = false;
  }
}
