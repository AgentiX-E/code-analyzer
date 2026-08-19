// @code-analyzer/analyzer — Java Resolver Tests
// Comprehensive coverage for the Java type resolver: primitives, generics,
// wildcards, annotation processing, method overloading, and AST extraction.

import { describe, it, expect } from 'vitest';
import { JavaResolver } from '../resolution/java-resolver.js';
import type { TypeContext } from '../resolution/type-resolver-base.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<TypeContext> = {}): TypeContext {
  return { filePath: '/test.java', imports: [], ...overrides };
}

function makeResolver(): JavaResolver {
  return new JavaResolver();
}

// A structurally-compatible Java method signature (the interface is private).
function sig(
  paramTypes: string[],
  returnType = 'void',
): {
  name: string;
  paramTypes: string[];
  returnType: string;
  visibility: 'public' | 'protected' | 'private' | 'package';
  isStatic: boolean;
  isAbstract: boolean;
  isFinal: boolean;
  annotations: string[];
  throwsTypes: string[];
} {
  return {
    name: 'm',
    paramTypes,
    returnType,
    visibility: 'public',
    isStatic: false,
    isAbstract: false,
    isFinal: false,
    annotations: [],
    throwsTypes: [],
  };
}

// ====================================================================
// resolveType — primitives
// ====================================================================

describe('JavaResolver.resolveType — primitives', () => {
  it.each(['boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char'])(
    'resolves %s as primitive',
    async (prim) => {
      const result = await makeResolver().resolveType(prim, makeContext());
      expect(result).not.toBeNull();
      expect(result!.kind).toBe('primitive');
      expect(result!.name).toBe(prim);
      expect(result!.isNullable).toBe(false);
    },
  );

  it('resolves void as primitive', async () => {
    const result = await makeResolver().resolveType('void', makeContext());
    expect(result!.kind).toBe('primitive');
  });

  it('resolves null as nullable primitive', async () => {
    const result = await makeResolver().resolveType('null', makeContext());
    expect(result!.kind).toBe('primitive');
    expect(result!.isNullable).toBe(true);
  });
});

// ====================================================================
// resolveType — arrays
// ====================================================================

