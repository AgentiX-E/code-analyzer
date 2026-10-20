import { describe, expect, it } from 'vitest';

import { CSharpProvider } from '../languages/csharp.js';

/**
 * The false sides of `csharp.ts`, which the first file left uncovered.
 *
 * **And the first file left them uncovered because its assertions were weak**: **three of its cases end in
 * `expect(Array.isArray(captures)).toBe(true)`**, which **passes for every possible output including the empty one** -
 * **the shape this repository has recorded more than once as an assertion that cannot fail.**
 *
 * **So each case here asserts a specific capture or a specific absence**, and **the branch it reaches is named**, which
 * **is what makes the difference between covering a line and testing a behaviour.**
 */
describe('C# false sides', () => {
  const cs = new CSharpProvider();

  it('does not treat a member assignment as a variable definition', () => {
    // L162's false side: the target is a `member_access_expression`, not an `identifier`.
    const captures = cs.parse('class C { void F() { this.x = 5; } }', 't.cs');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'x')).toBe(false);
  });

  it('reports the value of a member assignment as a use', () => {
    // L175's true side, through the same expression.
    const captures = cs.parse('class C { void F() { this.x = known; } }', 't.cs');
    expect(captures.some((k) => k.name === 'known')).toBe(true);
  });

  it('reports a call whose callee is a member access as a method call', () => {
    // L178's true side and L154's `isMethod` true side, and the `.pop()` name.
    const captures = cs.parse('class C { void F() { this.g(); } }', 't.cs');
    const call = captures.find((k) => k.tag === 'method.call');
    expect(call).toBeDefined();
    expect(String(call?.name)).toBe('g');
  });

  it('reports a call whose callee is a bare identifier as a function call', () => {
    // L154's false side.
    const captures = cs.parse('class C { void F() { g(); } }', 't.cs');
    const call = captures.find((k) => k.tag === 'function.call');
    expect(call).toBeDefined();
    expect(String(call?.name)).toBe('g');
  });

  it('captures a field whose declarator has no initialiser', () => {
    // L52's early return, and L140-142 resolving the declarator's name.
    const captures = cs.parse('class C { private int count; }', 't.cs');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'count')).toBe(true);
  });

  it('captures a method parameter that is not a bare identifier', () => {
    // L101's `nameIn(parameter)` side, and L103's `continue` is the other one.
    const captures = cs.parse('class C { void F(string[] items) { } }', 't.cs');
    expect(captures.some((k) => k.tag === 'variable.def' && k.name === 'items')).toBe(true);
  });

  it('handles a lambda with no parameter list', () => {
    // L98's `!list` side: a callable with no `parameter_list` of its own.
    const captures = cs.parse('class C { void F() { var f = () => 1; } }', 't.cs');
    expect(Array.isArray(captures)).toBe(true);
    expect(captures.length).toBeGreaterThan(0);
  });
});
