// @code-analyzer/intelligence — LSH (Locality-Sensitive Hashing) Searcher
// Uses banded MinHash to efficiently find candidate near-duplicate pairs.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphEdge } from '@code-analyzer/shared';
import { MinHashSimilarity } from './minhash.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An edge representing code similarity between two nodes */
export interface SimilarityEdge {
  sourceId: number;
  targetId: number;
  similarity: number;
}

// ---------------------------------------------------------------------------
// Band Hashing Utility
// ---------------------------------------------------------------------------

/**
 * Hash a band (sub-array) to a string key for bucket lookup.
 * Uses a simple combination of the band values.
 */
function hashBand(band: number[], bandIndex: number): string {
  let hash = bandIndex * 0x9e3779b9;
  for (const value of band) {
    hash = ((hash << 5) + hash + value) >>> 0;
  }
  return `b${bandIndex}_${hash.toString(36)}`;
}

// ---------------------------------------------------------------------------
// LSH Searcher
// ---------------------------------------------------------------------------

export class LSHSearcher {
  private numBands: number;
  /** bucketKey -> Set<nodeId> */
  private buckets = new Map<string, Set<number>>();

  constructor(numBands?: number) {
    this.numBands = numBands ?? 16;
  }

  /**
   * Insert a fingerprint into LSH buckets.
   * Divides the fingerprint into bands and hashes each band to a bucket.
   */
  insert(nodeId: number, fingerprint: number[]): void {
    if (fingerprint.length === 0) return;

    const bandSize = Math.ceil(fingerprint.length / this.numBands);

    for (let bandIdx = 0; bandIdx < this.numBands; bandIdx++) {
      const start = bandIdx * bandSize;
      const end = Math.min(start + bandSize, fingerprint.length);
      const band = fingerprint.slice(start, end);

      const key = hashBand(band, bandIdx);

      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = new Set();
        this.buckets.set(key, bucket);
      }
      bucket.add(nodeId);
    }
  }

  /**
   * Find candidate near-duplicates for a given fingerprint.
   * Returns node IDs that share at least one LSH band with the query fingerprint.
   */
  query(fingerprint: number[], _threshold?: number): number[] {
    if (fingerprint.length === 0) return [];

    const candidates = new Set<number>();
    const bandSize = Math.ceil(fingerprint.length / this.numBands);

    for (let bandIdx = 0; bandIdx < this.numBands; bandIdx++) {
      const start = bandIdx * bandSize;
      const end = Math.min(start + bandSize, fingerprint.length);
      const band = fingerprint.slice(start, end);

      const key = hashBand(band, bandIdx);
      const bucket = this.buckets.get(key);

      if (bucket) {
        for (const nodeId of bucket) {
          candidates.add(nodeId);
        }
      }
    }

    return Array.from(candidates);
  }

  /**
   * Build SIMILAR_TO edges for all nodes.
   * Uses LSH to find candidate pairs, then computes exact MinHash similarity.
   */
  buildSimilarityEdges(
    _store: InMemoryGraphStore,
    nodeIds: number[],
    getFingerprint: (id: number) => number[],
    threshold: number = 0.8,
  ): SimilarityEdge[] {
    const minhash = new MinHashSimilarity();
    const edges: SimilarityEdge[] = [];

    // Insert all fingerprints into LSH index
    const fingerprintMap = new Map<number, number[]>();
    for (const nodeId of nodeIds) {
      const fp = getFingerprint(nodeId);
      if (fp.length > 0) {
        fingerprintMap.set(nodeId, fp);
        this.insert(nodeId, fp);
      }
    }

    // For each node, query LSH to find candidate pairs
    // Avoid duplicates by only adding (source < target)
    for (const nodeId of nodeIds) {
      const fp = fingerprintMap.get(nodeId);
      if (!fp || fp.length === 0) continue;

      const candidates = this.query(fp);
      for (const candidateId of candidates) {
        // Skip self and avoid duplicates
        if (candidateId <= nodeId) continue;

        const candidateFp = fingerprintMap.get(candidateId);
        if (!candidateFp) continue;

        // Compute exact similarity
        const similarity = minhash.estimateSimilarity(fp, candidateFp);
        if (similarity >= threshold) {
          edges.push({
            sourceId: nodeId,
            targetId: candidateId,
            similarity,
          });
        }
      }
    }

    return edges;
  }

  /**
   * Insert an edge into the store as a SIMILAR_TO relationship.
   */
  insertSimilarityEdge(store: InMemoryGraphStore, edge: SimilarityEdge, projectId: string): void {
    const now = new Date().toISOString();
    const graphEdge: GraphEdge = {
      id: 0, // Will be assigned by store
      projectId,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: 'SIMILAR_TO',
      properties: {
        confidence: edge.similarity,
        similarity: edge.similarity,
      },
      weight: edge.similarity,
      createdAt: now,
    };

    try {
      store.insertEdge(graphEdge);
    } catch {
      // Edge may already exist - skip duplicate
    }
  }

  /**
   * Clear all LSH buckets.
   */
  clear(): void {
    this.buckets.clear();
  }

  /** Number of buckets currently in use */
  get bucketCount(): number {
    return this.buckets.size;
  }

  /** Number of bands */
  get bands(): number {
    return this.numBands;
  }
}
