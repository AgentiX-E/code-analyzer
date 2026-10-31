// @code-analyzer/analyzer — Total child access

import { describe, it, expect } from 'vitest';

import { childrenOf, namedChildrenOf } from '../syntax-children.js';

// The helpers are generic over the node shape, so a stand-in with the two members
// they read is enough to drive every arm — including the null a real parse never
// produces, which is the whole reason the filter exists.
function fakeNode(children: Array<{ type: string } | null>): {
  childCount: number;
  child(index: number): { type: string } | null;
} {
  return {
    childCount: children.length,
    child: (index: number) => children[index] ?? null,
  };
}

describe('childrenOf', () => {
  it('returns every child in order', () => {
    const node = fakeNode([{ type: 'a' }, { type: 'b' }]);

    expect(childrenOf(node).map((c) => c.type)).toEqual(['a', 'b']);
  });

  it('drops a null child rather than propagating it', () => {
    // `tree-sitter` types `child(index)` as `SyntaxNode | null`; a hole is reachable
    // through the binding even though every call site in this package iterates
    // `0 .. childCount`. Dropping it here is what keeps the null out of ~130 loops.
    const node = fakeNode([{ type: 'a' }, null, { type: 'c' }]);

    expect(childrenOf(node).map((c) => c.type)).toEqual(['a', 'c']);
  });

  it('returns an empty array for a leaf', () => {
    expect(childrenOf(fakeNode([]))).toEqual([]);
  });
});

describe('namedChildrenOf', () => {
  it('returns every named child in order', () => {
    const node = {
      namedChildCount: 2,
      namedChild: (index: number) => [{ type: 'x' }, { type: 'y' }][index] ?? null,
    };

    expect(namedChildrenOf(node).map((c) => c.type)).toEqual(['x', 'y']);
  });

  it('drops a null named child', () => {
    const node = {
      namedChildCount: 2,
      namedChild: (index: number) => [null, { type: 'y' }][index] ?? null,
    };

    expect(namedChildrenOf(node).map((c) => c.type)).toEqual(['y']);
  });

  it('returns an empty array for a leaf', () => {
    const node = { namedChildCount: 0, namedChild: () => null };
    expect(namedChildrenOf(node)).toEqual([]);
  });
});