describe('JavaResolver.resolveType — arrays', () => {
  it('resolves int[] with primitive element', async () => {
    const result = await makeResolver().resolveType('int[]', makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('int[]');
    expect(result!.genericArgs![0]!.name).toBe('int');
    expect(result!.genericArgs![0]!.kind).toBe('primitive');
  });

  it('resolves String[] with unknown element', async () => {
    const result = await makeResolver().resolveType('String[]', makeContext());
    expect(result!.name).toBe('String[]');
    expect(result!.genericArgs![0]!.name).toBe('String');
    expect(result!.genericArgs![0]!.kind).toBe('unknown');
  });

  it('returns null for non-array type', async () => {
    // A bare identifier is not an array — resolved later as unknown → null.
    const result = await makeResolver().resolveType('Foo', makeContext());
    expect(result).toBeNull();
  });
});

// ====================================================================
// resolveType — generics
// ====================================================================

describe('JavaResolver.resolveType — generics', () => {
  it('resolves a non-collection generic without members', async () => {
    const result = await makeResolver().resolveType('Foo<Bar>', makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Foo<Bar>');
    expect(result!.genericArgs).toHaveLength(1);
    expect(result!.members).toBeUndefined();
  });

  it('resolves nested generic args', async () => {
    const result = await makeResolver().resolveType('Map<String, List<Integer>>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.genericArgs).toHaveLength(2);
    expect(result!.genericArgs![1]!.name).toBe('List<Integer>');
  });

  it('resolves ArrayList with size/get/add members', async () => {
    const result = await makeResolver().resolveType('ArrayList<Integer>', makeContext());
    expect(result!.members!['size']).toBeDefined();
    expect(result!.members!['get']).toBeDefined();
    expect(result!.members!['add']).toBeDefined();
  });

  it('resolves LinkedList with list members', async () => {
    const result = await makeResolver().resolveType('LinkedList<String>', makeContext());
    expect(result!.members!['add']).toBeDefined();
  });

  it('resolves HashMap with size/get/put members', async () => {
    const result = await makeResolver().resolveType('HashMap<String, Integer>', makeContext());
    expect(result!.members!['size']).toBeDefined();
    expect(result!.members!['get']).toBeDefined();
    expect(result!.members!['put']).toBeDefined();
  });

  it('resolves TreeMap with put member', async () => {
    const result = await makeResolver().resolveType('TreeMap<String, Integer>', makeContext());
    expect(result!.members!['put']).toBeDefined();
  });

  it('resolves HashSet with add member', async () => {
    const result = await makeResolver().resolveType('HashSet<String>', makeContext());
    expect(result!.members!['add']).toBeDefined();
  });

  it('resolves TreeSet with add member', async () => {
    const result = await makeResolver().resolveType('TreeSet<String>', makeContext());
    expect(result!.members!['add']).toBeDefined();
  });

  it('resolves Optional with get/isPresent members', async () => {
    const result = await makeResolver().resolveType('Optional<String>', makeContext());
    expect(result!.members!['get']).toBeDefined();
    expect(result!.members!['isPresent']).toBeDefined();
  });

  it('resolves Stream with collect/map/filter members', async () => {
    const result = await makeResolver().resolveType('Stream<String>', makeContext());
    expect(result!.members!['collect']).toBeDefined();
    expect(result!.members!['map']).toBeDefined();
    expect(result!.members!['filter']).toBeDefined();
  });

  it('resolves a single-argument Map with an unknown value type', async () => {
    const result = await makeResolver().resolveType('Map<String>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.members!['get']!.returnType!.kind).toBe('unknown');
  });

  it('resolves a known collection without members to no members', async () => {
    const result = await makeResolver().resolveType('Collection<Integer>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.members).toBeUndefined();
  });

  it('resolves Comparator<T> (known collection without members)', async () => {
    const result = await makeResolver().resolveType('Comparator<String>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.members).toBeUndefined();
  });
});

// ====================================================================
// resolveType — wildcards
// ====================================================================

describe('JavaResolver.resolveType — wildcards', () => {
  it('resolves ? extends T', async () => {
    const result = await makeResolver().resolveType('? extends Number', makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('? extends Number');
  });

  it('resolves ? super T', async () => {
    const result = await makeResolver().resolveType('? super Integer', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('? super Integer');
  });

  it('resolves bare ?', async () => {
    const result = await makeResolver().resolveType('?', makeContext());
    expect(result!.kind).toBe('unknown');
    expect(result!.name).toBe('?');
  });

  it('returns null for a non-wildcard identifier', async () => {
    const result = await makeResolver().resolveType('NotAWildcard', makeContext());
    expect(result).toBeNull();
  });
});

// ====================================================================
// resolveType — external resolution & caching
// ====================================================================

describe('JavaResolver.resolveType — external & caching', () => {
  it('delegates to the external resolver when a match is found', async () => {
    const resolver = makeResolver();
    const external = { name: 'ExternalType', kind: 'object' as const };
    const result = await resolver.resolveType(
      'ExternalType',
      makeContext({ resolveExternal: () => external }),
    );
    expect(result).toEqual(external);
  });

  it('returns null when the external resolver has no match', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType(
      'ExternalType',
      makeContext({ resolveExternal: () => null }),
    );
    expect(result).toBeNull();
  });

  it('caches resolved types and returns them from getAllTypes', async () => {
    const resolver = makeResolver();
    await resolver.resolveType('List<String>', makeContext());
    await resolver.resolveType('int', makeContext());
    const all = resolver.getAllTypes();
    expect(all.has('List<String>')).toBe(true);
    expect(all.has('int')).toBe(true);
  });

  it('returns the same cached instance on repeat resolution', async () => {
    const resolver = makeResolver();
    const a = await resolver.resolveType('List<String>', makeContext());
    const b = await resolver.resolveType('List<String>', makeContext());
    expect(a).toBe(b);
  });
});

// ====================================================================
// Annotation processing
// ====================================================================

describe('JavaResolver.processAnnotation', () => {
  it.each(['Nullable', 'javax.annotation.Nullable', 'org.jetbrains.annotations.Nullable'])(
    'marks %s as nullable',
    (name) => {
      const result = makeResolver().processAnnotation({ name, params: {} });
      expect(result).toEqual({ name: 'null', kind: 'primitive', isNullable: true });
    },
  );

  it.each(['NotNull', 'javax.validation.constraints.NotNull', 'org.jetbrains.annotations.NotNull'])(
    'marks %s as non-null',
    (name) => {
      const result = makeResolver().processAnnotation({ name, params: {} });
      expect(result).toEqual({ name: 'null', kind: 'primitive', isNullable: false });
    },
  );

  it.each(['NonNull', 'Override', 'Deprecated', 'SuppressWarnings'])(
    'returns null for %s (no type change)',
    (name) => {
      expect(makeResolver().processAnnotation({ name, params: {} })).toBeNull();
    },
  );

  it('maps FunctionalInterface to an object type', () => {
    expect(makeResolver().processAnnotation({ name: 'FunctionalInterface', params: {} })).toEqual({
      name: 'FunctionalInterface',
      kind: 'object',
    });
  });

  it.each(['Entity', 'javax.persistence.Entity'])('maps %s to an Entity object', (name) => {
    expect(makeResolver().processAnnotation({ name, params: {} })).toEqual({
      name: 'Entity',
      kind: 'object',
    });
  });

  it.each(['Repository', 'org.springframework.stereotype.Repository'])(
    'maps %s to a Repository object',
    (name) => {
      expect(makeResolver().processAnnotation({ name, params: {} })).toEqual({
        name: 'Repository',
        kind: 'object',
      });
    },
  );

  it.each(['Service', 'org.springframework.stereotype.Service'])(
    'maps %s to a Service object',
    (name) => {
      expect(makeResolver().processAnnotation({ name, params: {} })).toEqual({
        name: 'Service',
        kind: 'object',
      });
    },
  );

  it('maps a custom annotation to an object with param members', () => {
    const result = makeResolver().processAnnotation({
      name: 'MyAnn',
      params: { value: 'hello' },
    });
    expect(result).toEqual({
      name: '@MyAnn',
      kind: 'object',
      members: { value: { name: 'hello', kind: 'primitive' } },
    });
  });
});

// ====================================================================
// Method overloading
// ====================================================================

describe('JavaResolver.scoreOverloadMatch', () => {
  it('scores an exact match as 10', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['int']), ['int'])).toBe(10);
  });

  it('returns -1 for an arity mismatch', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['int']), ['int', 'int'])).toBe(-1);
  });

  it('scores a primitive widening conversion as 8', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['long']), ['int'])).toBe(8);
  });

  it('scores an invalid primitive narrowing as 0', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['int']), ['double'])).toBe(0);
  });

  it('scores a subtype (assignable) match as 5', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['Object']), ['String'])).toBe(5);
  });

  it('scores a null argument as 3', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['String']), ['null'])).toBe(3);
  });

  it('scores a loose (boxing) match as 1', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['String']), ['int'])).toBe(1);
  });

  it('rejects Object as an argument to a more specific parameter', () => {
    // Object is not assignable to String → loose (boxing) match.
    expect(makeResolver().scoreOverloadMatch(sig(['String']), ['Object'])).toBe(1);
  });

  it('rejects unrelated reference types', () => {
    expect(makeResolver().scoreOverloadMatch(sig(['Integer']), ['String'])).toBe(1);
  });
});

