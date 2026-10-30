// The lines a statement may not run on, and the lines of the statements that keep nothing of what they compute.
//
// **This is one bit per statement and it decides whether the analysis may kill a value.** An assignment that control
// cannot skip replaces what it overwrote; an assignment in an arm that may not run does not. The CFG has a single block
// per function and nothing in it knew the difference, so every definition was a maybe - which is sound, and which also
// means the last write to a name never wins, so `bar = map.get("keyB"); bar = map.get("keyA")` kept both.
//
// **The second bit decides whether a value vanished or travelled.** `map.put("k", param)` keeps nothing, so a walk
// carrying the value stops there; `bar = new String(decode(encode(param)))` keeps it in `bar`, and the three calls in
// between are part of one statement that writes a name. Reading the two apart is the difference between "the callee
// cannot be asked" and "the answer is no".

import { describe, expect, it } from 'vitest';

import { C_FAMILY_CONSTANTS, PYTHON_CONSTANTS } from '../constant-fold.js';
import { JavaProvider } from '../java.js';
import { JsonProvider } from '../json.js';
import { PythonProvider } from '../python.js';
import {
  extractConditionalRegions,
  extractDiscardedValueRegions,
  insideRegion,
} from '../regions.js';

import type { SourceRegion } from '../regions.js';
import type { CursorWalkable } from '../syntax-cursor.js';

/** The regions a Java source produces, as `from-to` strings. */
function rangesOf(code: string): string[] {
  const regions = new JavaProvider().extractConditionalRegions(code) ?? [];
  return regions.map((region) => `${region.from}-${region.to}`);
}

