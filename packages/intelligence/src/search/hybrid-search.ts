// @code-analyzer/intelligence — Hybrid Search Engine
// Combines BM25 text search with vector semantic search using Reciprocal Rank Fusion.

import type { GraphNode, SearchOptions, NodeLabel } from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

// ---------------------------------------------------------------------------
// Search-specific interfaces
// ---------------------------------------------------------------------------

/** Internal ranked result with a single score dimension */
export interface RankedResult {
  node: GraphNode;
  score: number;
}

/** Combined search result with per-source scores */
export interface HybridSearchResult {
  node: GraphNode;
  bm25Score: number;
  vectorScore: number;
  combinedScore: number;
}

/** Filters applied during search */
interface SearchFilters {
  labels?: NodeLabel[];
  filePattern?: string;
  isExported?: boolean;
  minComplexity?: number;
  maxComplexity?: number;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

/**
 * Tokenize an identifier string by splitting on camelCase, snake_case, and kebab-case boundaries.
 * Example: "getUserProfile" -> ["get", "user", "profile"]
 * Example: "process_request" -> ["process", "request"]
 * Example: "my-component" -> ["my", "component"]
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // Replace separators with spaces
  const withSpaces = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMCamel
    .replace(/[_\-.]+/g, ' ') // snake_case, kebab-case, dot.separated
    .replace(/\s+/g, ' ')
    .trim();

  return withSpaces
    .split(' ')
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// BM25 Implementation
// ---------------------------------------------------------------------------

/**
 * BM25 ranking function.
 * k1: term frequency saturation parameter (default 1.2).
 * b: document length normalization parameter (default 0.75).
 */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

interface DocEntry {
  nodeId: number;
  node: GraphNode;
  docTerms: Map<string, number>; // term -> tf
  docLength: number;
}

class InvertedIndex {
  /** term -> list of (nodeId, tf) */
  private readonly index = new Map<string, Array<{ nodeId: number; tf: number }>>();
  private readonly docs = new Map<number, DocEntry>();
  private totalDocLength = 0;
  private avgDocLength = 0;

