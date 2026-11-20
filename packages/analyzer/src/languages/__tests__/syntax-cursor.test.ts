// The walk that replaced two recursions, and the proof that it builds nothing.
//
// **The old `exportedNames` descended the whole tree once and then descended every export statement a second time**,
// which cost 15.4 % of a full index. The replacement reads `nodeType` from a cursor, so **the interesting assertion is
// not that it is faster - a timing test would be flaky - but that it never asks a node for anything**. Every case here
// hands it a value with `walk()` and no other property at all, which is a claim the type checker enforces and the
// runtime would fail on.

import { describe, expect, it } from 'vitest';

import { exportedNamesByCursor, walkPreOrder } from '../syntax-cursor.js';

import type { CursorWalkable, TreeSitterTreeCursor } from '../syntax-cursor.js';

/** A tree a cursor can walk, with nothing else on it. */
function walkable(cursor: () => TreeSitterTreeCursor): CursorWalkable {
  return { walk: cursor };
}

/** A cursor over a fixed shape, navigated by index arithmetic rather than by the binding. */
function scriptedCursor(shape: Shape): TreeSitterTreeCursor {
  const flat: Array<{ shape: Shape; depth: number; parent: number; index: number }> = [];
  const build = (node: Shape, depth: number, parent: number): number => {
    const index = flat.length;
    flat.push({ shape: node, depth, parent, index });
    for (const child of node.children ?? []) build(child, depth + 1, index);
    return index;
  };
  build(shape, 0, -1);

  // **The navigation state is the flattened pre-order index**, so `gotoParent` and `gotoNextSibling` are lookups
  // rather than a second tree.
  let at = 0;
  // **`at` always addresses a flattened entry**, because every move above is bounds-checked against the same array.
  const current = (): (typeof flat)[number] => flat[at] as (typeof flat)[number];

  return {
    get nodeType() {
      return current().shape.type;
    },
    get nodeText() {
      return current().shape.text ?? '';
    },
    get startIndex() {
      return 0;
    },
    get endIndex() {
      return 0;
    },
    get startPosition() {
      return { row: 0, column: 0 };
    },
    get endPosition() {
      return { row: 0, column: 0 };
    },
    gotoFirstChild() {
      const next = flat[at + 1];
      if (!next || next.parent !== at) return false;
      at += 1;
      return true;
    },
    gotoNextSibling() {
      const self = current();
      const sibling = flat.find((n) => n.parent === self.parent && n.index > self.index);
      if (!sibling) return false;
      at = sibling.index;
      return true;
    },
    gotoParent() {
      const parent = current().parent;
      if (parent < 0) return false;
      at = parent;
      return true;
    },
  };
}

interface Shape {
  type: string;
  text?: string;
  children?: Shape[];
}

/** A source file's skeleton: a program holding two statements. */
const PROGRAM: Shape = {
  type: 'program',
  children: [
    {
      type: 'export_statement',
      children: [
        { type: 'export', text: 'export' },
        { type: 'function_declaration', children: [{ type: 'identifier', text: 'alpha' }] },
      ],
    },
    {
      type: 'lexical_declaration',
      children: [{ type: 'variable_declarator', children: [{ type: 'identifier', text: 'beta' }] }],
    },
  ],
};

