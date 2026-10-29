import type { GraphNode } from '@code-analyzer/shared';

/**
 * Order two nodes by the identity they carry in the corpus, not by the order they were ingested.
 *
 * **Why this exists at all.** Every ranking function in this package used to sort by score alone, `Array.prototype.sort`
 * is stable, and the input order was the order the directory walk happened to produce. Equal scores are common — BM25
 * over identical text is identical arithmetic — so the *list* a user sees for such a query depended on the filesystem.
 * The published retrieval figure moved 0.9856 → 0.9815 from one machine to another for exactly this reason, and a
 * benchmark whose value depends on `readdir` order is not a benchmark.
 *
 * **The key is the node's own name**, compared by code unit rather than by locale collation (a locale sort puts `a`
 * before `Z`; every machine must agree, so the comparison cannot be locale-aware). `id` comes last and is not the
 * primary key because ids are assigned in insertion order — the same machine dependence this function removes.
 */
export function compareNodeIdentity(a: GraphNode, b: GraphNode): number {
  return (
    compareCodeUnits(a.qualifiedName ?? '', b.qualifiedName ?? '') ||
    compareCodeUnits(a.filePath ?? '', b.filePath ?? '') ||
    (a.startLine ?? -1) - (b.startLine ?? -1) ||
    compareCodeUnits(a.name ?? '', b.name ?? '') ||
    a.id - b.id
  );
}

/**
 * Compare two strings by UTF-16 code unit: the same answer on every machine, whatever its locale.
 *
 * `localeCompare` is the obvious way to sort strings and the wrong one here: a locale collation orders `a` before `Z`,
 * a byte order does not, and an ordering that changes with `LANG` is the defect this module exists to remove.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Sort descending by score, then by a key that names the item, so the result is a total order over the corpus.
 *
 * Returns the same array, sorted in place, because every call site already owns its array and copying a ranked list of
 * tens of thousands of nodes to sort it would be the more expensive half of the operation.
 */
export function sortByScoreThenKey<T>(
  items: T[],
  scoreOf: (item: T) => number,
  keyOf: (item: T) => string,
): T[] {
  return items.sort((a, b) => {
    const byScore = scoreOf(b) - scoreOf(a);
    return byScore !== 0 ? byScore : compareCodeUnits(keyOf(a), keyOf(b));
  });
}

/** `sortByScoreThenKey` for results that carry a graph node. */
export function sortByScoreThenIdentity<T extends { node: GraphNode }>(
  items: T[],
  scoreOf: (item: T) => number,
): T[] {
  return items.sort((a, b) => {
    const byScore = scoreOf(b) - scoreOf(a);
    return byScore !== 0 ? byScore : compareNodeIdentity(a.node, b.node);
  });
}
