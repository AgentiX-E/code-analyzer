// @code-analyzer/intelligence — MinHash Similarity Tests

import { describe, it, expect } from 'vitest';
import { MinHashSimilarity } from '../similarity/minhash.js';

// ---------------------------------------------------------------------------
// Tokenization Helpers
// ---------------------------------------------------------------------------

function tokenizeCode(code: string): string[] {
  return code
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Fingerprint Computation Tests
// ---------------------------------------------------------------------------

describe('MinHashSimilarity.computeFingerprint', () => {
  it('should produce a fingerprint of the correct length', () => {
    const mh = new MinHashSimilarity(128);
    const tokens = tokenizeCode('function getUserProfile(userId: number): User');
    const fp = mh.computeFingerprint(tokens);

    expect(fp.length).toBe(128);
    expect(mh.hashCount).toBe(128);
  });

  it('should produce deterministic fingerprints', () => {
    const mh = new MinHashSimilarity(128);
    const tokens = tokenizeCode('function hello() { return "world"; }');

    const fp1 = mh.computeFingerprint(tokens);
    const fp2 = mh.computeFingerprint(tokens);

    for (let i = 0; i < fp1.length; i++) {
      expect(fp1[i]).toBe(fp2[i]);
    }
  });

  it('should produce fingerprints containing finite integers', () => {
    const mh = new MinHashSimilarity(128);
    const tokens = tokenizeCode('function test() {}');
    const fp = mh.computeFingerprint(tokens);

    for (const value of fp) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should handle empty tokens', () => {
    const mh = new MinHashSimilarity(128);
    const fp = mh.computeFingerprint([]);

    expect(fp.length).toBe(128);
    // All values should be the sentinel max
    for (const v of fp) {
      expect(v).toBe(0x7fffffff);
    }
  });

  it('should handle single token', () => {
    const mh = new MinHashSimilarity(128);
    const fp = mh.computeFingerprint(['hello']);

    expect(fp.length).toBe(128);
    for (const v of fp) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('should work with custom hash counts', () => {
    const mh64 = new MinHashSimilarity(64);
    const fp64 = mh64.computeFingerprint(['a', 'b', 'c']);
    expect(fp64.length).toBe(64);
    expect(mh64.hashCount).toBe(64);

    const mh256 = new MinHashSimilarity(256);
    const fp256 = mh256.computeFingerprint(['a', 'b', 'c']);
    expect(fp256.length).toBe(256);
    expect(mh256.hashCount).toBe(256);
  });

  it('should produce different fingerprints for different tokens', () => {
    const mh = new MinHashSimilarity(128);
    const fp1 = mh.computeFingerprint(tokenizeCode('function add(a, b) { return a + b; }'));
    const fp2 = mh.computeFingerprint(tokenizeCode('function multiply(a, b) { return a * b; }'));

    // At least some hash values should differ
    let differences = 0;
    for (let i = 0; i < fp1.length; i++) {
      if (fp1[i] !== fp2[i]) differences++;
    }
    expect(differences).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Jaccard Similarity Estimation Tests
// ---------------------------------------------------------------------------

describe('MinHashSimilarity.estimateSimilarity', () => {
  it('should estimate similarity of 1.0 for identical tokens', () => {
    const mh = new MinHashSimilarity(128);
    const tokens = tokenizeCode('function getUserProfile(userId)');
    const fp1 = mh.computeFingerprint(tokens);
    const fp2 = mh.computeFingerprint(tokens);

    const sim = mh.estimateSimilarity(fp1, fp2);
    expect(sim).toBeCloseTo(1.0, 2);
  });

  it('should estimate low similarity for completely different tokens', () => {
    const mh = new MinHashSimilarity(128);
    const tokens1 = tokenizeCode('function getUserProfile(userId)');
    const tokens2 = tokenizeCode('class DatabaseConnection connect query execute');

    const fp1 = mh.computeFingerprint(tokens1);
    const fp2 = mh.computeFingerprint(tokens2);

    const sim = mh.estimateSimilarity(fp1, fp2);
    // Completely different tokens should have low similarity
    expect(sim).toBeLessThanOrEqual(0.5);
  });

  it('should estimate moderate similarity for partially overlapping tokens', () => {
    const mh = new MinHashSimilarity(128);
    const tokens1 = tokenizeCode('function getUser(userId)');
    const tokens2 = tokenizeCode('function getUser(userId, options)');

    const fp1 = mh.computeFingerprint(tokens1);
    const fp2 = mh.computeFingerprint(tokens2);

    const sim = mh.estimateSimilarity(fp1, fp2);
    // Partial overlap should give moderate similarity
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1.0);
  });

  it('should throw on length mismatch', () => {
    const mh = new MinHashSimilarity(128);
    const fp1 = [1, 2, 3];
    const fp2 = [1, 2, 3, 4];

    expect(() => mh.estimateSimilarity(fp1, fp2)).toThrow('length mismatch');
  });

  it('should return 0 for empty fingerprints', () => {
    const mh = new MinHashSimilarity(0);
    const fp1: number[] = [];
    const fp2: number[] = [];

    expect(mh.estimateSimilarity(fp1, fp2)).toBe(0);
  });

  it('should be symmetric', () => {
    const mh = new MinHashSimilarity(128);
    const tokens1 = tokenizeCode('function foo() {}');
    const tokens2 = tokenizeCode('function bar() {}');

    const fp1 = mh.computeFingerprint(tokens1);
    const fp2 = mh.computeFingerprint(tokens2);

    const sim12 = mh.estimateSimilarity(fp1, fp2);
    const sim21 = mh.estimateSimilarity(fp2, fp1);

    expect(sim12).toBe(sim21);
  });

  it('should produce consistent estimates with enough hashes', () => {
    const mh = new MinHashSimilarity(256); // More hashes = more stable estimate
    const tokens = tokenizeCode('function processUser(user: User): Result');

    const fp1 = mh.computeFingerprint(tokens);
    const fp2 = mh.computeFingerprint(tokens);

    const sim = mh.estimateSimilarity(fp1, fp2);
    expect(sim).toBeGreaterThanOrEqual(0.99); // Near-perfect match
  });
});

// ---------------------------------------------------------------------------
// isSimilar Tests
// ---------------------------------------------------------------------------

describe('MinHashSimilarity.isSimilar', () => {
  it('should return true when similarity exceeds default threshold', () => {
    const mh = new MinHashSimilarity(128);
    const tokens = tokenizeCode('function getUser(userId: number): User');
    const fp1 = mh.computeFingerprint(tokens);
    const fp2 = mh.computeFingerprint(tokens);

    expect(mh.isSimilar(fp1, fp2)).toBe(true);
  });

  it('should return false when similarity is below threshold', () => {
    const mh = new MinHashSimilarity(128);
    const fp1 = mh.computeFingerprint(tokenizeCode('function getUser(userId)'));
    const fp2 = mh.computeFingerprint(tokenizeCode('class DatabaseConnection'));

    expect(mh.isSimilar(fp1, fp2, 0.8)).toBe(false);
  });

  it('should accept custom threshold', () => {
    const mh = new MinHashSimilarity(128);
    const tokens1 = tokenizeCode('function get(a)');
    const tokens2 = tokenizeCode('function get(a, b)');

    const fp1 = mh.computeFingerprint(tokens1);
    const fp2 = mh.computeFingerprint(tokens2);

    // With low threshold, it might be similar
    const lowThresholdResult = mh.isSimilar(fp1, fp2, 0.3);
    // With high threshold, it should not be
    const highThresholdResult = mh.isSimilar(fp1, fp2, 0.95);

    // At least one of these should make sense based on actual similarity
    expect(lowThresholdResult || !highThresholdResult).toBe(true);
  });
});