describe('JavaResolver.resolveOverload', () => {
  const src = [
    'public class Overloads {',
    '  public void foo(int x) { }',
    '  public void foo(String x) { }',
    '  public void foo(long x) { }',
    '}',
  ].join('\n');

  it('returns null when no overloads are registered', () => {
    expect(makeResolver().resolveOverload('foo', ['int'])).toBeNull();
  });

  it('resolves the exact-matching overload', () => {
    const resolver = makeResolver();
    resolver.extractTypes(src, '/test.java');
    const best = resolver.resolveOverload('foo', ['int']);
    expect(best).not.toBeNull();
    expect(best!.paramTypes).toEqual(['int']);
  });

  it('resolves a widening overload when no exact match exists', () => {
    const resolver = makeResolver();
    resolver.extractTypes(src, '/test.java');
    // 'byte' widens to int/short/long/float/double — int is registered first.
    const best = resolver.resolveOverload('foo', ['byte']);
    expect(best).not.toBeNull();
    expect(best!.paramTypes).toEqual(['int']);
  });

  it('returns null when arity matches no overload', () => {
    const resolver = makeResolver();
    resolver.extractTypes(src, '/test.java');
    expect(resolver.resolveOverload('foo', ['int', 'String'])).toBeNull();
  });
});

// ====================================================================
// Source extraction — classes
// ====================================================================

