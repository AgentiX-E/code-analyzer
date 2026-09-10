// @code-analyzer/analyzer — CFG Set Utilities
// Generic set helpers shared by the dominator and dataflow analyses.

/**
 * Intersect two sets, iterating the smaller operand to minimize lookups.
 *
 * @param a - First set
 * @param b - Second set
 * @returns A new set holding the elements present in both operands
 */
export function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const val of smaller) {
    if (larger.has(val)) result.add(val);
  }
  return result;
}

/**
 * Compare two sets for element-wise equality.
 *
 * Exported for testing. Every in-repo call site sits inside a monotone
 * fixed-point iteration — `computeReachingDefinitions`, `computeLiveVariables`
 * and `computeAvailableExpressions` in `dataflow.ts`, and `computeDominators`
 * in `dominators.ts` — where the freshly derived set is always a subset of (or
 * a superset of) the set it is compared against. Under that invariant an equal
 * size implies equal contents, so the element scan can never report a
 * difference in production and is only exercised by a direct unit test.
 *
 * @param a - First set
 * @param b - Second set
 * @returns True when both sets hold exactly the same elements
 */
export function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const val of a) {
    if (!b.has(val)) return false;
  }
  return true;
}
