// @code-analyzer/intelligence — Near-Clone Detection
// Implements MinHash + Locality-Sensitive Hashing (LSH) for
// efficient detection of near-duplicate code across large codebases.

import type { GraphNode, KnowledgeGraph } from '@code-analyzer/shared';
import { EDGE_SIMILAR_TO } from '@code-analyzer/shared';

/** MinHash signature (array of hash values) */
export type MinHashSignature = number[];

/** A pair of similar code fragments */
export interface SimilarCodePair {
  nodeId1: number;
  nodeId2: number;
  name1: string;
  name2: string;
  filePath1: string;
  filePath2: string;
  jaccardEstimate: number;
  signatureLength: number;
}

/** Near-clone detection result */
export interface NearCloneResult {
  pairs: SimilarCodePair[];
  totalComparisons: number;
  prunedByLSH: number;
  threshold: number;
  processingTimeMs: number;
}

/** LSH band configuration */
interface LshBand {
  bandSize: number;
  numBands: number;
}

/**
 * NearCloneDetector uses MinHash signatures and Locality-Sensitive
 * Hashing (LSH) to efficiently find near-duplicate code fragments.
 *
 * Algorithm:
 * 1. Tokenize each code function/method into n-grams
 * 2. Compute MinHash signatures using k hash functions
 * 3. Partition signatures into bands for LSH
 * 4. Hash each band into buckets — candidates in same bucket are similar
 * 5. Estimate Jaccard similarity from MinHash signatures
 * 6. Return pairs above similarity threshold
 *
 * Complexity: O(n * k) for signature computation + O(n) for LSH clustering,
 * where n is the number of code fragments and k is the signature length.
 * This is dramatically faster than O(n²) pairwise comparison.
 */
export class NearCloneDetector {
  private signatureLength: number;
  private similarityThreshold: number;
  private ngramSize: number;
  private lshBands: LshBand;
  private hashFunctions: Array<(value: number) => number>;

  constructor(options?: {
    signatureLength?: number;
    similarityThreshold?: number;
    ngramSize?: number;
  }) {
    this.signatureLength = options?.signatureLength ?? 128;
    this.similarityThreshold = options?.similarityThreshold ?? 0.7;
    this.ngramSize = options?.ngramSize ?? 5;

    // Configure LSH bands
    // For 128 hashes and threshold 0.7:
    // Optimal: bands=7, rows=18 (s-curve steep at ~0.7)
    const rows = 18;
    const bands = Math.floor(this.signatureLength / rows);
    this.lshBands = { bandSize: rows, numBands: bands };

    // Generate hash functions for MinHash
    this.hashFunctions = this.generateHashFunctions(this.signatureLength);
  }

