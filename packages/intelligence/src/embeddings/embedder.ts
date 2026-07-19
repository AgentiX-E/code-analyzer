// @code-analyzer/intelligence — Embedding Engine
// Generates vector embeddings for code snippets with mock and real backends.

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Embedding Backend Interface
// ---------------------------------------------------------------------------

export interface EmbeddingBackend {
  embedCode(code: string): Promise<Float32Array>;
  embedBatch(codes: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Embedding Configuration
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  /** Vector dimensions (default: 768) */
  dimensions: number;
  /** Normalize output vectors to unit length (default: true) */
  normalize: boolean;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  dimensions: 768,
  normalize: true,
};

// ---------------------------------------------------------------------------
// Mock Backend — Deterministic Random-like Vectors from Content Hash
// ---------------------------------------------------------------------------

/**
 * Simple PRNG using a linear congruential generator seeded from hash bytes.
 * Produces reproducible pseudo-random numbers for deterministic embeddings.
 */
class DeterministicRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // ensure 32-bit unsigned
  }

  /** Generate next random number in [0, 1) */
  next(): number {
    // Multiplicative LCG (Knuth)
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return (this.state >>> 0) / 0x100000000;
  }
}

class MockEmbeddingBackend implements EmbeddingBackend {
  readonly dimensions: number;
  private readonly normalize: boolean;

  constructor(config: EmbeddingConfig = DEFAULT_CONFIG) {
    this.dimensions = config.dimensions;
    this.normalize = config.normalize;
  }

  async embedCode(code: string): Promise<Float32Array> {
    return this.generateVector(code);
  }

  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    // Use standard sequential embedding
    const results: Float32Array[] = [];
    for (const code of codes) {
      results.push(this.generateVector(code));
    }
    return results;
  }

  private generateVector(content: string): Float32Array {
    // Hash content with SHA-256 to get deterministic seed bytes
    const hash = createHash('sha256').update(content).digest();
    const seed = hash.readUInt32BE(0) ^ hash.readUInt32BE(4) ^
      hash.readUInt32BE(8) ^ hash.readUInt32BE(12);

    const rng = new DeterministicRNG(seed);
    const vec = new Float32Array(this.dimensions);

    for (let i = 0; i < this.dimensions; i++) {
      vec[i] = rng.next() * 2 - 1; // uniform in [-1, 1]
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
        const val = vec[i]! / norm;
        vec[i] = val;
      }
    }
  }

  dispose(): void {
    // No resources to free for mock backend
  }
}

// ---------------------------------------------------------------------------
// Real Backend — @agentix-e/embed-code-ts Wrapper
// ---------------------------------------------------------------------------

/**
 * Attempt to create a real embedding backend using @agentix-e/embed-code-ts.
 * Returns null if the package is not available.
 * Uses a dynamic import with fallback to avoid TypeScript compilation errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryCreateRealBackend(config: EmbeddingConfig): Promise<EmbeddingBackend | null> {
  try {
    // Dynamic import of optional native dependency
    const importFn = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<Record<string, unknown>>;
    const pkg = await importFn('@agentix-e/embed-code-ts');
    return new RealEmbeddingBackend(pkg, config);
  } catch {
    return null;
  }
}

class RealEmbeddingBackend implements EmbeddingBackend {
  private model: unknown | null = null;

  constructor(
    private pkg: Record<string, unknown>,
    private config: EmbeddingConfig,
  ) {}

  get dimensions(): number {
    return this.config.dimensions;
  }

  async embedCode(code: string): Promise<Float32Array> {
    await this.ensureModel();
    // Call the real embed function; the API may vary, so we try common patterns
    const embedFn = (this.pkg['embed'] ?? this.pkg['embedCode'] ?? this.pkg['run']) as unknown;
    if (typeof embedFn !== 'function') {
      throw new Error('@agentix-e/embed-code-ts does not export a callable embed function');
    }
    const result = await embedFn(code);
    if (result instanceof Float32Array) return result;
    if (Array.isArray(result)) return new Float32Array(result);
    // Handle object with embedding/vector field
    if (result && typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      const vec = obj['embedding'] ?? obj['vector'] ?? obj['data'];
      if (vec instanceof Float32Array) return vec;
      if (Array.isArray(vec)) return new Float32Array(vec as number[]);
    }
    throw new Error('Unexpected embedding result format');
  }

  async embedBatch(codes: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const code of codes) {
      results.push(await this.embedCode(code));
    }
    return results;
  }

  private async ensureModel(): Promise<void> {
    if (this.model !== null) return;
    const initFn = (this.pkg['initialize'] ?? this.pkg['loadModel'] ?? this.pkg['init']) as unknown;
    if (typeof initFn === 'function') {
      this.model = await (initFn as () => unknown)();
    } else {
      this.model = {}; // No initialization needed
    }
  }

  dispose(): void {
    this.model = null;
  }
}

// ---------------------------------------------------------------------------
// Embedding Engine
// ---------------------------------------------------------------------------

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
   * Initialize the model (lazy, first-use).
   * Attempts to use the real backend if available, falls back to mock.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const realBackend = await tryCreateRealBackend(this.config);
    if (realBackend) {
      this.backend = realBackend;
    }
    // Otherwise keep the mock backend (already set in constructor)

    this.initialized = true;
  }

  /**
   * Embed a single code snippet.
   */
  async embedCode(code: string): Promise<Float32Array> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.backend.embedCode(code);
  }

  /**
   * Batch embed multiple code snippets.
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
   * Get stored embedding for a node.
   */
  getEmbedding(nodeId: number): Float32Array | null {
    return this.embedStore.get(nodeId) ?? null;
  }

  /**
   * Incremental update: embed only new nodes.
   */
  async incrementalUpdate(
    nodeIds: number[],
    getNodeContent: (id: number) => string,
  ): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Collect content for nodes that don't already have embeddings
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
   * Check if the engine is initialized.
   */
  get isReady(): boolean {
    return this.initialized;
  }

  /**
   * Get backend dimensions.
   */
  get dimensions(): number {
    return this.backend.dimensions;
  }

  /**
   * Cleanup resources.
   */
  dispose(): void {
    this.backend.dispose();
    this.embedStore.clear();
    this.initialized = false;
  }
}