describe('JavaResolver.extractTypes — classes', () => {
  it('extracts a class with extends, implements, generics, and annotations', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        '@Deprecated',
        'public abstract class Foo<T extends Number> extends Bar<T> implements Baz, Qux<T> {',
        '}',
      ].join('\n'),
      '/test.java',
    );
    expect(types).toHaveLength(1);
    const cls = types[0]!;
    expect(cls.name).toBe('Foo');
    expect(cls.kind).toBe('interface'); // abstract class
    expect(cls.isAbstract).toBe(true);
    expect(cls.isExported).toBe(true);
    expect(cls.baseTypes).toContain('Bar');
    expect(cls.implementedInterfaces).toEqual(['Baz', 'Qux']);
    expect(cls.typeParameters).toContain('T');
    expect(cls.decorators).toContain('@Deprecated');
  });

  it('extracts a class with a non-generic superclass', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('public class Child extends Parent {\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Child');
    expect(types[0]!.baseTypes).toEqual(['Parent']);
  });

  it('extracts a class with a scoped (fully-qualified) superclass', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'public class MyList extends java.util.ArrayList {\n}',
      '/test.java',
    );
    expect(types).toHaveLength(1);
    expect(types[0]!.baseTypes).toEqual(['java.util.ArrayList']);
  });

  it('extracts fields with correct types and modifiers', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'public class Fields {',
        '  private static final int COUNT = 5;',
        '  protected String name;',
        '  public double ratio;',
        '}',
      ].join('\n'),
      '/test.java',
    );
    const members = types[0]!.members;
    expect(members.get('COUNT')!.type).toBe('int');
    expect(members.get('COUNT')!.isStatic).toBe(true);
    expect(members.get('COUNT')!.visibility).toBe('private');
    expect(members.get('name')!.type).toBe('String');
    expect(members.get('name')!.visibility).toBe('protected');
    expect(members.get('ratio')!.type).toBe('double');
    expect(members.get('ratio')!.visibility).toBe('public');
  });

  it('extracts a constructor with void return and parameter types', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'public class Ctor {\n  public Ctor(String name, int age) { }\n}',
      '/test.java',
    );
    const ctor = types[0]!.members.get('Ctor')!;
    expect(ctor.returnType).toBe('void');
    expect(ctor.parameterTypes).toEqual(['String', 'int']);
  });

  it('extracts method return types (including array) and varargs', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'public class Methods {',
        '  public int count() { return 0; }',
        '  public String[] names() { return null; }',
        '  public List<String> items() { return null; }',
        '  public void print(String... args) { }',
        '  public static int staticMethod() { return 1; }',
        '  private void hidden() { }',
        '  protected void guarded() { }',
        '}',
      ].join('\n'),
      '/test.java',
    );
    const members = types[0]!.members;
    expect(members.get('count')!.returnType).toBe('int');
    expect(members.get('names')!.returnType).toBe('String[]');
    expect(members.get('items')!.returnType).toBe('List<String>');
    expect(members.get('print')!.parameterTypes).toEqual(['String...']);
    expect(members.get('print')!.returnType).toBe('void');
    expect(members.get('staticMethod')!.isStatic).toBe(true);
    expect(members.get('hidden')!.visibility).toBe('private');
    expect(members.get('guarded')!.visibility).toBe('protected');
  });
});

