import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { CppProvider } from '../languages/cpp.js';

/**
 * Declarators the return type wraps, and the cases the statement branches must not assume away.
 *
 * **`int &f(int &r)` puts the `function_declarator` inside a `reference_declarator`.** A search that only looked at
 * the definition's direct children therefore found no declarator for **every function returning a reference or a
 * pointer** - no `function.def`, no parameter bindings - and `checkExported` asserted the declarator was present, so
 * the same shape would have thrown. The probe that settled it: `int &f(int &r) { return r; }` parses as
 * `function_definition declarator: (reference_declarator (function_declarator …))`.
 */
describe('CppProvider declarators and statements', () => {
  const provider = new CppProvider();

  const names = (source: string, tag: string): string[] =>
    provider
      .parse(source, 'sample.cpp')
      .filter((c) => c.tag === tag)
      .map((c) => String(c.name));

  it('captures a function that returns a reference', () => {
    expect(
      names('int &counter() { static int n; return n; }\n', CAPTURE_TAGS.FUNCTION_DEF),
    ).toContain('counter');
  });

  it('binds the parameters of a function that returns a reference', () => {
    expect(names('int &at(int &slot) { return slot; }\n', CAPTURE_TAGS.VARIABLE_DEF)).toContain(
      'slot',
    );
  });

  it('captures a forward declaration that returns a reference', () => {
    expect(names('int &counter();\n', CAPTURE_TAGS.FUNCTION_DEF)).toContain('counter');
  });

  it('captures a function defined out of line in its class', () => {
    expect(names('Widget::~Widget() {\n}\n', CAPTURE_TAGS.FUNCTION_DEF)).toContain('~Widget');
  });

  it('binds no name for a parameter that declares only a type', () => {
    expect(names('void reset(void) {\n}\n', CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
  });

  it('records a bare name used as a statement', () => {
    expect(names('void f() {\n  value;\n}\n', CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('value');
  });

  it('records both sides of an assignment', () => {
    const accessed = names('void f() {\n  target = source;\n}\n', CAPTURE_TAGS.VARIABLE_ACCESS);
    expect(accessed).toContain('target');
    expect(accessed).toContain('source');
  });

  it('records a call that takes no arguments', () => {
    expect(names('void f() {\n  reset();\n}\n', CAPTURE_TAGS.FUNCTION_CALL)).toContain('reset');
  });

  it('records a field call as a method call and its receiver as a use', () => {
    const source = 'void f(Server *s) {\n  s->flush();\n}\n';
    expect(names(source, CAPTURE_TAGS.METHOD_CALL)).toContain('flush');
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('s');
  });

  it('does not invent a name for a function that returns a function pointer', () => {
    // `int (*getfn())(int)` nests the name inside `parenthesized_declarator > pointer_declarator >
    // function_declarator`, which is deeper than the name resolver descends - so the honest answer is no capture
    // rather than the wrong one, and the definition must not throw while looking for it.
    expect(() => provider.parse('int (*getfn())(int) { return 0; }\n', 'sample.cpp')).not.toThrow();
    expect(names('int (*getfn())(int) { return 0; }\n', CAPTURE_TAGS.FUNCTION_DEF)).toEqual([]);
  });
});
