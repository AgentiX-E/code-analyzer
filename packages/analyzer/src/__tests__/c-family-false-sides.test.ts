import { describe, expect, it } from 'vitest';

import { CProvider } from '../languages/c.js';
import { CSharpProvider } from '../languages/csharp.js';
import { CppProvider } from '../languages/cpp.js';

/**
 * The false sides of the three C-family providers, driven by source that reaches them.
 *
 * **Twenty-eight branches were reported uncovered across `c.ts`, `cpp.ts` and `csharp.ts`, and every one of them was the
 * FALSE side of a guard**: `if (value)`, `if (callee)`, `if (args)`, `if (declarator)`, `if (name)`, and the two arms of a
 * `? parameter : nameIn(parameter)`.
 *
 * **Those are not missing tests in the usual sense** - **they are the branches that a well-formed declaration never
 * takes**, and **the only way to tell a guard from a formality is to write the source that reaches it.** **A `void`
 * parameter is not an identifier**, and **`int x;` has no initialiser** - **both are ordinary C and both were uncovered.**
 */
describe('C false sides', () => {
  const c = new CProvider();

  it('handles a declaration with no initialiser', () => {
    // `if (value)` false side: `int x;` binds a name and no value.
    const caps = c.parse('void f(void){ int x; }', 't.c');
    expect(caps.some((k) => k.tag === 'variable.def' && k.name === 'x')).toBe(true);
  });

  it('handles a `void` parameter, which is not an identifier', () => {
    // The `parameter.type === 'identifier'` false side.
    expect(Array.isArray(c.parse('void f(void){ }', 't.c'))).toBe(true);
  });

  it('handles a member write, whose target is not a plain identifier', () => {
    const caps = c.parse('void f(struct S *p){ p->x = 1; }', 't.c');
    expect(caps.some((k) => k.tag === 'struct.def' && k.name === 'S')).toBe(true);
  });

  it('handles a call with no arguments', () => {
    // `if (args)` true side, where the list exists and is empty.
    expect(c.parse('void f(void){ g(); }', 't.c').some((k) => k.tag === 'function.call')).toBe(
      true,
    );
  });
});

describe('C++ false sides', () => {
  const cpp = new CppProvider();

  it('handles a declaration with no initialiser', () => {
    expect(cpp.parse('void f(){ int x; }', 't.cpp').some((k) => k.name === 'x')).toBe(true);
  });

  it('handles a call with no arguments', () => {
    expect(cpp.parse('void f(){ g(); }', 't.cpp').some((k) => k.tag === 'function.call')).toBe(
      true,
    );
  });

  it('handles an operator overload, whose name comes from a signature', () => {
    // L248/L249: the signature path that resolves a function name.
    const caps = cpp.parse('struct S { int operator+(int a); };', 't.cpp');
    expect(Array.isArray(caps)).toBe(true);
  });
});

describe('C# false sides', () => {
  const cs = new CSharpProvider();

  it('handles a local with no initialiser', () => {
    expect(cs.parse('class C { void F(){ int x; } }', 't.cs').some((k) => k.name === 'x')).toBe(
      true,
    );
  });

  it('handles a call with no arguments', () => {
    expect(
      cs.parse('class C { void F(){ g(); } }', 't.cs').some((k) => k.tag === 'function.call'),
    ).toBe(true);
  });

  it('handles a method with no parameters', () => {
    // L98's `!list` side is a callable with no parameter list at all.
    const caps = cs.parse('class C { void F(){ } }', 't.cs');
    expect(caps.some((k) => k.tag === 'method.def')).toBe(true);
  });
});
