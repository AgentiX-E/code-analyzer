// @code-analyzer/intelligence — MinHash Similarity
// Computes MinHash fingerprints and estimates Jaccard similarity for code similarity detection.

/**
 * MinHash similarity computation using multiple hash functions.
 * Uses a universal hash family for efficient fingerprint generation.
 */
export class MinHashSimilarity {
  private readonly hashSeeds: number[];

  constructor(private numHashes: number = 128) {
    // Pre-generate random but deterministic seeds for hash functions
    this.hashSeeds = this.generateSeeds(numHashes);
  }

  /**
   * Generate deterministic seeds for hash functions.
   * Uses a simple LCG to produce repeatable seeds.
   */
  private generateSeeds(count: number): number[] {
    const seeds: number[] = [];
    // Use known prime seeds for reproducibility
    const primes = [
      0x9e3779b9, 0x7f4a7c13, 0x3c6ef372, 0xa1bfc7d5,
      0x5b0f9e3a, 0xd2e8c461, 0x1a6b3f88, 0x8c7d5e2f,
      0x4f1a6b3c, 0xb9d8e7f6, 0x2c5a3b4d, 0x7e8f9a0b,
      0x1c2d3e4f, 0x5a6b7c8d, 0x9e0f1a2b, 0x3c4d5e6f,
    ];

    for (let i = 0; i < count; i++) {
      const base = primes[i % primes.length]!;
      const seed = (base * (i + 1) + 0x45d9f3b) >>> 0;
      seeds.push(seed);
    }

    return seeds;
  }

  /**
   * Hash a token using the i-th hash function.
   * Uses universal hash: h(x) = ((a * x + b) mod p) mod M
   */
  private hash(token: string, hashIndex: number): number {
    const seed = this.hashSeeds[hashIndex]!;
    const p = 0x7fffffff; // 2^31 - 1, Mersenne prime

    let hashValue: number = seed;
    for (let i = 0; i < token.length; i++) {
      const charCode = token.charCodeAt(i);
      hashValue = ((hashValue * 31 + charCode) & 0x7fffffff) >>> 0;
      // Mix with the seed using different offsets per hash function
      hashValue = ((hashValue ^ (seed * (hashIndex + 3))) >>> 0);
    }

    return Math.abs(hashValue % p);
  }

  /**
   * Compute MinHash fingerprint from tokens.
   * Returns an array of `numHashes` integers representing the minimum hash values.
   */
  computeFingerprint(tokens: string[]): number[] {
    if (tokens.length === 0) {
      return new Array(this.numHashes).fill(0x7fffffff);
    }

    // Initialize with max integer value
    const fingerprint = new Array<number>(this.numHashes).fill(0x7fffffff);

    for (const token of tokens) {
      for (let i = 0; i < this.numHashes; i++) {
        const hashValue = this.hash(token, i);
        const fpVal = fingerprint[i]!;
        if (hashValue < fpVal) {
          fingerprint[i] = hashValue;
        }
      }
    }

    return fingerprint;
  }

  /**
   * Estimate Jaccard similarity from two MinHash fingerprints.
   * Jaccard similarity is the fraction of hash functions where the two
   * fingerprints agree (have the same minimum value).
   */
  estimateSimilarity(fp1: number[], fp2: number[]): number {
    if (fp1.length !== fp2.length) {
      throw new Error(
        `Fingerprint length mismatch: ${fp1.length} vs ${fp2.length}`,
      );
    }

    if (fp1.length === 0) return 0;

    let matches = 0;
    for (let i = 0; i < fp1.length; i++) {
      if (fp1[i] === fp2[i]) {
        matches++;
      }
    }

    return matches / fp1.length;
  }

  /**
   * Check if two fingerprints are similar above a threshold.
   */
  isSimilar(
    fp1: number[],
    fp2: number[],
    threshold: number = 0.8,
  ): boolean {
    return this.estimateSimilarity(fp1, fp2) >= threshold;
  }

  /** Number of hash functions in use */
  get hashCount(): number {
    return this.numHashes;
  }
}
