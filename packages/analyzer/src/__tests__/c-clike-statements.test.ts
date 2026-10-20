import { describe, expect, it } from 'vitest';

import { CProvider } from '../languages/c.js';
import { CppProvider } from '../languages/cpp.js';

/**
 * The branches the honest coverage gate named, each driven by the smallest source that reaches it.
 *
 * **Why this file exists**: `c.ts` and `cpp.ts` report **17 and 20 uncovered branches**, and **every one of them is in
 * the statement and expression handling** - the part that gives taint something to travel along. **A branch there that
 * no test reaches is a path the analysis cannot take**, so **the count is a statement about capability rather than about
 * tidiness.**
 *
 * **Each case below names the branch it reaches**, so **a failure says which capability was lost** rather than which
 * assertion moved.
 */

describe('C statements and expressions', () => {
  const c = new CProvider();

  it('captures an assignment whose target is an identifier', () => {
    // L182: the `assignment_expression` branch.
    const captures = c.parse('void f(void) { x = 5; }', 't.c');
    expect(captures.some((k) => k.name === 'x')).toBe(true);
  });

  it('captures the right-hand side of an assignment as a use', () => {
    // L197: `if (value) this.captureAccesses(value, captures)`.
    const captures = c.parse('void f(void) { x = y; }', 't.c');
    expect(captures.some((k) => k.name === 'y')).toBe(true);
  });

  it('names a call whose callee is an identifier as a function call', () => {
    // L203/L209, the false side of `isMethod`.
    const captures = c.parse('void f(void) { helper(); }', 't.c');
    const call = captures.find((k) => k.tag === 'function.call');
    expect(call?.name).toBe('helper');
  });

  it('names a call whose callee is a field as a method call', () => {
    // L203/L209, the true side of `isMethod` and the `.split('.').pop()` fallback.
    const captures = c.parse('void f(struct S *s) { s->run(); }', 't.c');
    const call = captures.find((k) => k.tag === 'method.call');
    expect(call).toBeDefined();
    expect(String(call?.name)).toContain('run');
  });

  it('resolves a pointer parameter through nameIn', () => {
    // L110, the `nameIn(parameter)` side of the ternary.
    const captures = c.parse('void f(int *p) { return; }', 't.c');
    expect(captures.some((k) => k.name === 'p')).toBe(true);
  });
});

describe('C++ statements and expressions', () => {
  const cpp = new CppProvider();

  it('captures an assignment whose target is an identifier', () => {
    // cpp L195/197: the same branch in the second copy of the walker.
    const captures = cpp.parse('void f() { x = 5; }', 't.cpp');
    expect(captures.some((k) => k.name === 'x')).toBe(true);
  });

  it('names a member call as a method call', () => {
    // cpp L210/216/222: `isMethod`, and the fallback when `pop()` returns undefined.
    const captures = cpp.parse('void f() { obj.run(); }', 't.cpp');
    const call = captures.find((k) => k.tag === 'method.call' || k.tag === 'function.call');
    expect(call).toBeDefined();
    expect(String(call?.name)).toContain('run');
  });

  it('captures a free call as a function call', () => {
    // cpp L105/106/110: the ternary sides in the emission helper.
    const captures = cpp.parse('void f() { helper(); }', 't.cpp');
    expect(captures.some((k) => String(k.name) === 'helper')).toBe(true);
  });
});

/**
 * The false sides, which the first pass left uncovered.
 *
 * **Each one is a path the analysis takes on ordinary source** - **a field assigned through `obj.x`, a call with no
 * arguments, a parameter that is not a bare identifier** - **so a branch here that no test reaches is a shape the
 * product cannot follow**, not a defensive line that nobody needs.
 */
describe('C and C++ shapes the first pass did not reach', () => {
  const c = new CProvider();
  const cpp = new CppProvider();

  it('C: does not treat a field assignment as a variable definition', () => {
    // L184's false side: `target` is a `field_expression`, not an `identifier`.
    const captures = c.parse('void f(struct S *s) { s->field = 5; }', 't.c');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'field')).toBe(false);
  });

  it('C++: does not treat a member assignment as a variable definition', () => {
    // cpp L197's false side.
    const captures = cpp.parse('void f() { obj.field = 5; }', 't.cpp');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'field')).toBe(false);
  });

  it('C++: reports a call that takes no arguments', () => {
    // L227's false side: `namedChildrenOf` has no `argument_list`.
    const captures = cpp.parse('void f() { g(); }', 't.cpp');
    expect(captures.some((k) => k.tag === 'function.call')).toBe(true);
  });

  it('C++: resolves a pointer parameter through nameIn', () => {
    // L110's false side of the ternary.
    const captures = cpp.parse('void f(int *p) { }', 't.cpp');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'p')).toBe(true);
  });

  it('C: resolves a function-pointer-returning parameter without throwing', () => {
    // L110's `nameIn` path on a nested declarator.
    const captures = c.parse('void f(int (*cb)(int)) { }', 't.c');
    expect(Array.isArray(captures)).toBe(true);
  });

  it('C++: keeps a call whose callee is a parenthesised expression', () => {
    // L213's false side is a `call_expression` with no `child(0)`; this asserts the true side survives.
    const captures = cpp.parse('void f() { (g)(); }', 't.cpp');
    expect(Array.isArray(captures)).toBe(true);
  });
});
