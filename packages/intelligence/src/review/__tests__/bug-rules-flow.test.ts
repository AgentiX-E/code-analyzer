// Three more bug shapes, and the reason each is decidable from one construct.
//
// **The rule this file follows is the one the existing bug rules were chosen on**: *a defect that is decidable from
// the syntax of a single construct* - **no dataflow, no types, no cross-file knowledge.** A line-based engine that
// reaches for more than that **becomes a source of noise**, and **its precision is already the scarce resource.**
//
// **And every case asserts both directions.** A rule that fires on the correct form of the same construct costs
// precision, so **each one below has a companion case that must stay silent** - **`expect(fired).toHaveLength(1)`
// alone is satisfied by a rule that fires on everything.**

import { describe, expect, it } from 'vitest';

import { checkReturnInFinally, checkJsonParseUnwrapped, checkForEachWithReturn } from '../heuristics-bug-rules-flow.js';

describe('a return inside finally', () => {
  it('fires, because it discards whatever the try and the catch threw', () => {
    // **The canonical form.** A `return` in a `finally` **replaces the exception that was propagating**, so **the
    // caller sees a value where it should have seen a failure.**
    const lines = ['function f() {', '  try {', '    return risky();', '  } finally {', '    return fallback;', '  }', '}'];
    const found = checkReturnInFinally(lines);
    expect(found).toHaveLength(1);
    expect(found[0]!.startLine).toBe(5);
    expect(found[0]!.category).toBe('bug');
  });

  it('stays silent when the finally only cleans up', () => {
    // **The correct form**, and the one that appears in almost every real `finally`: a close, a reset, a log.
    const lines = ['function f() {', '  try {', '    return risky();', '  } finally {', '    handle.close();', '  }', '}'];
    expect(checkReturnInFinally(lines)).toHaveLength(0);
  });

  it('stays silent when the return is outside the finally block', () => {
    // **A `return` after the block is not one inside it**, and a rule that counted braces wrongly would fire here.
    const lines = ['function f() {', '  try {', '    risky();', '  } finally {', '    handle.close();', '  }', '  return ok;', '}'];
    expect(checkReturnInFinally(lines)).toHaveLength(0);
  });
});

describe('JSON.parse without a guard', () => {
  it('fires, because malformed input throws where the value is used', () => {
    // **Decidable from the call site**: `JSON.parse` throws on malformed input, **and nothing here handles it** -
    // **no `try`, no `.catch`, no `??` fallback.**
    const lines = ['const config = JSON.parse(raw);', 'start(config);'];
    const found = checkJsonParseUnwrapped(lines);
    expect(found).toHaveLength(1);
    expect(found[0]!.startLine).toBe(1);
    expect(found[0]!.category).toBe('bug');
  });

  it('stays silent inside a try block', () => {
    // **The idiomatic form**, and the one the rule must not punish.
    const lines = ['function load(raw) {', '  try {', '    return JSON.parse(raw);', '  } catch {', '    return null;', '  }', '}'];
    expect(checkJsonParseUnwrapped(lines)).toHaveLength(0);
  });

  it('stays silent when a fallback is written on the same line', () => {
    // **`??` and `||` are handling decisions expressed in one expression**, and a rule that missed them would fire on
    // code whose author already thought about the failure.
    const lines = ['const config = JSON.parse(raw) ?? {};'];
    expect(checkJsonParseUnwrapped(lines)).toHaveLength(0);
  });
});

describe('a return inside forEach', () => {
  it('fires, because it exits the callback rather than the loop', () => {
    // **A misreading of the API that produces a silent no-op**: the author expects the first `return` to stop the
    // iteration and it stops one call instead.
    const lines = ['items.forEach((x) => {', '  if (!x.ok) return;', '  use(x);', '});'];
    const found = checkForEachWithReturn(lines);
    expect(found).toHaveLength(1);
    expect(found[0]!.startLine).toBe(2);
    expect(found[0]!.category).toBe('bug');
  });

  it('stays silent when the return carries a value out of the callback', () => {
    // **`return x` inside `map` is the whole point of `map`** - and the same keyword inside `forEach` is the bug.
    const lines = ['const ys = items.map((x) => {', '  return x.value;', '});'];
    expect(checkForEachWithReturn(lines)).toHaveLength(0);
  });

  it('stays silent in a real loop', () => {
    const lines = ['for (const x of items) {', '  if (!x.ok) return;', '  use(x);', '}'];
    expect(checkForEachWithReturn(lines)).toHaveLength(0);
  });
});
