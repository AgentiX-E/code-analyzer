// @code-analyzer/analyzer — Total child access for tree-sitter nodes

/**
 * The slice of the tree-sitter node API these helpers need.
 *
 * Generic over the node type on purpose: the analyzer holds two views of the same
 * tree. The language providers are written against this package's own
 * `TreeSitterSyntaxNode`, which declares `child(index)` as total; the resolvers
 * import `SyntaxNode` from `tree-sitter`, whose declaration is `| null`. A helper
 * pinned to either one would change the element type of every loop it rewrote, so it
 * is constrained by shape and preserves whatever the caller had.
 */
interface NodeWithChildren<T> {
  readonly childCount: number;
  child(index: number): T | null;
  /**
   * Every child, in one native call, where the binding offers it.
   *
   * **The index loop below crosses into native code once per child**, and a
   * `tree-sitter` node accessor marshals a 24-byte record across that boundary
   * every time. **Measured on this repository's own TypeScript: the index loop
   * accounted for 20 % of a full index**, because `child(i)` plus the `type` read
   * that follows it is two crossings per child. The array getter marshals once and
   * unmarshals the whole list in JS, which is the same answer for a fraction of the
   * crossings.
   *
   * Optional, so a caller holding only the index API keeps working.
   */
  readonly children?: readonly T[];
}

interface NodeWithNamedChildren<T> {
  readonly namedChildCount: number;
  namedChild(index: number): T | null;
  /** The named variant of {@link NodeWithChildren.children}, with the same rationale. */
  readonly namedChildren?: readonly T[];
}

/**
 * Direct children of a node, nulls dropped.
 *
 * `tree-sitter` types `child(index)` as `| null` because the binding can hand back
 * null for an index it does not recognise. Every call site in this package walks
 * `0 .. childCount`, where a child is always present. Rather than assert that at
 * ~130 sites — or let the two views of the API disagree about it — the null is
 * filtered once, here, and the loop reads as the iteration it always was.
 */
export function childrenOf<T>(node: NodeWithChildren<T>): T[] {
  if (node.children) return [...node.children];
  const children: T[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) children.push(child);
  }
  return children;
}

/**
 * Named children of a node, nulls dropped. The named variant of {@link childrenOf},
 * with the same rationale.
 */
export function namedChildrenOf<T>(node: NodeWithNamedChildren<T>): T[] {
  if (node.namedChildren) return [...node.namedChildren];
  const children: T[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) children.push(child);
  }
  return children;
}
