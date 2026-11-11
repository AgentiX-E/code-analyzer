// @code-analyzer/shared — the two reductions a type expression needs, on the inputs that break one pass
//
// **The failing input is the one the language is built around.** `Map<String, List<Integer>>` is not an edge case in
// Java or TypeScript; it is how anybody writes a map of lists. `replace(/<[^>]*>/g, '')` reads `<String, List<Integer>`
// as the group and removes it, leaving `Map>` - so a reader that then took the last `.`-segment got `Map>` and filed a
// reference under a name no declaration will ever carry. **Every one of these tests fails on the previous commit.**

import { describe, expect, it } from 'vitest';

import { simpleTypeName, stripTypeArguments } from '../index.js';

describe('stripTypeArguments', () => {
  it('removes an argument list', () => {
    expect(stripTypeArguments('List<String>')).toBe('List');
  });

  it('removes a nested argument list rather than a prefix of it', () => {
    // The single-pass form leaves `Map>` here, and `Set<Map>` for the second.
    expect(stripTypeArguments('Map<String, List<Integer>>')).toBe('Map');
    expect(stripTypeArguments('Set<Map<String, Integer>>')).toBe('Set');
  });

  it('removes argument lists at three levels and in sequence', () => {
    expect(stripTypeArguments('Outer<A<B<C>>>')).toBe('Outer');
    expect(stripTypeArguments('Pair<A, B> of Pair<C, D>')).toBe('Pair of Pair');
  });

  it('keeps a comparison, because a `<` with no `>` is not an argument list', () => {
    expect(stripTypeArguments('a < b')).toBe('a < b');
    expect(stripTypeArguments('f(a < b, c > d)')).toBe('f(a  d)');
  });

  it('leaves text with no angle brackets alone', () => {
    expect(stripTypeArguments('String')).toBe('String');
    expect(stripTypeArguments('')).toBe('');
  });
});

describe('simpleTypeName', () => {
  it('takes the last segment and drops the arguments', () => {
    expect(simpleTypeName('java.util.Map.Entry<String, Integer>')).toBe('Entry');
    expect(simpleTypeName('Map<String, List<Integer>>')).toBe('Map');
  });

  it('trims the whitespace a type expression carries', () => {
    expect(simpleTypeName('  a.b.C  ')).toBe('C');
  });

  it('answers the empty string for a type that names nothing', () => {
    expect(simpleTypeName('')).toBe('');
    expect(simpleTypeName('  ')).toBe('');
  });
});
