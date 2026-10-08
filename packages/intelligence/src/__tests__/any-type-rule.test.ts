// The rule that stops a reviewer from being silent about a whole class of defect.
//
// **A probe over ten classic defects found three the reviewer said nothing about**, and this is one of them. **A rule
// that fires on `any` in prose is worse than no rule**, so most of this file is about what it must *not* catch: the
// grounding gate exists to remove false positives, and **a source of them added here would be self-defeating.**

import { describe, expect, it } from 'vitest';

import { checkAnyTypeUsage } from '../review/heuristics-bug-rules.js';
import { analyzeFileHeuristics } from '../review/heuristics.js';

describe('any in a type position', () => {
  it('fires on an annotation, a generic argument and a cast', () => {
    const found = checkAnyTypeUsage([
      'function f(x: any) { return x; }',
      'const list: Array<any> = [];',
      'const v = value as any;',
    ]);

    // **All three positions**, because each is a place the type system stops.
    expect(found.length).toBe(3);
    expect(found.map((f) => f.startLine)).toEqual([1, 2, 3]);
  });

  it('says nothing about any of the four places it is not a defect', () => {
    const found = checkAnyTypeUsage([
      '// do not use `any` in this module',
      'const message = "the type is any here";',
      "const other = 'also any';",
      'function g(x: unknown) { return x; }',
    ]);

    // **The counter-case is the whole point.** An annotation inside a comment, inside a double-quoted string, inside a
    // single-quoted string, and `unknown` - which is the fix this rule suggests - **must all pass.**
    expect(found).toEqual([]);
  });

  it('does not fire on its own documentation', () => {
    // **The rule's own header mentions `: any`, `<any>` and `as any` in prose.** A pattern without a guard would fire
    // on it, which is a defect a reader would find by reading rather than by running.
    const found = checkAnyTypeUsage([
      ' * Only three shapes count: an annotation (`: any`), a generic argument (`<any>`), and a cast',
    ]);

    expect(found).toEqual([]);
  });

  it('is registered, so the reviewer reports it rather than the rule merely existing', async () => {
    // **A rule outside `BUG_RULES` is a function nobody calls**, which is the defect this stretch has found four times
    // - an unwired `fetchPRFiles`, an unread `docstring`, unproduced `CALLS`, an unread `changedFiles`. **Asserting
    // through `analyzeFileHeuristics` is what distinguishes "written" from "wired".**
    const viaReviewer = analyzeFileHeuristics('src/a.ts', ['function f(x: any) { return x; }']);

    expect(viaReviewer.length).toBeGreaterThan(0);
  });
});