  addDocument(node: GraphNode): void {
    const nodeId = node.id;

    // Build text from name + signature
    const fields: string[] = [node.name, node.qualifiedName];
    if (node.signature) fields.push(node.signature);
    if (node.docstring) fields.push(node.docstring);

    const allTokens: string[] = [];
    for (const field of fields) {
      allTokens.push(...tokenize(field));
    }

    // Compute term frequencies
    const tf = new Map<string, number>();
    for (const token of allTokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const docEntry: DocEntry = {
      nodeId,
      node,
      docTerms: tf,
      docLength: allTokens.length,
    };

    this.docs.set(nodeId, docEntry);
    this.totalDocLength += allTokens.length;

    // Invert index
    for (const [term, freq] of tf) {
      const postings = this.index.get(term);
      if (postings) {
        postings.push({ nodeId, tf: freq });
      } else {
        this.index.set(term, [{ nodeId, tf: freq }]);
      }
    }
  }

  removeDocument(nodeId: number): void {
    const doc = this.docs.get(nodeId);
    if (!doc) return;

    for (const term of doc.docTerms.keys()) {
      const postings = this.index.get(term);
      if (postings) {
        const idx = postings.findIndex((p) => p.nodeId === nodeId);
        if (idx >= 0) postings.splice(idx, 1);
        if (postings.length === 0) this.index.delete(term);
      }
    }

    this.totalDocLength -= doc.docLength;
    this.docs.delete(nodeId);
  }

  buildIndex(store: InMemoryGraphStore): void {
    const nodes = store.getAllNodes();
    for (const node of nodes) {
      this.addDocument(node);
    }
    this.recomputeAvg();
  }

  private recomputeAvg(): void {
    this.avgDocLength = this.docs.size > 0 ? this.totalDocLength / this.docs.size : 0;
  }

  /**
   * Score a document node against a query using BM25.
   */
  scoreDocument(query: string, nodeId: number): number {
    const doc = this.docs.get(nodeId);
    if (!doc) return 0;

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return 0;

    let score = 0;
    const N = this.docs.size;

    for (const term of queryTerms) {
      const postings = this.index.get(term);
      if (!postings) continue;

      const df = postings.length;
      // Ensure df > 0 before computing IDF
      if (df === 0) continue;

      const tf = doc.docTerms.get(term) ?? 0;
      if (tf === 0) continue;

      // BM25 IDF: log(1 + (N - df + 0.5) / (df + 0.5))
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      // BM25 TF: ((k1 + 1) * tf) / (k1 * ((1 - b) + b * dl / avgdl) + tf)
      const dl = doc.docLength;
      const avgdl = this.avgDocLength;
      const denom = BM25_K1 * (1 - BM25_B + BM25_B * dl / avgdl) + tf;
      const tfScore = ((BM25_K1 + 1) * tf) / denom;

      score += idf * tfScore;
    }

    return score;
  }

  /**
   * Search using BM25 and return ranked results.
   */
  search(query: string, filters?: SearchFilters): RankedResult[] {
    const candidates = new Set<number>();

    // Get candidate documents by finding postings for query terms
    const queryTerms = tokenize(query);
    for (const term of queryTerms) {
      const postings = this.index.get(term);
      if (postings) {
        for (const p of postings) {
          candidates.add(p.nodeId);
        }
      }
    }

    // If no candidates, search all docs as fallback
    if (candidates.size === 0) {
      for (const nodeId of this.docs.keys()) {
        candidates.add(nodeId);
      }
    }

    const results: RankedResult[] = [];

    for (const nodeId of candidates) {
      const doc = this.docs.get(nodeId);
      if (!doc) continue;

      // Apply filters
      if (!this.passesFilters(doc.node, filters)) continue;

      const score = this.scoreDocument(query, nodeId);
      if (score > 0) {
        results.push({ node: doc.node, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  private passesFilters(node: GraphNode, filters?: SearchFilters): boolean {
    if (!filters) return true;

    if (filters.labels && filters.labels.length > 0) {
      if (!filters.labels.includes(node.label)) return false;
    }

    if (filters.filePattern) {
      if (!node.filePath) return false;
      const regex = new RegExp(filters.filePattern.replace(/\*/g, '.*'), 'i');
      if (!regex.test(node.filePath)) return false;
    }

    if (filters.isExported !== undefined) {
      if (node.isExported !== filters.isExported) return false;
    }

    if (filters.minComplexity !== undefined) {
      if (node.complexity === null || node.complexity < filters.minComplexity) return false;
    }

    if (filters.maxComplexity !== undefined) {
      if (node.complexity !== null && node.complexity > filters.maxComplexity) return false;
    }

    return true;
  }

  /** Number of indexed documents */
  get documentCount(): number {
    return this.docs.size;
  }

  /** Clear the index */
  clear(): void {
    this.index.clear();
    this.docs.clear();
    this.totalDocLength = 0;
    this.avgDocLength = 0;
  }
}

// ---------------------------------------------------------------------------
// Vector Search
// ---------------------------------------------------------------------------

type EmbeddingLookupFn = (nodeId: number) => Float32Array | null;
type EmbedContentFn = (content: string) => Promise<Float32Array>;

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

// ---------------------------------------------------------------------------
// Hybrid Search Engine
// ---------------------------------------------------------------------------

export class HybridSearchEngine {
  private readonly index = new InvertedIndex();
  private getEmbeddingForNode: EmbeddingLookupFn | null = null;
  private embedContent: EmbedContentFn | null = null;
  private initialized = false;

  constructor(private store: InMemoryGraphStore) {}

  /**
   * Initialize the search engine by building the inverted index.
   */
  initialize(): void {
    this.index.buildIndex(this.store);
    this.initialized = true;
  }

  /**
   * Register embedding functions for vector search support.
   */
  registerEmbeddings(
    lookupFn: EmbeddingLookupFn,
    contentFn?: EmbedContentFn,
  ): void {
    this.getEmbeddingForNode = lookupFn;
    this.embedContent = contentFn ?? null;
  }

  /**
   * Hybrid BM25 + vector search with Reciprocal Rank Fusion (k=60).
   */
  async search(options: SearchOptions): Promise<HybridSearchResult[]> {
    if (!this.initialized) {
      this.initialize();
    }

    const filters: SearchFilters = {
      labels: options.labels,
      filePattern: options.filePath,
    };

    // BM25 search (synchronous)
    const bm25Results = this.bm25Search(options.query, filters);

    // Vector search (async, requires embeddings)
    const topK = options.limit ?? 20;
    const canVectorSearch = this.getEmbeddingForNode && this.embedContent;

    let vectorResults: RankedResult[] = [];
    if (canVectorSearch) {
      vectorResults = await this.vectorSearch(options.query, topK);
    }

    // Fuse results
    return this.fuseResults(bm25Results, vectorResults, 60, options.limit ?? undefined);
  }

  /**
   * BM25 text search using an inverted index built from node names and signatures.
   */
  bm25Search(query: string, filters?: SearchFilters): RankedResult[] {
    return this.index.search(query, filters);
  }

  /**
   * Vector semantic search.
   * Requires embeddings to be pre-computed and the embedContent function to be registered.
   */
  async vectorSearch(query: string, topK: number): Promise<RankedResult[]> {
    const results: RankedResult[] = [];

    if (!this.embedContent || !this.getEmbeddingForNode) {
      return results;
    }

    // Compute query embedding
    const queryEmbedding = await this.embedContent(query);

    // Score all nodes with stored embeddings
    const allNodes = this.store.getAllNodes();
    for (const node of allNodes) {
      const nodeEmbedding = this.getEmbeddingForNode(node.id);
      if (!nodeEmbedding) continue;

      const similarity = cosineSimilarity(queryEmbedding, nodeEmbedding);
      if (similarity > 0) {
        results.push({ node, score: similarity });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  /**
   * Reciprocal Rank Fusion: combines BM25 and vector results.
   * k parameter controls the significance of rank position (default 60).
   */
  fuseResults(
    bm25Results: RankedResult[],
    vectorResults: RankedResult[],
    k: number = 60,
    limit?: number,
  ): HybridSearchResult[] {
    const combined = new Map<number, HybridSearchResult>();

    // Score BM25 results by reciprocal rank
    for (let i = 0; i < bm25Results.length; i++) {
      const r = bm25Results[i]!;
      const rrfScore = 1 / (k + i + 1); // rank starts at 1
      const existing = combined.get(r.node.id);
      if (existing) {
        existing.bm25Score = r.score;
        existing.combinedScore += rrfScore;
      } else {
        combined.set(r.node.id, {
          node: r.node,
          bm25Score: r.score,
          vectorScore: 0,
          combinedScore: rrfScore,
        });
      }
    }

    // Score vector results by reciprocal rank
    for (let i = 0; i < vectorResults.length; i++) {
      const r = vectorResults[i]!;
      const rrfScore = 1 / (k + i + 1);
      const existing = combined.get(r.node.id);
      if (existing) {
        existing.vectorScore = r.score;
        existing.combinedScore += rrfScore;
      } else {
        combined.set(r.node.id, {
          node: r.node,
          bm25Score: 0,
          vectorScore: r.score,
          combinedScore: rrfScore,
        });
      }
    }

    // Sort by combined score descending
    const resultsArray = Array.from(combined.values());
    resultsArray.sort(
      (a, b) => b.combinedScore - a.combinedScore,
    );

    if (limit !== undefined && limit > 0) {
      return resultsArray.slice(0, limit);
    }

    return resultsArray;
  }

  /**
   * Add or update a node in the inverted index.
   */
  refreshNode(node: GraphNode): void {
    this.index.removeDocument(node.id);
    this.index.addDocument(node);
  }

  /**
   * Remove a node from the inverted index.
   */
  removeNode(nodeId: number): void {
    this.index.removeDocument(nodeId);
  }

  /**
   * Rebuild the entire inverted index from the store.
   */
  rebuildIndex(): void {
    this.index.clear();
    this.index.buildIndex(this.store);
  }

  /** Number of indexed documents */
  get documentCount(): number {
    return this.index.documentCount;
  }
}
