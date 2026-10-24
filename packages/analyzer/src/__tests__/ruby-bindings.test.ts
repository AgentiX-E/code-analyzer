import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { RubyProvider } from '../languages/ruby.js';

/**
 * Ruby's optional parameter list, its several assignment targets, and the field that names a call.
 *
 * **`def m; end` has no `method_parameters` child at all**, **`optional_parameter` and `splat_parameter` carry a
 * `name:` field rather than an `identifier` child**, and **`obj.foo` is `call receiver: (identifier) method:
 * (identifier)`** - so **`child(0)` named the receiver**, and **every method call in a file was recorded under its
 * object's name**.
 */
describe('RubyProvider bindings and calls', () => {
  const provider = new RubyProvider();
  const names = (source: string, tag: string): string[] =>
    provider
      .parse(source, 'sample.rb')
      .filter((c) => c.tag === tag)
      .map((c) => String(c.name));

  it('binds required, optional and splat parameters alike', () => {
    const source = 'def m(a, b = 1, *rest)\n  a\nend\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(
      expect.arrayContaining(['a', 'b', 'rest']),
    );
  });

  it('binds nothing for a method with no parameter list', () => {
    expect(names('def m\n  1\nend\n', CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
  });

  it('binds nothing for an anonymous splat', () => {
    expect(names('def m(*)\n  1\nend\n', CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
  });

  it('binds a local assignment and records its value as a use', () => {
    const source = 'def m(seed)\n  local = seed\n  local\nend\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(expect.arrayContaining(['local']));
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('seed');
  });

  it('does not bind an instance variable assignment as a local', () => {
    // `@count = 1` is `assignment left: (instance_variable)`, so the left side is not an `identifier`.
    expect(names('@count = 1\n', CAPTURE_TAGS.VARIABLE_DEF)).toEqual([]);
  });

  it('names a method call after the method, not after its receiver', () => {
    const source = 'def m(obj)\n  obj.flush\nend\n';
    const calls = provider
      .parse(source, 'sample.rb')
      .filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL);
    expect(calls.map((c) => String(c.name))).toEqual(['flush']);
  });

  it('records the receiver of a method call as a use', () => {
    expect(names('def m(obj)\n  obj.flush\nend\n', CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('obj');
  });

  it('records a call with arguments and a call without them', () => {
    const withArgs = provider.parse('def m(x)\n  puts(x)\nend\n', 'sample.rb');
    expect(
      withArgs.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL).map((c) => c.name),
    ).toContain('puts');
    expect(
      withArgs.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_ACCESS).map((c) => c.name),
    ).toContain('x');
  });

  it('records a constant assignment as a constant', () => {
    expect(names('MAX_SIZE = 100\n', CAPTURE_TAGS.CONSTANT_DEF)).toEqual(['MAX_SIZE']);
  });
});
