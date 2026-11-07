/**
 * The Groovy shapes a JVM language allows and a typed walk forgets.
 *
 * **Groovy's defining convenience is that a name may have no type**, and this provider's signature facts were written
 * with one: `void draw(List labels)` types its parameter and `void draw(labels)` does not, and the second is the shape
 * every dynamic Groovy method is written in. A walk that assumed the type was there would either throw or record an
 * empty string; **the test is that it records the count and the name and says nothing about a type.**
 */

import { describe, expect, it } from 'vitest';

import { GroovyProvider } from '../languages/groovy.js';

const provider = new GroovyProvider();

const find = (source: string, name: string) =>
  provider.parse(source, 'a.groovy').find((capture) => capture.name === name);

describe('a Groovy declaration that writes no type', () => {
  it('counts an untyped parameter and states no type for it', () => {
    const create = find('class A { void draw(labels) { } }', 'draw');
    expect(create?.properties?.parameterCount).toBe('1');
    expect(create?.properties?.parameterTypes).toBe('[""]');
    expect(create?.properties?.returnType).toBe('void');
  });

  it('records an untyped parameter as a name a call can pass', () => {
    const parameter = find('class A { void draw(labels) { } }', 'labels');
    expect(parameter?.tag).toBe('variable.def');
    expect(parameter?.properties?.parameterType).toBeUndefined();
  });

  it('separates a parameter with a default from one without', () => {
    const create = find('class A { void draw(String name = "x", int count) { } }', 'draw');
    expect(create?.properties?.parameterCount).toBe('2');
    expect(create?.properties?.requiredParameters).toBe('1');
  });

  /**
   * **A `def` method writes no return type either**, and the fact has to be absent rather than empty: the resolver
   * distinguishes "returns nothing" from "the author wrote no type", and `def` is the second.
   */
  it('states no return type for a method declared with `def`', () => {
    const create = find('class A { def draw(int count) { } }', 'draw');
    expect(create?.properties?.returnType).toBeUndefined();
  });
});

describe('a Groovy closure', () => {
  it('is a function definition with the line it starts on', () => {
    const captures = provider.parse('def later = { int x -> x + 1 }\n', 'a.groovy');
    const closure = captures.find((capture) => capture.tag === 'function.def');
    expect(closure?.name).toBe('closure_1');
  });
});

/**
 * **A half-written call is what a taint walk meets on a file being saved.**
 *
 * `foo.(1)` parses into a `method_invocation` whose name the extractor cannot spell, and the three walks that read
 * calls - sources, sinks, sanitizers - each ask the same question first. **An invocation with no name is not a source,
 * a sink or a sanitizer**: reporting one would file a flow from a name the file does not contain.
 */
describe('a Groovy call with no name to spell', () => {
  it('reports no taint source from it', () => {
    expect(provider.extractTaintSources('def x = foo.(1)\n')).toEqual([]);
  });

  it('reports no sink from it', () => {
    expect(provider.extractTaintSinks('foo.(1)\n')).toEqual([]);
  });

  it('reports no sanitizer from it', () => {
    expect(provider.extractSanitizers('foo.(1)\n')).toEqual([]);
  });
});
