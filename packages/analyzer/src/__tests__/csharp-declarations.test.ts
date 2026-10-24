import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { CSharpProvider } from '../languages/csharp.js';

/**
 * Fields, locals and parameters - the three bindings a C# file is made of.
 *
 * **A probe of `void M(Widget w, List<int> xs)` gave `parameter type: (identifier) name: (identifier)` and
 * `parameter type: (generic_name …) name: (identifier)`** - so **a search for the first identifier bound `Widget`, the
 * type, on the first parameter and found nothing at all for `xs`** on the second. **Both looked like they worked,
 * because each produced a capture for a real node.**
 */
describe('CSharpProvider declarations', () => {
  const provider = new CSharpProvider();

  const names = (source: string, tag: string): string[] =>
    provider
      .parse(source, 'Sample.cs')
      .filter((c) => c.tag === tag)
      .map((c) => String(c.name));

  it('binds the parameter name of a parameter whose type is an identifier', () => {
    expect(names('class C {\n  void M(Widget w) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF)).toContain(
      'w',
    );
  });

  it('does not bind the type of a parameter as if it were its name', () => {
    expect(
      names('class C {\n  void M(Widget w) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).not.toContain('Widget');
  });

  it('binds a parameter whose type is generic', () => {
    expect(
      names('class C {\n  void M(List<int> xs) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).toContain('xs');
  });

  it('binds a field declared in a class', () => {
    expect(names('class C {\n  private int count = 0;\n}\n', CAPTURE_TAGS.VARIABLE_DEF)).toContain(
      'count',
    );
  });

  it('binds every declarator of one field declaration', () => {
    const source = 'class C {\n  private int a = 1, b = 2;\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('binds a local and records its initialiser as a use', () => {
    const source = 'class C {\n  void M(int seed) {\n    int local = seed;\n  }\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toContain('local');
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('seed');
  });

  it('binds a local that has no initialiser', () => {
    expect(
      names('class C {\n  void M() {\n    int empty;\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).toContain('empty');
  });

  it('records an assignment target as a write and its value as a use', () => {
    const source = 'class C {\n  void M(int value) {\n    field = value;\n  }\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toContain('field');
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('value');
  });

  it('records an invocation with no arguments as a call', () => {
    expect(
      names('class C {\n  void M() {\n    Reset();\n  }\n}\n', CAPTURE_TAGS.FUNCTION_CALL),
    ).toContain('Reset');
  });

  it('records a member invocation as a method call', () => {
    const source = 'class C {\n  void M() {\n    service.Flush();\n  }\n}\n';
    expect(names(source, CAPTURE_TAGS.METHOD_CALL)).toContain('Flush');
  });
});
