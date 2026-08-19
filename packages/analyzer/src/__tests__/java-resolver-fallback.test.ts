// @code-analyzer/analyzer — Java Resolver Fallback Tests
// Verifies the regex-based fallback extraction path used when the native
// tree-sitter-java grammar fails to load (e.g. binary incompatibility).

import { describe, it, expect } from 'vitest';
import { JavaResolver } from '../resolution/java-resolver.js';

describe('JavaResolver — fallback extraction', () => {
  // Inject a grammar loader that reports failure, forcing regex extraction.
  const makeFallbackResolver = (): JavaResolver => new JavaResolver(() => null);

  it('extracts classes via regex when the grammar is unavailable', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes(
      'public abstract class Foo<T> extends Bar implements Baz, Qux {\n}',
      '/test.java',
    );
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Foo');
    expect(types[0]!.kind).toBe('class');
    expect(types[0]!.baseTypes).toEqual(['Bar']);
    expect(types[0]!.implementedInterfaces).toEqual(['Baz', 'Qux']);
    expect(types[0]!.typeParameters).toEqual(['T']);
  });

  it('extracts interfaces with generic type params via regex', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes(
      'public interface Reader<T> extends AutoCloseable, Cloneable {\n}',
      '/test.java',
    );
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Reader');
    expect(types[0]!.kind).toBe('interface');
    expect(types[0]!.baseTypes).toEqual(['AutoCloseable', 'Cloneable']);
    expect(types[0]!.typeParameters).toEqual(['T']);
  });

  it('extracts enums via regex', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes('public enum Color {\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Color');
    expect(types[0]!.kind).toBe('enum');
  });

  it('extracts a private final class without generics', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes('private final class Immutable {\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Immutable');
    expect(types[0]!.baseTypes).toEqual([]);
    expect(types[0]!.implementedInterfaces).toEqual([]);
    expect(types[0]!.typeParameters).toEqual([]);
  });

  it('extracts classes with generic extends but no implements', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes('class Wrapper<T> extends Box<String> {\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Wrapper');
    expect(types[0]!.baseTypes).toEqual(['Box']);
    expect(types[0]!.implementedInterfaces).toEqual([]);
  });

  it('extracts a plain interface without extends or type params', () => {
    const resolver = makeFallbackResolver();
    const types = resolver.extractTypes('public interface Marker {\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Marker');
    expect(types[0]!.kind).toBe('interface');
    expect(types[0]!.baseTypes).toEqual([]);
    expect(types[0]!.typeParameters).toEqual([]);
  });
});