describe('extractConditionalRegions', () => {
  it('closes an if statement and both of its arms', () => {
    const code = [
      'class A {', // 1
      '  void run(int flag) {', // 2
      '    if (flag > 0) {', // 3
      '      int a = 1;', // 4
      '    } else {', // 5
      '      int b = 2;', // 6
      '    }', // 7
      '  }', // 8
      '}',
    ].join('\n');
    const regions = rangesOf(code);
    expect(regions).toEqual(['3-7']);
    expect(insideRegion(3, [{ from: 3, to: 7 }])).toBe(true);
    expect(insideRegion(4, [{ from: 3, to: 7 }])).toBe(true);
    // The boundaries are inclusive on both sides, because a whole statement is the range.
    expect(insideRegion(2, [{ from: 3, to: 7 }])).toBe(false);
    expect(insideRegion(8, [{ from: 3, to: 7 }])).toBe(false);
  });

  it('closes loops, because a body may run zero times or many', () => {
    const code = [
      'class A {',
      '  void run(String[] xs) {',
      '    for (int i = 0; i < 3; i++) {',
      '      int a = 1;',
      '    }',
      '    while (true) {',
      '      int b = 2;',
      '    }',
      '    for (String x : xs) {',
      '      int c = 3;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(rangesOf(code)).toEqual(['3-5', '6-8', '9-11']);
  });

  it('closes a try, a catch and a finally, each of which may not run', () => {
    const code = [
      'class A {',
      '  void run() {',
      '    try {',
      '      int a = 1;',
      '    } catch (Exception e) {',
      '      int b = 2;',
      '    } finally {',
      '      int c = 3;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    // The `catch` and the `finally` are inside the `try` node's extent, so the outer range answers for all three and
    // the nested ones are kept anyway: membership is a disjunction, and a caller never has to reason about containment.
    const regions = rangesOf(code);
    expect(regions[0]).toBe('3-9');
    for (const line of [4, 6, 8]) {
      expect(insideRegion(line, javaProviderRegions(code)), `line ${line}`).toBe(true);
    }
  });

  it('reads a switch arm, and treats the condition as part of the arm it guards', () => {
    const code = [
      'class A {',
      '  void run(int k) {',
      '    switch (k) {',
      '      case 1:',
      '        int a = 1;',
      '        break;',
      '      default:',
      '        int b = 2;',
      '    }',
      '  }',
      '}',
    ].join('\n');
    expect(insideRegion(5, javaProviderRegions(code))).toBe(true);
  });

  it('reports nothing for a file with no branch, and answers `null` for a grammar it cannot read', () => {
    // **`[]` and `null` are different answers**: an empty list is a file where every statement is reached by every
    // path, and `null` is a grammar that cannot say. Only the first makes every definition a kill.
    expect(rangesOf('class A { void run() { int a = 1; } }')).toEqual([]);
    expect(new JsonProvider().extractConditionalRegions('{"a": 1}')).toBeNull();
  });

  it('does not walk the tree at all when the grammar lists no branch node types', () => {
    // A dialect with no conditional types has nothing to find, and the guard is what keeps the walk from starting on
    // every file of a language whose statements are all unconditional. Asserting that `walk` is never called asserts
    // the guard rather than the output, which is the part a test of the output cannot see.
    const unwalkable = {
      walk: () => {
        throw new Error('the walk should not start when there is nothing to look for');
      },
    } as unknown as CursorWalkable;
    expect(extractConditionalRegions(unwalkable, [])).toEqual([]);
  });

  it('lists Python`s own spellings, which share none of the C family`s clause names', () => {
    const code = [
      'def run(x):',
      '    if x:',
      '        a = 1',
      '    for y in x:',
      '        b = 2',
    ].join('\n');
    const regions = new PythonProvider().extractConditionalRegions(code) ?? [];
    // The two statements are siblings, so the ranges are the statements' own extents rather than one nesting the other.
    expect(regions.map((region) => `${region.from}-${region.to}`)).toEqual(['2-3', '4-5']);
    expect(PYTHON_CONSTANTS.conditionalTypes).toContain('with_statement');
    expect(C_FAMILY_CONSTANTS.conditionalTypes).not.toContain('with_statement');
  });
});

/** The regions of a Java source, for the assertions that only need membership. */
function javaProviderRegions(code: string): readonly SourceRegion[] {
  return new JavaProvider().extractConditionalRegions(code) ?? [];
}

/** The discarded-value regions of a Java source, as `from-to` strings. */
function discardedOf(code: string): string[] {
  const regions = new JavaProvider().extractDiscardedValueRegions(code) ?? [];
  return regions.map((region) => `${region.from}-${region.to}`);
}

describe('extractDiscardedValueRegions', () => {
  it('lists a call statement that keeps nothing and not the assignment that keeps its value', () => {
    const code = [
      'class A {', // 1
      '  void run(String s) {', // 2
      '    java.util.Map<String, String> m = new java.util.HashMap<>();', // 3
      '    m.put("k", s);', // 4
      '    String bar = m.get("k");', // 5
      '    bar = s;', // 6
      '    bar += s;', // 7
      '  }', // 8
      '}',
    ].join('\n');
    // **Line 4 and only line 4.** Line 5's call is the right-hand side of a declaration, and lines 6 and 7 are
    // assignments: each of those writes a name, so nothing it computes is thrown away. The `;} ` of a call statement
    // and the `bar = ...` of an assignment are both `expression_statement`, and the difference is the first child.
    expect(discardedOf(code)).toEqual(['4-4']);
  });

  it('spans a discarded call whose arguments run onto later lines', () => {
    const code = [
      'class A {', // 1
      '  void run(StringBuilder b) {', // 2
      '    b.replace(', // 3
      '        0,', // 4
      '        1,', // 5
      '        "x");', // 6
      '  }', // 7
      '}',
    ].join('\n');
    // The range is the statement's own extent, so a value read on any of its lines is one that nothing keeps.
    expect(discardedOf(code)).toEqual(['3-6']);
  });

  it('lists a bare constructor call, and no statement that writes a name', () => {
    const code = [
      'class A {', // 1
      '  void run() {', // 2
      '    new java.io.File("x");', // 3
      '    String bar = "y";', // 4
      '  }', // 5
      '}',
    ].join('\n');
    expect(discardedOf(code)).toEqual(['3-3']);
  });

  it('answers `null` from a provider that cannot parse the file, rather than "nothing is discarded"', () => {
    // **A provider without a parser is a gap, not an answer.** Java declares the vocabulary, so the dialect is there;
    // what is missing is the tree, and an empty list there would say every value that leaves the graph left it for
    // good. The two answers are separated by one guard, and this is the guard.
    expect(new ParserlessJava().extractDiscardedValueRegions('class A { void run() {} }')).toBeNull();
  });

  it('reports nothing for a file whose every statement keeps its value, and `null` for a grammar it cannot read', () => {
    // **`[]` and `null` are different answers**: an empty list is a file where no statement throws a value away, so
    // every value that a walk loses genuinely left it; `null` is a grammar that cannot say, and there the analysis
    // keeps assuming a value may have vanished.
    expect(discardedOf('class A { void run(String s) { String bar = s; } }')).toEqual([]);
    expect(new JsonProvider().extractDiscardedValueRegions('{"a": 1}')).toBeNull();
  });

  it('does not walk the tree at all when the dialect names no statement node', () => {
    const unwalkable = {
      walk: () => {
        throw new Error('the walk should not start when there is nothing to look for');
      },
    } as unknown as CursorWalkable;
    expect(
      extractDiscardedValueRegions(unwalkable, {
        ...C_FAMILY_CONSTANTS,
        expressionStatementTypes: [],
      }),
    ).toEqual([]);
  });

  it('drops a statement that has no child at all', () => {
    // A statement with no children cannot keep a value, but it cannot discard one either: there is no expression in it
    // to evaluate. The grammar of no language this project reads produces one, and the walk answers for it anyway -
    // the waiting state is cleared by the next visit, which is at the statement's own depth or above it.
    const tree = fakeTree({
      type: 'program',
      from: 1,
      to: 3,
      children: [
        { type: 'expression_statement', from: 2, to: 2 },
        {
          type: 'expression_statement',
          from: 3,
          to: 3,
          children: [{ type: 'call', from: 3, to: 3 }],
        },
      ],
    });
    expect(
      extractDiscardedValueRegions(tree, C_FAMILY_CONSTANTS).map((r) => `${r.from}-${r.to}`),
    ).toEqual(['3-3']);
  });

  it('reads Python`s statements, whose assignments are their own nodes', () => {
    const code = [
      'def run(x):', // 1
      '    f(x)', // 2
      '    y = f(1)', // 3
      '    y += 1', // 4
    ].join('\n');
    const regions = new PythonProvider().extractDiscardedValueRegions(code) ?? [];
    expect(regions.map((region) => `${region.from}-${region.to}`)).toEqual(['2-2']);
  });
});

/** One node of a tree a test can build by hand, with the span and children the walk reads. */
interface FakeNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
  readonly children?: readonly FakeNode[];
}

/**
 * A `CursorWalkable` over nodes a test wrote.
 *
 * The walk asks a cursor for its type, its span and three movements, and nothing else - which is what the interface
 * declares and why a hand-built value can stand in for a parse.
 */
function fakeTree(root: FakeNode): CursorWalkable {
  return {
    walk: () => {
      const path: Array<{ node: FakeNode; index: number }> = [{ node: root, index: -1 }];
      const at = (): FakeNode => path[path.length - 1]!.node;
      return {
        get nodeType() {
          return at().type;
        },
        get nodeText() {
          return at().type;
        },
        get startIndex() {
          return at().from;
        },
        get endIndex() {
          return at().to;
        },
        get startPosition() {
          return { row: at().from - 1, column: 0 };
        },
        get endPosition() {
          return { row: at().to - 1, column: 0 };
        },
        gotoFirstChild(): boolean {
          const children = at().children ?? [];
          if (children.length === 0) return false;
          path.push({ node: children[0]!, index: 0 });
          return true;
        },
        gotoNextSibling(): boolean {
          const parent = path[path.length - 2];
          if (parent === undefined) return false;
          const siblings = parent.node.children ?? [];
          const next = path[path.length - 1]!.index + 1;
          if (next >= siblings.length) return false;
          path[path.length - 1] = { node: siblings[next]!, index: next };
          return true;
        },
        gotoParent(): boolean {
          if (path.length === 1) return false;
          path.pop();
          return true;
        },
      };
    },
  };
}

/** Java's vocabulary with no parser behind it, which is the state a missing grammar leaves the base class in. */
class ParserlessJava extends JavaProvider {
  constructor() {
    super();
    this.parser = null;
    this.languageGrammar = null;
  }
}
