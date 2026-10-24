import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { JavaProvider } from '../languages/java.js';

/**
 * Parameters, locals and invocations - the three places a Java name is bound or read.
 *
 * **`void m(Widget w)` is `formal_parameter type: (type_identifier) name: (identifier)`**, so **the search for the
 * first identifier bound the type**, and **`service.flush()` gave the receiver `service` where the method name was
 * expected** - the first identifier under `method_invocation` is the object, not the name. **Both produced a capture
 * of a real node, which is why neither looked wrong until a probe printed the tree.**
 */
describe('JavaProvider declarations', () => {
  const provider = new JavaProvider();

  const names = (source: string, tag: string): string[] =>
    provider
      .parse(source, 'Sample.java')
      .filter((c) => c.tag === tag)
      .map((c) => String(c.name));

  it('binds the parameter name of a parameter whose type is an identifier', () => {
    expect(names('class C {\n  void m(Widget w) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF)).toContain(
      'w',
    );
  });

  it('does not bind the type of a parameter as if it were its name', () => {
    expect(
      names('class C {\n  void m(Widget w) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).not.toContain('Widget');
  });

  it('binds a variadic parameter', () => {
    expect(
      names('class C {\n  void m(String... parts) {\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).toContain('parts');
  });

  it('binds every declarator of one local declaration', () => {
    const source = 'class C {\n  void m() {\n    int a = 1, b = 2;\n  }\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('binds an unnamed variable, which Java spells `_`', () => {
    expect(
      names('class C {\n  void m() {\n    int _ = 1;\n  }\n}\n', CAPTURE_TAGS.VARIABLE_DEF),
    ).toEqual(['_']);
  });

  it('records the initialiser of a local as a use', () => {
    const source = 'class C {\n  void m(int seed) {\n    int local = seed;\n  }\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('seed');
  });

  it('records a member invocation as a method call named after the method', () => {
    const source = 'class C {\n  void m(Service service) {\n    service.flush();\n  }\n}\n';
    const calls = provider
      .parse(source, 'Sample.java')
      .filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL);
    expect(calls.map((c) => String(c.name))).toContain('flush');
    expect(calls.map((c) => String(c.name))).not.toContain('service');
  });

  it('records a bare invocation as a function call', () => {
    expect(
      names('class C {\n  void m() {\n    reset();\n  }\n}\n', CAPTURE_TAGS.FUNCTION_CALL),
    ).toContain('reset');
  });

  it('records a bare name used as a statement', () => {
    expect(
      names('class C {\n  void m() {\n    value;\n  }\n}\n', CAPTURE_TAGS.VARIABLE_ACCESS),
    ).toContain('value');
  });

  it('records a field access used as a statement', () => {
    expect(
      names('class C {\n  void m() {\n    this.value;\n  }\n}\n', CAPTURE_TAGS.VARIABLE_ACCESS),
    ).toContain('this.value');
  });
});
