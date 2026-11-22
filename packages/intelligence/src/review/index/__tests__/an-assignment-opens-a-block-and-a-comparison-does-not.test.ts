// An assignment opens a block, and a comparison does not
//
// **The two Ruby forms that put a block-opening keyword away from the start of a line**, and the reason they need a test
// rather than a comment. Ruby counts blocks by `end`, so anything that opens one without being noticed hides every
// declaration after it inside the one before - and the direction of that error is the dangerous one: a method that
// swallows its successor is a method whose range covers lines it cannot explain.
//
// **`x = if cond` is a block.** Ruby treats `if`/`case`/`begin`/`while`/`until` as expressions, so `budget = if urgent
// then 1 else 2 end` is a block with a value. `x ||= case kind ... end` is the same shape through the conditional
// assignment. Both must raise the depth.
//
// **`x = a >= b` is not.** The `=` that follows `>` is half of a comparison operator, and a scanner that looks for an
// assignment followed by a keyword without excluding the comparison operators will read `>= limit` as `= ...` on the
// days the right-hand side begins with a keyword - `capped = total >= if` is not valid Ruby, but `capped = a >= b` is,
// and the same pattern scanned line by line is what decides it.
//
// **Why this file exists rather than a comment on the pattern.** The pattern is an alternation whose first branch is
// anchored and whose second is not, which reads as `^(A|B)` and parses as `(^A)|B` - CodeQL reports exactly that as
// `js/regex/missing-regexp-anchor`. Splitting it into two named patterns is the fix, and **a split is only safe if the
// behaviour on both sides of the boundary is pinned**, so these cases are the boundary: two that must open and two that
// must not.

import { describe, expect, it } from 'vitest';

import { buildSymbolIndex } from '../symbols.js';

const PATH = 'app/models/ledger.rb';

/**
 * **A `>=` that a wrong scanner reads as an assignment.** If `capped = row.total >= limit` raised the depth, `audit`
 * would be inside `entries` and the class would end at the wrong `end`.
 */
const COMPARISON = [
  'class Ledger',
  '  def entries',
  '    capped = row.total >= limit',
  '    floor = row.total <= minimum',
  '    same = row.a == row.b',
  '    other = row.a != row.b',
  '    capped',
  '  end',
  '',
  '  def audit',
  '    1',
  '  end',
  'end',
];

/** **An `if` as the value of an assignment**, which is a block and closes with its own `end`. */
const ASSIGNED_BLOCK = [
  'class Ledger',
  '  def budget(urgent)',
  '    total = if urgent',
  '      10',
  '    else',
  '      2',
  '    end',
  '    total',
  '  end',
  '',
  '  def audit',
  '    1',
  '  end',
  'end',
];

/** **A conditional assignment whose value is a `case`**, the same shape through `||=`. */
const CONDITIONAL_ASSIGNMENT = [
  'class Ledger',
  '  def kind(row)',
  '    @kind ||= case row.total',
  '             when 0 then :empty',
  '             else :full',
  '             end',
  '  end',
  '',
  '  def audit',
  '    1',
  '  end',
  'end',
];

const indexOf = (source: readonly string[]) => buildSymbolIndex(PATH, source.join('\n'));

/**
 * **The members of the class, by name.**
 *
 * A method is a member rather than a top-level symbol, so `symbolAt` answers a line inside one with its class - which is
 * the right answer and hides exactly the defect under test. **The member list is what shows it**: a depth that did not
 * close makes `audit` a child of `entries`, and the list becomes one name where it should be two.
 */
const membersOf = (source: readonly string[]): string[] =>
  indexOf(source)
    .symbols.find((symbol) => symbol.name === 'Ledger')
    ?.members.map((member) => member.name) ?? [];

describe('an assignment that carries a block', () => {
  it.each([
    ['a comparison on the right-hand side', COMPARISON, 'entries'],
    ['an if as the value of the assignment', ASSIGNED_BLOCK, 'budget'],
    ['a case as the value of a conditional assignment', CONDITIONAL_ASSIGNMENT, 'kind'],
  ])('ends the method before the next one, with %s', (_label, source, method) => {
    // **`audit` is the assertion**, because it is the first declaration after the construct under test: a depth that
    // did not close makes it a child of `entries` and it disappears from the class's members.
    expect(membersOf(source)).toEqual([method, 'audit']);
  });
});

describe('an if at the start of a line', () => {
  it('opens a block of its own rather than being read as an assignment', () => {
    // The complementary case: a leading `if` is the first branch of the pattern, and a split that lost it would close
    // the method one `end` early - which is the direction that truncates rather than swallows.
    const source = [
      'class Ledger',
      '  def sign(row)',
      '    if row.total >= 0',
      '      :positive',
      '    else',
      '      :negative',
      '    end',
      '  end',
      '',
      '  def audit',
      '    1',
      '  end',
      'end',
    ];
    // A leading `if` opens a block, so `sign` closes at its own `end` and `audit` is its sibling.
    expect(membersOf(source)).toEqual(['sign', 'audit']);
  });
});
