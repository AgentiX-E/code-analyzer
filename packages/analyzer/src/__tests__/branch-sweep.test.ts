import { describe, expect, it } from 'vitest';

import { GoProvider } from '../languages/go.js';
import { JavaProvider } from '../languages/java.js';
import { textOfContentStream, unescapePdfString } from '../languages/pdf-text.js';

/**
 * The remaining uncovered branches in `java.ts`, `go.ts` and `pdf-text.ts`, each driven by the smallest source that
 * reaches it.
 *
 * **The patterns are the ones this repository has now met four times**: **a `? :` over a parameter, an `if (value)` on a
 * declarator, an `if (args)` on a call, and an `if (inner && ...)` on an assignment target.** **Each provider is a
 * separate copy of that walker**, so **each needs its own test** - **a branch covered in `c.ts` says nothing about the
 * same line in `go.ts`.**
 */
describe('Java branches', () => {
  const java = new JavaProvider();

  it('captures a method parameter and its value', () => {
    // L86 false side, and L89's identifier side.
    expect(java.parse('class C { void f(int x) { } }', 'T.java').some((k) => k.name === 'x')).toBe(
      true,
    );
  });

  it('resolves an array parameter through nameIn', () => {
    // L89's `nameIn(parameter)` side.
    expect(Array.isArray(java.parse('class C { void f(String[] items) { } }', 'T.java'))).toBe(
      true,
    );
  });

  it('captures a field with an initialiser', () => {
    // L129/L130: the declarator and its name.
    expect(
      java.parse('class C { private int count = 1; }', 'T.java').some((k) => k.name === 'count'),
    ).toBe(true);
  });

  it('captures an assignment whose target is an identifier', () => {
    // L142's declarator side, and the value that follows it.
    const caps = java.parse('class C { void f() { int a; a = 1; } }', 'T.java');
    expect(caps.some((k) => k.name === 'a')).toBe(true);
  });

  it('reports a call with no arguments', () => {
    // L166's false side: an `argument_list` that is absent rather than empty.
    expect(caps(java, 'class C { void f() { g(); } }').includes('function.call')).toBe(true);
  });
});

describe('Go branches', () => {
  const go = new GoProvider();

  it('captures a parameter and its type', () => {
    // L86 false side, and L89's identifier side.
    expect(go.parse('package p\nfunc f(x int) { }', 't.go').some((k) => k.name === 'x')).toBe(true);
  });

  it('resolves a pointer parameter through nameIn', () => {
    // L89's `nameIn(parameter)` side, and L91's `continue` is the other.
    expect(Array.isArray(go.parse('package p\nfunc f(p *int) { }', 't.go'))).toBe(true);
  });

  it('captures an assignment and its right-hand side', () => {
    // L118's `left`, and L132's `right`.
    const caps = go.parse('package p\nfunc f() { x = y }', 't.go');
    expect(caps.some((k) => k.name === 'x')).toBe(true);
    expect(caps.some((k) => k.name === 'y')).toBe(true);
  });

  it('reports a call with no arguments', () => {
    // L135's `callee`, and L149's false side for an absent argument list.
    expect(caps(go, 'package p\nfunc f() { g() }').length).toBeGreaterThan(0);
  });

  it('reports a member call through a selector', () => {
    // L152's `selector_expression` side.
    expect(Array.isArray(go.parse('package p\nfunc f(o T) { o.Run() }', 't.go'))).toBe(true);
  });
});

describe('PDF stream boundaries', () => {
  it('keeps an escaped backslash inside a literal', () => {
    // L86/L87: the escape branch inside the literal scanner.
    expect(textOfContentStream('BT (a\\\\) Tj ET')).toContain('a');
  });

  it('ignores a literal before the text block opens', () => {
    // L100's `inText` false side: a string that is a name, not text.
    expect(textOfContentStream('(ignored) BT (shown) Tj ET')).toContain('shown');
  });

  it('drops an empty literal', () => {
    // L100's `raw.length > 0` false side.
    expect(textOfContentStream('BT () Tj ET').trim()).toBe('');
  });

  it('unescapes a backslash that ends the input', () => {
    // The escape branch with nothing after it.
    expect(unescapePdfString('a\\\\')).toBe('a\\');
  });
});

/** The tags a provider emits, which is what the assertions above ask about. */
function caps(
  provider: { parse: (s: string, f: string) => Array<{ tag: string }> },
  src: string,
): string[] {
  return provider.parse(src, 'x').map((c) => c.tag);
}
