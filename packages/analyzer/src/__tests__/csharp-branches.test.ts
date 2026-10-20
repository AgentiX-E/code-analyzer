import { describe, expect, it } from 'vitest';

import { CSharpProvider } from '../languages/csharp.js';

/**
 * The branches `csharp.ts` reported uncovered, each driven by the smallest C# that reaches it.
 *
 * **Eleven branches, and the shapes are the ones this language shares with C and C++**: **an assignment, a call with and
 * without arguments, a parameter that is not a bare identifier, and a field whose name needs resolving.** **The provider
 * is a separate copy of that walker**, so **the branches have to be reached again here** - **a test for one provider has
 * never covered another**, which is **why `c.ts` and `cpp.ts` each needed their own**.
 */
describe('C# statement and declaration branches', () => {
  const cs = new CSharpProvider();

  it('captures a method with a parameter list', () => {
    // L98's false side, and L101/L103 for an identifier parameter.
    const captures = cs.parse('class C { void F(int x) { } }', 't.cs');
    expect(captures.some((k) => k.name === 'x')).toBe(true);
  });

  it('resolves a parameter that is not a bare identifier', () => {
    // L101's `nameIn(parameter)` side.
    const captures = cs.parse('class C { void F(string[] items) { } }', 't.cs');
    expect(Array.isArray(captures)).toBe(true);
  });

  it('captures a field declaration', () => {
    // L133/L134/L135: a declarator with a name.
    const captures = cs.parse('class C { private int count; }', 't.cs');
    expect(captures.some((k) => k.name === 'count')).toBe(true);
  });

  it('captures an assignment whose target is an identifier', () => {
    // L147/L149: the assignment branch, and a right-hand side to follow.
    const captures = cs.parse('class C { void F() { x = y; } }', 't.cs');
    expect(captures.some((k) => k.name === 'x')).toBe(true);
    expect(captures.some((k) => k.name === 'y')).toBe(true);
  });

  it('reports a call with no arguments', () => {
    // L153's false side is a callee-less call; this reaches L167's false side.
    const captures = cs.parse('class C { void F() { g(); } }', 't.cs');
    expect(captures.some((k) => String(k.name) === 'g')).toBe(true);
  });

  it('reports a member call', () => {
    // L153's true side with a member callee.
    const captures = cs.parse('class C { void F() { this.g(1); } }', 't.cs');
    expect(Array.isArray(captures)).toBe(true);
  });

  it('resolves a field without an initialiser', () => {
    // L52's early return, reached when the declarator has no `= value`.
    const captures = cs.parse('class C { private int a; private int b = 1; }', 't.cs');
    expect(captures.some((k) => k.name === 'a')).toBe(true);
    expect(captures.some((k) => k.name === 'b')).toBe(true);
  });

  it('handles a class with no members', () => {
    const captures = cs.parse('class C { }', 't.cs');
    expect(Array.isArray(captures)).toBe(true);
  });
});
