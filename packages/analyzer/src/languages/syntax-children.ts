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
}

interface NodeWithNamedChildren<T> {
  readonly namedChildCount: number;
  namedChild(index: number): T | null;
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
  const children: T[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) children.push(child);
  }
  return children;
}
