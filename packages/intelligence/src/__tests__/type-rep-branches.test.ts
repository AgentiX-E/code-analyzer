// @ts-nocheck
// @code-analyzer/intelligence — typeToString branch coverage for every TypeRep
// kind, plus optional/readonly modifiers and constrained type parameters.

import { describe, it, expect } from 'vitest';
import { t, typeToString } from '../lsp/type-rep.js';

describe('typeToString — kind coverage', () => {
  it('renders a type parameter with and without a constraint', () => {
    expect(typeToString(t.typeParam('T'))).toBe('T');
    expect(typeToString(t.typeParam('T', t.named('string')))).toBe('T extends string');
  });

  it('renders a conditional type', () => {
    const c = t.conditional(t.typeParam('T'), t.named('string'), t.named('true'), t.named('false'));
    expect(typeToString(c)).toBe('T extends string ? true : false');
  });

  it('renders indexed access and keyof', () => {
    expect(typeToString(t.indexedAccess(t.named('Foo'), t.named('bar')))).toBe('Foo[bar]');
    expect(typeToString(t.keyof(t.named('Foo')))).toBe('keyof Foo');
  });

  it('renders a mapped type', () => {
    const m = t.mapped('K', t.named('string'), t.named('number'));
    expect(typeToString(m)).toBe('{ [K in string]: number }');
  });

  it('renders an object literal with readonly and optional props', () => {
    const o = t.objectLiteral([
      t.prop('a', t.named('number')),
      t.prop('b', t.named('string'), { isOptional: true }),
      t.prop('c', t.named('boolean'), { isReadonly: true }),
    ]);
    expect(typeToString(o)).toBe('{ a: number; b?: string; readonly c: boolean }');
  });

  it('renders a tuple', () => {
    expect(typeToString(t.tuple(t.named('string'), t.named('number')))).toBe('[string, number]');
  });

  it('renders an infer type', () => {
    expect(typeToString(t.infer('R'))).toBe('infer R');
  });

  it('renders a function with an optional parameter', () => {
    const f = t.func(
      [t.param('x', t.named('number')), t.param('y', t.named('string'), { isOptional: true })],
      t.named('void'),
    );
    expect(typeToString(f)).toBe('(x: number, y?: string) => void');
  });
});
