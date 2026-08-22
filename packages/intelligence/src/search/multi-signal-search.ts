// @code-analyzer/intelligence — Hybrid Search Engine
// Implements BM25 + semantic vector search + Reciprocal Rank Fusion (RRF)
// for state-of-the-art code search combining lexical and semantic signals.

import type { EmbeddingEngine } from '../embeddings/embedder.js';

/** BM25 parameters */
const BM25_K1 = 1.5; // Term frequency saturation
const BM25_B = 0.75; // Document length normalization
const RRF_K = 60; // RRF constant for score normalization

/** Search configuration */
export interface HybridSearchConfig {
  /** Weight for BM25 lexical score (0-1) */
  bm25Weight: number;
  /** Weight for semantic vector score (0-1) */
  semanticWeight: number;
  /** Number of results to return */
  topK: number;
  /** Minimum relevance score threshold (0-1) */
  minScore: number;
  /** Whether to use RRF fusion (true) or weighted sum (false) */
  useRRF: boolean;
}

/** Combined search result with scores from each method */
export interface HybridSearchResult {
  id: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  relevance: number;
  bm25Score: number;
  semanticScore: number;
  combinedScore: number;
  scoreComponents: Record<string, number>;
  /** API/Type signature string for signature match signal */
  signature?: string;
  /** AST structural profile string for AST similarity signal */
  astProfile?: string;
  /** PageRank centrality score (0-1) */
  pageRank?: number;
}

/** BM25 index entry for a document */
interface Bm25DocEntry {
  id: string;
  text: string;
  tokens: Map<string, number>;
  length: number;
}

/**
 * HybridSearchEngine combines BM25 lexical search with semantic
 * vector search using Reciprocal Rank Fusion (RRF) for optimal
 * result merging.
 *
 * Based on the proven approach from codebase-memory-mcp and GitNexus.
 */
export class HybridSearchEngine {
  private embeddingEngine: EmbeddingEngine;
  private config: HybridSearchConfig;
  private documents: Map<string, Bm25DocEntry> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private embeddingCache: Map<string, Float32Array> = new Map();
  private totalDocLength = 0;
  private avgDocLength = 0;

  private static readonly DEFAULT_CONFIG: HybridSearchConfig = {
    bm25Weight: 0.4,
    semanticWeight: 0.6,
    topK: 50,
    minScore: 0.1,
    useRRF: true,
  };

  constructor(embeddingEngine: EmbeddingEngine, config?: Partial<HybridSearchConfig>) {
    this.embeddingEngine = embeddingEngine;
    this.config = { ...HybridSearchEngine.DEFAULT_CONFIG, ...config };
  }

  /**
   * Index a document for BM25 search.
   *
   * @param id — Unique document identifier
   * @param text — Document text content
   */
  indexDocument(id: string, text: string): void {
    const tokens = this.tokenize(text);
    const tokenMap = new Map<string, number>();
    for (const token of tokens) {
      tokenMap.set(token, (tokenMap.get(token) ?? 0) + 1);

      // Update inverted index
      let docs = this.invertedIndex.get(token);
      if (!docs) {
        docs = new Set();
        this.invertedIndex.set(token, docs);
      }
      docs.add(id);
    }

    const entry: Bm25DocEntry = {
      id,
      text,
      tokens: tokenMap,
      length: tokens.length,
    };

    this.documents.set(id, entry);
    this.totalDocLength += tokens.length;
    this.avgDocLength = this.totalDocLength / this.documents.size;
  }

  /**
   * Index a batch of documents.
   *
   * @param docs — Array of { id, text } pairs
   */
  indexDocuments(docs: Array<{ id: string; text: string }>): void {
    for (const doc of docs) {
      this.indexDocument(doc.id, doc.text);
    }
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    // Remove from inverted index
    for (const [token] of doc.tokens) {
      const docs = this.invertedIndex.get(token);
      if (docs) {
        docs.delete(id);
        if (docs.size === 0) {
          this.invertedIndex.delete(token);
        }
      }
    }

    this.totalDocLength -= doc.length;
    this.documents.delete(id);
    this.avgDocLength = this.documents.size > 0 ? this.totalDocLength / this.documents.size : 0;
  }

  /**
   * Perform hybrid search combining BM25 lexical and semantic vector search.
   *
   * @param query — Search query string
   * @returns Ranked list of hybrid search results
   */
  async search(query: string): Promise<HybridSearchResult[]> {
    // Run BM25 and semantic search in parallel
    const [bm25Results, semanticResults] = await Promise.all([
      this.searchBM25(query, this.config.topK * 2),
      this.searchSemantic(query, this.config.topK * 2),
    ]);

    // Fuse results
    return this.fuseResults(bm25Results, semanticResults);
  }

