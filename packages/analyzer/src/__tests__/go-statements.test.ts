import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { GoProvider } from '../languages/go.js';

/**
 * The three ways Go binds a name, and the two parameter lists a method has.
 *
 * **These cases exist because the tree said something the code did not agree with.** A probe of
 * `func (s *Server) Handle(id string)` gives `method_declaration receiver: (parameter_list …) parameters:
 * (parameter_list …)`, and a probe of `var a, b int = 1, 2` gives one `var_spec` with **two `name:` fields** - so the
 * first `.find` in each path recorded the receiver instead of the parameters and `a` instead of both names, and
 * **both defects looked like success because each produced one plausible capture.**
 */
describe('GoProvider statements and bindings', () => {
  const provider = new GoProvider();

  const defs = (source: string): string[] =>
    provider
      .parse(source, 'sample.go')
      .filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.text?.startsWith('package') !== true)
      .map((c) => String(c.name));

  const accesses = (source: string): string[] =>
    provider
      .parse(source, 'sample.go')
      .filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS)
      .map((c) => String(c.name));

  it('binds the parameters of a method, not only its receiver', () => {
    const source = 'package main\n\nfunc (s *Server) Handle(id string, n int) {\n}\n';
    const bound = defs(source);
    expect(bound).toContain('id');
    expect(bound).toContain('n');
    // The receiver is a binding too, and it is the one the first parameter list names.
    expect(bound).toContain('s');
  });

  it('binds every name of a single var declaration', () => {
    const source = 'package main\n\nvar a, b int = 1, 2\n';
    expect(defs(source)).toEqual(['a', 'b']);
  });

  it('records the right-hand side of a var declaration as a use', () => {
    const source = 'package main\n\nfunc f(x int) {\n\tvar y = x\n\t_ = y\n}\n';
    expect(accesses(source)).toContain('x');
  });

  it('records both sides of an assignment', () => {
    const source = 'package main\n\nfunc f(x int) {\n\ty = x\n\t_ = y\n}\n';
    expect(accesses(source)).toContain('y');
    expect(accesses(source)).toContain('x');
  });

  it('records a compound assignment through its two expression lists', () => {
    const source = 'package main\n\nfunc f(x int) {\n\ty += x\n\t_ = y\n}\n';
    expect(accesses(source)).toContain('x');
  });

  it('records a short variable declaration as a def and its right-hand side as a use', () => {
    const source = 'package main\n\nfunc f(x int) {\n\ty := x\n\t_ = y\n}\n';
    expect(defs(source)).toContain('y');
    expect(accesses(source)).toContain('x');
  });

  it('records a bare name used as a statement', () => {
    // Not accepted by the type checker, but it is what an editor's buffer contains between keystrokes, and the
    // grammar produces `expression_statement (identifier)` for it.
    const source = 'package main\n\nfunc f() {\n\tx\n}\n';
    expect(accesses(source)).toContain('x');
  });

  it('binds no name for an unnamed parameter', () => {
    const source = 'package main\n\nfunc f(int, string) {\n}\n';
    expect(defs(source)).toEqual([]);
  });

  it('records a call with no arguments without an argument list guard', () => {
    const source = 'package main\n\nfunc f() {\n\tg()\n}\n';
    const calls = provider
      .parse(source, 'sample.go')
      .filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL);
    expect(calls.map((c) => c.name)).toContain('g');
  });

  it('records a method call as a method call, and its receiver as a use', () => {
    const source = 'package main\n\nfunc f(s *Server) {\n\ts.Flush()\n}\n';
    const captures = provider.parse(source, 'sample.go');
    expect(captures.filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL).map((c) => c.name)).toContain(
      'Flush',
    );
    expect(
      captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS).map((c) => c.name),
    ).toContain('s');
  });

  it('tags const declarations as constants and var declarations as variables', () => {
    const constants = provider
      .parse('package main\n\nconst limit = 3\n', 'sample.go')
      .filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF)
      .map((c) => String(c.name));
    expect(constants).toEqual(['limit']);
    expect(defs('package main\n\nvar limit = 3\n')).toEqual(['limit']);
  });

  it('reads every spec of a grouped const block', () => {
    const source = 'package main\n\nconst (\n\ta = 1\n\tb = 2\n)\n';
    const constants = provider
      .parse(source, 'sample.go')
      .filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF)
      .map((c) => String(c.name));
    expect(constants).toEqual(['a', 'b']);
  });
});
