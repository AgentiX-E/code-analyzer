// The lines a statement may not run on, read from the tree.
//
// **This is one bit per statement and it decides whether the analysis may kill a value.** An assignment that control
// cannot skip replaces what it overwrote; an assignment in an arm that may not run does not. The CFG has a single block
// per function and nothing in it knew the difference, so every definition was a maybe - which is sound, and which also
// means the last write to a name never wins, so `bar = map.get("keyB"); bar = map.get("keyA")` kept both.

import { describe, expect, it } from 'vitest';

import { extractConditionalRegions, isConditional } from '../conditional-regions.js';
import { C_FAMILY_CONSTANTS, PYTHON_CONSTANTS } from '../constant-fold.js';
import { JavaProvider } from '../java.js';
import { JsonProvider } from '../json.js';
import { PythonProvider } from '../python.js';

import type { ConditionalRegion } from '../conditional-regions.js';
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
    expect(isConditional(3, [{ from: 3, to: 7 }])).toBe(true);
    expect(isConditional(4, [{ from: 3, to: 7 }])).toBe(true);
    // The boundaries are inclusive on both sides, because a whole statement is the range.
    expect(isConditional(2, [{ from: 3, to: 7 }])).toBe(false);
    expect(isConditional(8, [{ from: 3, to: 7 }])).toBe(false);
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
      expect(isConditional(line, javaProviderRegions(code)), `line ${line}`).toBe(true);
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
    expect(isConditional(5, javaProviderRegions(code))).toBe(true);
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
function javaProviderRegions(code: string): readonly ConditionalRegion[] {
  return new JavaProvider().extractConditionalRegions(code) ?? [];
}