// ====================================================================
// Source extraction — interfaces, enums, annotation types
// ====================================================================

describe('JavaResolver.extractTypes — interface/enum/annotation', () => {
  it('extracts an interface with extended interfaces and method signatures', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'public interface Reader extends AutoCloseable, Cloneable {\n  int read(byte[] buf, int off);\n  void close();\n}',
      '/test.java',
    );
    const iface = types[0]!;
    expect(iface.name).toBe('Reader');
    expect(iface.kind).toBe('interface');
    expect(iface.baseTypes).toEqual(['AutoCloseable', 'Cloneable']);
    const read = iface.members.get('read')!;
    expect(read.returnType).toBe('int');
    expect(read.parameterTypes).toEqual(['byte[]', 'int']);
    expect(iface.members.get('close')!.returnType).toBe('void');
  });

  it('extracts an interface with extended generic interfaces', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'public interface SortedSet<T> extends Set<T>, Collection<T> {\n}',
      '/test.java',
    );
    expect(types[0]!.baseTypes).toEqual(['Set', 'Collection']);
  });

  it('extracts decorators on interfaces and enums', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      '@Deprecated\npublic interface Legacy { }\n@Deprecated\npublic enum Old { A }',
      '/test.java',
    );
    expect(types[0]!.decorators).toContain('@Deprecated');
    expect(types[1]!.decorators).toContain('@Deprecated');
  });

  it('extracts a package-private class with no modifiers', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('class Plain {\n  void run() { }\n}', '/test.java');
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Plain');
    expect(types[0]!.isExported).toBe(false);
    expect(types[0]!.decorators).toEqual([]);
  });

  it('extracts an enum with constants as members', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('public enum Color { RED, GREEN, BLUE }', '/test.java');
    const enm = types[0]!;
    expect(enm.name).toBe('Color');
    expect(enm.kind).toBe('enum');
    expect(enm.members.has('RED')).toBe(true);
    expect(enm.members.has('GREEN')).toBe(true);
    expect(enm.members.get('RED')!.type).toBe('enum_constant');
    expect(enm.members.get('RED')!.isStatic).toBe(true);
  });

  it('extracts an annotation type with element types', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      '@interface MyAnn {\n  String value() default "";\n  int retries() default 3;\n}',
      '/test.java',
    );
    const ann = types[0]!;
    expect(ann.name).toBe('MyAnn');
    expect(ann.kind).toBe('interface');
    expect(ann.members.get('value')!.type).toBe('String');
    expect(ann.members.get('retries')!.type).toBe('int');
  });

  it('returns no types for an empty source', () => {
    expect(makeResolver().extractTypes('', '/test.java')).toHaveLength(0);
  });
});

// ====================================================================
// Annotation extraction via source
// ====================================================================

describe('JavaResolver — annotation parsing from source', () => {
  it('extracts marker, single-value, key=value, and qualified annotations', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        '@Override',
        '@SuppressWarnings("unchecked")',
        '@Retention(RetentionPolicy.RUNTIME)',
        '@Target({ElementType.TYPE, ElementType.METHOD})',
        '@MyAnn(name = "value")',
        '@javax.annotation.Nullable',
        'public class Annotated {',
        '  @Deprecated',
        '  public void old() { }',
        '}',
      ].join('\n'),
      '/test.java',
    );
    const cls = types[0]!;
    expect(cls.decorators).toContain('@Override');
    expect(cls.decorators).toContain('@SuppressWarnings');
    expect(cls.decorators).toContain('@Retention');
    expect(cls.decorators).toContain('@Target');
    expect(cls.decorators).toContain('@MyAnn');
    expect(cls.decorators).toContain('@javax.annotation.Nullable');
    // Method-level marker annotation captured in the overload signature.
    const overloads = resolver.resolveOverload('old', []);
    expect(overloads).not.toBeNull();
    expect(overloads!.annotations).toContain('Deprecated');
  });
});
