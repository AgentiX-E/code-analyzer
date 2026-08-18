// @code-analyzer/intelligence — Deterministic PRNG for community detection
//
// Community detection (Louvain/Leiden) processes nodes in a randomized order to
// break ties and escape local optima. Using `Math.random()` makes the result
// non-deterministic: for the same graph, different runs can reach different
// local optima (and different modularity), which makes tests flaky and results
// non-reproducible.
//
// We therefore use a seeded PRNG (mulberry32). The default seed yields
// deterministic output for a given graph — a required property for a code
// analysis tool whose conclusions must be reproducible and auditable.

/** Default seed — fixed so community detection is deterministic by default. */
export const DEFAULT_SEED = 42;

/**
 * Mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 * Given the same seed, it always produces the same sequence of floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle driven by a caller-supplied random() in [0, 1). */
export function shuffleWith<T>(array: T[], random: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}