  /**
   * Detect near-clone code fragments in a knowledge graph.
   *
   * @param graph — Knowledge graph containing functions/methods to compare
   * @returns Detection result with similar pairs
   */
  detect(graph: KnowledgeGraph): NearCloneResult {
    const startTime = performance.now();

    // Get candidate nodes (functions and methods)
    const candidates = this.getCandidateNodes(graph);
    if (candidates.length < 2) {
      return {
        pairs: [],
        totalComparisons: 0,
        prunedByLSH: 0,
        threshold: this.similarityThreshold,
        processingTimeMs: performance.now() - startTime,
      };
    }

    // Compute MinHash signatures
    const signatures = this.computeSignatures(candidates);

    // LSH clustering to find candidate pairs
    const candidatePairs = this.lshCluster(candidates, signatures);

    // Verify candidate pairs and compute similarity
    const pairs: SimilarCodePair[] = [];
    const totalComparisons = candidatePairs.length;
    let prunedByLSH = 0;

    for (const [i, j] of candidatePairs) {
      // Candidate pairs originate from lshCluster buckets, which only admit
      // candidates whose signature exists, and computeSignatures registers a
      // signature for every candidate — so both lookups are guaranteed to hit.
      const sig1 = signatures.get(candidates[i]!.id)!;
      const sig2 = signatures.get(candidates[j]!.id)!;

      const jaccard = this.estimateJaccard(sig1, sig2);
      if (jaccard >= this.similarityThreshold) {
        pairs.push({
          nodeId1: candidates[i]!.id,
          nodeId2: candidates[j]!.id,
          name1: candidates[i]!.name,
          name2: candidates[j]!.name,
          filePath1: candidates[i]!.filePath ?? '',
          filePath2: candidates[j]!.filePath ?? '',
          jaccardEstimate: jaccard,
          signatureLength: this.signatureLength,
        });
      } else {
        prunedByLSH++;
      }
    }

    // Sort by similarity (most similar first)
    pairs.sort((a, b) => b.jaccardEstimate - a.jaccardEstimate);

    return {
      pairs,
      totalComparisons,
      prunedByLSH,
      threshold: this.similarityThreshold,
      processingTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Add SIMILAR_TO edges to the knowledge graph.
   */
  addSimilarToEdges(graph: KnowledgeGraph, result: NearCloneResult): void {
    for (const pair of result.pairs) {
      const edgeId = Math.max(0, ...Array.from(graph.edges.keys())) + 1;
      graph.edges.set(edgeId, {
        id: edgeId,
        projectId: graph.projectId,
        sourceId: pair.nodeId1,
        targetId: pair.nodeId2,
        type: EDGE_SIMILAR_TO,
        properties: {
          jaccardEstimate: pair.jaccardEstimate,
          detector: 'minhash-lsh',
        },
        weight: pair.jaccardEstimate,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: MinHash
  // ---------------------------------------------------------------------------

  /**
   * Compute MinHash signatures for all candidate nodes.
   */
  private computeSignatures(candidates: GraphNode[]): Map<number, MinHashSignature> {
    const signatures = new Map<number, MinHashSignature>();

    for (const node of candidates) {
      const shingles = this.getShingles(node);
      const signature = this.computeMinHash(shingles);
      signatures.set(node.id, signature);
    }

    return signatures;
  }

  /**
   * Compute MinHash signature for a set of shingles.
   */
  private computeMinHash(shingles: Set<number>): MinHashSignature {
    const signature: MinHashSignature = [];

    for (const hashFn of this.hashFunctions) {
      let minHash = Infinity;
      for (const shingle of shingles) {
        const hash = hashFn(shingle);
        if (hash < minHash) minHash = hash;
      }
      signature.push(minHash === Infinity ? 0 : minHash);
    }

    return signature;
  }

  /**
   * Extract n-gram shingles from a code node.
   */
  private getShingles(node: GraphNode): Set<number> {
    const shingles = new Set<number>();
    const text = (
      (node.signature ?? '') +
      ' ' +
      (node.name ?? '') +
      ' ' +
      JSON.stringify(node.properties ?? {})
    ).toLowerCase();

    const tokens = this.tokenize(text);
    const n = this.ngramSize;

    for (let i = 0; i <= tokens.length - n; i++) {
      const ngram = tokens.slice(i, i + n).join(' ');
      // Simple hash function for the ngram
      let hash = 0;
      for (let j = 0; j < ngram.length; j++) {
        const char = ngram.charCodeAt(j);
        hash = ((hash << 5) - hash + char) | 0;
      }
      shingles.add(hash);
    }

    return shingles;
  }

  // ---------------------------------------------------------------------------
  // Private: LSH
  // ---------------------------------------------------------------------------

  /**
   * Use LSH to find candidate similar pairs.
   * Only pairs that hash to the same bucket in at least one band
   * are considered as candidates.
   */
  private lshCluster(
    candidates: GraphNode[],
    signatures: Map<number, MinHashSignature>,
  ): Array<[number, number]> {
    const candidateSet = new Set<string>();

    for (let band = 0; band < this.lshBands.numBands; band++) {
      const bucket = new Map<number, number[]>();

      for (let i = 0; i < candidates.length; i++) {
        // computeSignatures registers a signature for every candidate, so this
        // lookup always hits.
        const sig = signatures.get(candidates[i]!.id)!;

        const bandHash = this.hashBand(sig, band);
        let ids = bucket.get(bandHash);
        if (!ids) {
          ids = [];
          bucket.set(bandHash, ids);
        }
        ids.push(i);
      }

      // All indices in the same bucket are candidate pairs
      for (const [, ids] of bucket) {
        for (let a = 0; a < ids.length; a++) {
          for (let b = a + 1; b < ids.length; b++) {
            const i = ids[a]!;
            const j = ids[b]!;
            // Bucket ids are appended in ascending candidate-index order, so
            // ids[a] < ids[b] for a < b — the pair is already ordered (i < j).
            const key = `${i}-${j}`;
            candidateSet.add(key);
          }
        }
      }
    }

    return Array.from(candidateSet).map((key) => {
      const [i, j] = key.split('-').map(Number);
      return [i!, j!] as [number, number];
    });
  }

  /**
   * Hash a band of the MinHash signature into a single bucket key.
   */
  private hashBand(signature: MinHashSignature, band: number): number {
    const start = band * this.lshBands.bandSize;
    let hash = 0;

    // numBands = floor(signatureLength / bandSize), so the last band ends at or
    // before signature.length; the in-bounds indices always resolve and the
    // extra `i < signature.length` bound plus `?? 0` fallback are never hit.
    for (let i = start; i < start + this.lshBands.bandSize; i++) {
      hash = ((hash << 5) - hash + signature[i]!) | 0;
    }

    return hash;
  }

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  /**
   * Estimate Jaccard similarity from two MinHash signatures.
   */
  private estimateJaccard(sig1: MinHashSignature, sig2: MinHashSignature): number {
    let matches = 0;
    const len = Math.min(sig1.length, sig2.length);

    for (let i = 0; i < len; i++) {
      if (sig1[i] === sig2[i]) matches++;
    }

    return len > 0 ? matches / len : 0;
  }

  /**
   * Generate pairwise-independent hash functions for MinHash.
   * Uses the standard universal hashing scheme: h(x) = (a * x + b) mod M
   */
  private generateHashFunctions(count: number): Array<(value: number) => number> {
    const M = 2147483647; // 2^31 - 1 (Mersenne prime)
    const functions: Array<(value: number) => number> = [];

    for (let i = 0; i < count; i++) {
      // Use deterministic pseudo-random coefficients based on index
      const a = ((i * 2654435761) % (M - 1)) + 1; // Non-zero multiplier
      const b = (i * 1597334677) % M; // Additive constant
      functions.push((x: number) => {
        // Ensure positive modulo
        const result = (((a * x + b) % M) + M) % M;
        return result;
      });
    }

    return functions;
  }

  /**
   * Get candidate nodes (functions and methods) from the graph.
   */
  private getCandidateNodes(graph: KnowledgeGraph): GraphNode[] {
    const candidates: GraphNode[] = [];

    for (const [, node] of graph.nodes) {
      if (node.label === 'Function' || node.label === 'Method') {
        // Skip very small functions (likely not clones)
        const sig = node.signature ?? '';
        if (sig.length < 20) continue;
        candidates.push(node);
      }
    }

    return candidates;
  }

  /**
   * Tokenize code text for n-gram extraction.
   * Preserves code structure better than simple whitespace splitting.
   */
  private tokenize(text: string): string[] {
    // Split on camelCase, snake_case, and code symbols
    return text
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/[^a-zA-Z0-9\s]/g, ' $& ')
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => t.toLowerCase());
  }
}