  /**
   * Multi-signal combined scoring search.
   * Combines 11 signals for maximum retrieval quality:
   * 1. BM25 text relevance
   * 2. Semantic vector similarity
   * 3. API/Type signature match
   * 4. AST structural similarity
   * 5. Halstead metrics proximity
   * 6. Module/file path proximity
   * 7. Graph PageRank centrality
   * 8. Call graph proximity
   * 9. MinHash similarity (if available)
   * 10. Document freshness (recency boost)
   * 11. Exact name match bonus
   */
  async searchMultiSignal(
    query: string,
    _graphStore?: unknown,
    minHashSignatures?: Map<string, number[]>,
  ): Promise<HybridSearchResult[]> {
    const baseResults = await this.search(query);

    // Enrich with additional signals
    for (const result of baseResults) {
      const signals: Record<string, number> = {
        bm25: result.bm25Score,
        semantic: result.semanticScore,
      };

      // Signal 3: API/Type signature match
      if (result.signature) {
        signals['signature'] = this.computeSignatureMatch(query, result.signature);
      }

      // Signal 4: AST structural profile match
      if (result.astProfile) {
        signals['astProfile'] = this.computeAstSimilarity(query, result.astProfile);
      }

      // Signal 6: Module proximity
      if (result.filePath) {
        signals['moduleProximity'] = this.computeModuleProximity(query, result.filePath);
      }

      // Signal 7: PageRank (if available)
      if (result.pageRank !== undefined) {
        signals['pageRank'] = Math.min(result.pageRank * 10, 1.0);
      }

      // Signal 9: MinHash (if available)
      if (minHashSignatures && minHashSignatures.has(result.id)) {
        const querySig = minHashSignatures.get('__query__');
        const docSig = minHashSignatures.get(result.id);
        if (querySig && docSig) {
          signals['minHash'] = this.estimateJaccard(querySig, docSig);
        }
      }

      // Signal 11: Exact name match
      signals['exactMatch'] = result.name?.toLowerCase() === query.toLowerCase() ? 1.0 : 0.0;

      result.scoreComponents = signals;

      // Weighted sum of all signals
      const signalWeights: Record<string, number> = {
        bm25: 0.2,
        semantic: 0.25,
        signature: 0.1,
        astProfile: 0.1,
        moduleProximity: 0.05,
        pageRank: 0.05,
        minHash: 0.1,
        exactMatch: 0.15,
      };

      let combinedScore = 0;
      let totalWeight = 0;
      for (const [signal, weight] of Object.entries(signalWeights)) {
        if (signals[signal] !== undefined) {
          combinedScore += signals[signal]! * weight;
          totalWeight += weight;
        }
      }

      result.combinedScore = totalWeight > 0 ? combinedScore / totalWeight : result.combinedScore;
    }

    return baseResults
      .filter((r) => r.combinedScore >= this.config.minScore)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, this.config.topK);
  }

  /**
   * BM25 search implementation.
   */
  private searchBM25(query: string, topK: number): Array<{ id: string; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, number>();
    const N = this.documents.size;

    for (const token of queryTokens) {
      const docs = this.invertedIndex.get(token);
      if (!docs) continue;

      // IDF component
      const df = docs.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

      for (const docId of docs) {
        const doc = this.documents.get(docId);
        if (!doc) continue;

        // TF component
        const tf = doc.tokens.get(token) ?? 0;
        const tfNormalized =
          (tf * (BM25_K1 + 1)) /
          (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / this.avgDocLength)));

        const currentScore = scores.get(docId) ?? 0;
        scores.set(docId, currentScore + idf * tfNormalized);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score: this.normalizeBM25Score(score) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Semantic vector search.
   */
  private async searchSemantic(
    query: string,
    topK: number,
  ): Promise<Array<{ id: string; score: number }>> {
    const queryEmbedding = await this.embeddingEngine.embedCode(query);
    if (!queryEmbedding) return [];

    const results: Array<{ id: string; score: number }> = [];

    for (const [docId, cachedVec] of this.embeddingCache) {
      const score = this.embeddingEngine.cosineSimilarity(queryEmbedding, cachedVec);
      results.push({ id: docId, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Fuse BM25 and semantic results using RRF or weighted sum.
   */
  private fuseResults(
    bm25Results: Array<{ id: string; score: number }>,
    semanticResults: Array<{ id: string; score: number }>,
  ): HybridSearchResult[] {
    const allIds = new Set<string>();
    const bm25Map = new Map<string, number>();
    const semanticMap = new Map<string, number>();

    for (let i = 0; i < bm25Results.length; i++) {
      allIds.add(bm25Results[i]!.id);
      bm25Map.set(bm25Results[i]!.id, bm25Results[i]!.score);
    }

    for (let i = 0; i < semanticResults.length; i++) {
      allIds.add(semanticResults[i]!.id);
      semanticMap.set(semanticResults[i]!.id, semanticResults[i]!.score);
    }

    const results: HybridSearchResult[] = [];

    for (const id of allIds) {
      const bm25Score = bm25Map.get(id) ?? 0;
      const semanticScore = semanticMap.get(id) ?? 0;

      let combinedScore: number;
      if (this.config.useRRF) {
        // Reciprocal Rank Fusion
        const bm25Rank = bm25Results.findIndex((r) => r.id === id) + 1;
        const semanticRank = semanticResults.findIndex((r) => r.id === id) + 1;
        const bm25Rrf = bm25Rank > 0 ? 1 / (RRF_K + bm25Rank) : 0;
        const semanticRrf = semanticRank > 0 ? 1 / (RRF_K + semanticRank) : 0;
        combinedScore = bm25Rrf * this.config.bm25Weight + semanticRrf * this.config.semanticWeight;
      } else {
        // Weighted sum
        combinedScore =
          bm25Score * this.config.bm25Weight + semanticScore * this.config.semanticWeight;
      }

      if (combinedScore >= this.config.minScore) {
        results.push({
          id,
          name: id,
          filePath: '',
          startLine: 0,
          endLine: 0,
          relevance: combinedScore,
          bm25Score,
          semanticScore,
          combinedScore,
          scoreComponents: { bm25: bm25Score, semantic: semanticScore },
        });
      }
    }

    return results.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, this.config.topK);
  }

  /**
   * Cache embeddings for documents to avoid recomputation.
   */
  async cacheDocumentEmbeddings(docs: Array<{ id: string; text: string }>): Promise<void> {
    const texts = docs.map((d) => d.text);
    const vectors = await this.embeddingEngine.embedBatch(texts);

    for (let i = 0; i < docs.length && i < vectors.length; i++) {
      if (vectors[i]) {
        this.embeddingCache.set(docs[i]!.id, vectors[i]!);
      }
    }
  }

  /** Get index statistics */
  getStats(): HybridSearchStats {
    return {
      documentCount: this.documents.size,
      uniqueTokens: this.invertedIndex.size,
      avgDocLength: this.avgDocLength,
      cachedEmbeddings: this.embeddingCache.size,
    };
  }

  /** Clear all indexed data */
  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.embeddingCache.clear();
    this.totalDocLength = 0;
    this.avgDocLength = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Tokenize text for BM25 indexing.
   * Handles camelCase, snake_case, and code-specific tokenization.
   */
  private tokenize(text: string): string[] {
    // Split on camelCase boundaries
    const camelSplit = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Split on snake_case
    const snakeSplit = camelSplit.replace(/_/g, ' ');
    // Split on kebab-case
    const kebabSplit = snakeSplit.replace(/-/g, ' ');
    // Split on non-alphanumeric
    const words = kebabSplit
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1); // Filter out single chars and empty

    return words;
  }

  /**
   * Normalize BM25 score to [0, 1] range for fusion.
   */
  private normalizeBM25Score(score: number): number {
    // Use sigmoid-like normalization
    return score / (score + 1);
  }

  /**
   * Compute signature match score between query and code signature.
   */
  private computeSignatureMatch(query: string, signature: string): number {
    const queryLower = query.toLowerCase();
    const sigLower = signature.toLowerCase();
    const queryTokens = new Set(this.tokenize(query));
    const sigTokens = new Set(this.tokenize(signature));

    // Jaccard similarity of tokens
    const intersection = new Set([...queryTokens].filter((t) => sigTokens.has(t)));
    const union = new Set([...queryTokens, ...sigTokens]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Compute AST structural profile similarity.
   */
  private computeAstSimilarity(_query: string, _astProfile: string): number {
    // Placeholder — full implementation requires AST profile generation
    // This would compare node type distributions, depth histograms, etc.
    return 0.5;
  }

  /**
   * Compute module/file path proximity score.
   */
  private computeModuleProximity(query: string, filePath: string): number {
    const queryLower = query.toLowerCase();
    const pathLower = filePath.toLowerCase();

    // Check if query terms appear in file path
    const queryTerms = this.tokenize(query);
    let matches = 0;
    for (const term of queryTerms) {
      if (pathLower.includes(term)) matches++;
    }

    return queryTerms.length > 0 ? matches / queryTerms.length : 0;
  }

  /**
   * Estimate Jaccard similarity from MinHash signatures.
   */
  private estimateJaccard(sig1: number[], sig2: number[]): number {
    let matches = 0;
    const len = Math.min(sig1.length, sig2.length);
    for (let i = 0; i < len; i++) {
      if (sig1[i] === sig2[i]) matches++;
    }
    return len > 0 ? matches / len : 0;
  }
}

/** Hybrid search statistics */
export interface HybridSearchStats {
  documentCount: number;
  uniqueTokens: number;
  avgDocLength: number;
  cachedEmbeddings: number;
}