describe('walkPreOrder', () => {
  it('visits every node once, in pre-order, with its depth', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() => scriptedCursor(PROGRAM)),
      (type, depth) => seen.push(`${depth}:${type}`),
    );

    expect(seen).toEqual([
      '0:program',
      '1:export_statement',
      '2:export',
      '2:function_declaration',
      '3:identifier',
      '1:lexical_declaration',
      '2:variable_declarator',
      '3:identifier',
    ]);
  });

  /**
   * **A subtree the caller declares opaque is visited by nobody and entered by nobody.**
   *
   * The one caller is the ArkTS walk, after a real page showed what an `ERROR` node costs: the node is the parser
   * saying *this span has no structure*, so descending into it reads tokens as if they were syntax. **Stepping over it
   * is what makes the surrounding tree trustworthy** - and the surrounding tree is the part the grammar did read.
   */
  it('steps over an opaque subtree without visiting it or its children', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() => scriptedCursor(PROGRAM)),
      (type, depth) => seen.push(`${depth}:${type}`),
      new Set(['function_declaration']),
    );

    // The declaration and its `identifier` are gone; its siblings are not, and the depths around them are unchanged.
    expect(seen).toEqual([
      '0:program',
      '1:export_statement',
      '2:export',
      '1:lexical_declaration',
      '2:variable_declarator',
      '3:identifier',
    ]);
  });

  /**
   * **The three routes by which a sibling arrives**, because the opacity test sits on the current node rather than on the
   * child: a node reached by descent, by a sibling step and by an ascent are one test each, and a check at only one of
   * them would visit the node it was told to skip.
   */
  it('steps over an opaque node reached as a sibling, and one reached by ascent', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            { type: 'first', children: [{ type: 'inner', text: 'visited' }] },
            { type: 'ERROR', children: [{ type: 'garbage', text: 'never' }] },
            { type: 'last', text: 'visited' },
          ],
        }),
      ),
      (type, depth) => seen.push(`${depth}:${type}`),
      new Set(['ERROR']),
    );

    // `first` and its child are visited; `ERROR` and `garbage` are not; `last` is, at the same depth as `first`.
    expect(seen).toEqual(['0:program', '1:first', '2:inner', '1:last']);
  });

  it('steps over an opaque node reached by descent, which is where the depth is already counted', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            { type: 'ERROR', children: [{ type: 'garbage', text: 'never' }] },
            { type: 'after', text: 'visited' },
          ],
        }),
      ),
      (type, depth) => seen.push(`${depth}:${type}`),
      new Set(['ERROR']),
    );

    expect(seen).toEqual(['0:program', '1:after']);
  });

  it('ends the walk when the last child is the opaque one', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            { type: 'kept', text: 'visited' },
            { type: 'ERROR', children: [{ type: 'garbage', text: 'never' }] },
          ],
        }),
      ),
      (type) => seen.push(type),
      new Set(['ERROR']),
    );

    expect(seen).toEqual(['program', 'kept']);
  });

  it('visits the root even when its type is the opaque one, because a walk needs somewhere to start', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() =>
        scriptedCursor({ type: 'ERROR', children: [{ type: 'garbage', text: 'never' }] }),
      ),
      (type) => seen.push(type),
      new Set(['ERROR']),
    );

    expect(seen).toEqual(['ERROR']);
  });

  it('visits a leaf tree once and stops', () => {
    const seen: string[] = [];
    walkPreOrder(
      walkable(() => scriptedCursor({ type: 'program' })),
      (type) => seen.push(type),
    );
    expect(seen).toEqual(['program']);
  });
});

describe('exportedNamesByCursor', () => {
  it('takes the names inside export statements and nothing outside them', () => {
    const names = exportedNamesByCursor(walkable(() => scriptedCursor(PROGRAM)));
    expect([...names]).toEqual(['alpha']);
  });

  it('finds nothing in a file with no export statements', () => {
    const names = exportedNamesByCursor(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            { type: 'function_declaration', children: [{ type: 'identifier', text: 'hidden' }] },
          ],
        }),
      ),
    );
    expect(names.size).toBe(0);
  });

  it('leaves one export statement when the next begins at the same depth', () => {
    const names = exportedNamesByCursor(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            {
              type: 'export_statement',
              children: [{ type: 'identifier', text: 'first' }],
            },
            {
              type: 'export_statement',
              children: [{ type: 'identifier', text: 'second' }],
            },
          ],
        }),
      ),
    );
    expect([...names]).toEqual(['first', 'second']);
  });

  it('collects every identifier under one export statement, clauses included', () => {
    const names = exportedNamesByCursor(
      walkable(() =>
        scriptedCursor({
          type: 'program',
          children: [
            {
              type: 'export_statement',
              children: [
                {
                  type: 'export_clause',
                  children: [
                    {
                      type: 'export_specifier',
                      children: [
                        { type: 'identifier', text: 'local' },
                        { type: 'identifier', text: 'renamed' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    expect([...names]).toEqual(['local', 'renamed']);
  });
});
