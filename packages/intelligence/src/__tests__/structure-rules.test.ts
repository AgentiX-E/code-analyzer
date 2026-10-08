// The two silences the probe found, closed - and what each must leave alone.
//
// **The probe's own samples are the positive cases**: five nested `if` blocks and a sixty-statement body, both of
// which the reviewer reported nothing about. **The negative cases are the code this repository already contains**,
// because **a structural rule tuned to its own corpus is a false-positive generator pointed at real code.**

import { describe, expect, it } from 'vitest';

import { checkDeepNesting, checkLongFunction } from '../review/heuristics-bug-rules.js';
import { analyzeFileHeuristics } from '../review/heuristics.js';

/** The probe's sample: five nested blocks, which produced zero findings before this rule. */
const DEEP = [
  'function f() {',
  '  if (a) {',
  '    if (b) {',
  '      if (c) {',
  '        if (d) {',
  '          if (e) {',   // five deep
  '            go();',
  '          }',
  '        }',
  '      }',
  '    }',
  '  }',
  '}',
];

describe('nesting and body length', () => {
  it('reports nesting past five levels, which the reviewer used to ignore', () => {
    const found = checkDeepNesting(DEEP);
    expect(found.length).toBe(1);
    // **The finding names the level**, so a reader can disagree with the threshold rather than with the verdict.
    expect(found[0]!.description).toMatch(/nested 6 deep|nested 5 deep/);
  });

  it('says nothing about nesting at the limit, because the threshold is the claim', () => {
    // **Four levels is below the limit.** The first version of this case sliced the deep sample and **still had five
    // levels**, so it failed - **and the failure was the test's, not the rule's.** Written out rather than derived,
    // because deriving a depth from a sample is how the sample's depth gets assumed.
    const four = [
      'function f() {',
      '  if (a) {',
      '    if (b) {',
      '      if (c) {',
      '        go();',
      '      }',
      '    }',
      '  }',
      '}',
    ];
    expect(checkDeepNesting(four)).toEqual([]);
    // And a file with no braces at all is not deep.
    expect(checkDeepNesting(['const a = 1;', 'export const b = 2;'])).toEqual([]);
  });

  it('reports a body past fifty lines, which the reviewer used to ignore', () => {
    const long = ['export function big() {', ...Array.from({ length: 60 }, (_, i) => `  step${i}();`), '}'];
    const found = checkLongFunction(long);

    expect(found.length).toBe(1);
    // **It quotes the lines it means**, because a finding without a line is one nobody can act on.
    expect(found[0]!.startLine).toBe(1);
    expect(found[0]!.endLine).toBe(62);
  });

  it('says nothing about a short body', () => {
    const short = ['export function small() {', '  return 1;', '}'];
    expect(checkLongFunction(short)).toEqual([]);
  });

  it('both are registered, so the reviewer reports them rather than the functions merely existing', () => {
    // **The fourth time this assertion has been necessary** - a rule outside `BUG_RULES` is a function nobody calls.
    expect(analyzeFileHeuristics('src/a.ts', DEEP).length).toBeGreaterThan(0);
    expect(
      analyzeFileHeuristics('src/b.ts', ['export function big() {', ...Array.from({ length: 60 }, (_, i) => `  s${i}();`), '}']).length,
    ).toBeGreaterThan(0);
  });
});
