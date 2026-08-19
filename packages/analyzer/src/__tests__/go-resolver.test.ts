// @code-analyzer/analyzer — Go Resolver Tests
// Comprehensive coverage for struct fields, interface methods, function/method
// extraction, generics, embedded types, and the regex fallback path.

import { describe, it, expect } from 'vitest';
import { GoResolver } from '../resolution/go-resolver.js';
import type { TypeContext } from '../resolution/type-resolver-base.js';

function makeResolver(): GoResolver {
  return new GoResolver();
}

function makeContext(filePath = '/test.go'): TypeContext {
  return { filePath, imports: [] };
}

// ====================================================================
// Struct field extraction
// ====================================================================

describe('GoResolver.extractTypes — struct fields', () => {
  it('extracts field types (string, int, pointer, slice)', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'package main',
        '',
        'type User struct {',
        '  Name  string `json:"name"`',
        '  Age   int',
        '  Email *string',
        '  Tags  []string',
        '}',
      ].join('\n'),
      '/test.go',
    );
    expect(types).toHaveLength(1);
    const members = types[0]!.members;
    expect(members.get('Name')!.type).toBe('string');
    expect(members.get('Name')!.visibility).toBe('public');
    expect(members.get('Age')!.type).toBe('int');
    expect(members.get('Email')!.type).toBe('*string');
    expect(members.get('Tags')!.type).toBe('[]string');
  });

  it('extracts multi-name fields (X, Y int)', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype Point struct {\n  X, Y int\n}',
      '/test.go',
    );
    const members = types[0]!.members;
    expect(members.get('X')!.type).toBe('int');
    expect(members.get('Y')!.type).toBe('int');
  });

  it('extracts embedded types (io.Reader) as members', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype Buffer struct {\n  io.Reader\n  io.Writer\n}',
      '/test.go',
    );
    const members = types[0]!.members;
    expect(members.has('io.Reader')).toBe(true);
    expect(members.get('io.Reader')!.type).toBe('io.Reader');
    expect(members.has('io.Writer')).toBe(true);
  });

  it('extracts unexported (lowercase) fields as private', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype config struct {\n  name string\n}',
      '/test.go',
    );
    expect(types[0]!.isExported).toBe(false);
    expect(types[0]!.members.get('name')!.visibility).toBe('private');
  });
});

// ====================================================================
// Interface method extraction
// ====================================================================

describe('GoResolver.extractTypes — interfaces', () => {
  it('extracts interface method params and results', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'package main',
        '',
        'type Reader interface {',
        '  Read(p []byte) (n int, err error)',
        '  Write(p []byte) error',
        '}',
      ].join('\n'),
      '/test.go',
    );
    expect(types).toHaveLength(1);
    expect(types[0]!.kind).toBe('interface');
    const members = types[0]!.members;
    expect(members.get('Read')!.parameterTypes).toEqual(['[]byte']);
    expect(members.get('Read')!.returnType).toBe('int, error');
    expect(members.get('Write')!.parameterTypes).toEqual(['[]byte']);
    expect(members.get('Write')!.returnType).toBe('error');
  });

  it('extracts a type alias as kind type', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype MyInt int',
      '/test.go',
    );
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('MyInt');
    expect(types[0]!.kind).toBe('type');
  });
});

// ====================================================================
// Function / method extraction
// ====================================================================

describe('GoResolver.extractTypes — functions and methods', () => {
  it('extracts a function with single result', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nfunc Add(x int, y int) int { return x + y }',
      '/test.go',
    );
    expect(types).toHaveLength(1);
    const fn = types[0]!;
    expect(fn.name).toBe('Add');
    expect(fn.kind).toBe('function');
    expect(fn.parameterTypes).toEqual(['int', 'int']);
    expect(fn.returnType).toBe('int');
  });

  it('extracts a function with multiple results', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nfunc Split(s string) (string, error) { return s, nil }',
      '/test.go',
    );
    const fn = types[0]!;
    expect(fn.parameterTypes).toEqual(['string']);
    expect(fn.returnType).toBe('(string, error)');
  });

  it('extracts a function with no result as null', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nfunc noop() { }',
      '/test.go',
    );
    expect(types[0]!.returnType).toBeNull();
  });

  it('extracts a method with receiver, params, and results', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      [
        'package main',
        '',
        'func (u *User) Greet(greeting string) (string, error) {',
        '  return greeting, nil',
        '}',
      ].join('\n'),
      '/test.go',
    );
    const method = types[0]!;
    expect(method.name).toBe('Greet');
    expect(method.kind).toBe('function');
    expect(method.baseTypes).toEqual(['User']);
    expect(method.parameterTypes).toEqual(['string']);
    expect(method.returnType).toBe('(string, error)');
  });

  it('extracts a value-receiver method', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nfunc (p Point) X() int { return 0 }',
      '/test.go',
    );
    expect(types[0]!.baseTypes).toEqual(['Point']);
    expect(types[0]!.returnType).toBe('int');
  });
});

// ====================================================================
// Generic type parameters
// ====================================================================

describe('GoResolver.extractTypes — generics', () => {
  it('extracts generic type params from a struct', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype Pair[T any] struct {\n  First  T\n  Second T\n}',
      '/test.go',
    );
    expect(types[0]!.name).toBe('Pair');
    expect(types[0]!.typeParameters).toEqual(['T']);
    expect(types[0]!.members.get('First')!.type).toBe('T');
  });

  it('extracts generic type params from a function', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nfunc Identity[T any](v T) T { return v }',
      '/test.go',
    );
    expect(types[0]!.name).toBe('Identity');
    expect(types[0]!.typeParameters).toEqual(['T']);
  });
});

// ====================================================================
// Embedded interfaces
// ====================================================================

describe('GoResolver.extractTypes — embedded interfaces', () => {
  it('registers embedded interfaces in the interface cache', () => {
    const resolver = makeResolver();
    resolver.extractTypes(
      [
        'package main',
        '',
        'type ReadWriter interface {',
        '  io.Reader',
        '  io.Writer',
        '}',
      ].join('\n'),
      '/test.go',
    );
    const cache = (resolver as unknown as { interfaceCache: Map<string, { embeddedInterfaces: string[] }> })
      .interfaceCache;
    expect(cache.has('ReadWriter')).toBe(true);
    expect(cache.get('ReadWriter')!.embeddedInterfaces).toEqual(['io.Reader', 'io.Writer']);
  });
});

// ====================================================================
// Interface satisfaction (integration)
// ====================================================================

describe('GoResolver — interface satisfaction integration', () => {
  it('finds a struct satisfying an interface via the cache', () => {
    const resolver = makeResolver();
    resolver.extractTypes(
      'package main\n\ntype Reader interface {\n  Read(p []byte) (int, error)\n}',
      '/test.go',
    );
    const structMethods = new Map<string, { name: string; params: { name: string; type: string }[]; results: { name: string; type: string }[] }>([
      ['Read', {
        name: 'Read',
        params: [{ name: 'p', type: '[]byte' }],
        results: [{ name: 'n', type: 'int' }, { name: 'err', type: 'error' }],
      }],
    ]);
    const satisfied = (resolver as unknown as {
      findSatisfiedInterfaces: (m: typeof structMethods) => string[];
    }).findSatisfiedInterfaces(structMethods);
    expect(satisfied).toContain('Reader');
  });
});

// ====================================================================
// Edge cases
// ====================================================================

describe('GoResolver — edge cases', () => {
  it('returns the cached instance on a second resolve', async () => {
    const resolver = makeResolver();
    const a = await resolver.resolveType('int64', makeContext());
    const b = await resolver.resolveType('int64', makeContext());
    expect(a).toBe(b);
  });

  it('resolves a slice of a non-primitive element type', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType('[]Foo', makeContext());
    expect(result).not.toBeNull();
    expect(result!.genericArgs![0]!.kind).toBe('unknown');
    expect(result!.genericArgs![0]!.name).toBe('Foo');
  });

  it('extracts an explicitly-empty result list as null', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('package main\n\nfunc f() () { }', '/test.go');
    expect(types[0]!.returnType).toBeNull();
  });

  it('extracts a parenthesized single result', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('package main\n\nfunc f() (int) { return 0 }', '/test.go');
    expect(types[0]!.returnType).toBe('int');
  });

  it('treats an interface{} parameter as compatible with a concrete type', () => {
    const resolver = makeResolver() as unknown as {
      typesCompatible: (a: string, b: string) => boolean;
    };
    expect(resolver.typesCompatible('Foo', 'interface{}')).toBe(true);
  });

  it('treats unrelated non-interface types as incompatible', () => {
    const resolver = makeResolver() as unknown as {
      typesCompatible: (a: string, b: string) => boolean;
    };
    expect(resolver.typesCompatible('Foo', 'Bar')).toBe(false);
  });

  it('detects a param type mismatch as unsatisfied', () => {
    const resolver = makeResolver();
    const satisfied = (resolver as unknown as {
      checkInterfaceSatisfaction: (
        s: string,
        m: Map<string, { params: { type: string }[]; results: { type: string }[] }>,
        i: string,
        info: { methods: Map<string, { params: { type: string }[]; results: { type: string }[] }> },
      ) => boolean;
    }).checkInterfaceSatisfaction(
      'X',
      new Map([['M', { params: [{ type: 'int' }], results: [] }]]),
      'I',
      { methods: new Map([['M', { params: [{ type: 'string' }], results: [] }]]) },
    );
    expect(satisfied).toBe(false);
  });

  it('detects a result count mismatch as unsatisfied', () => {
    const resolver = makeResolver();
    const satisfied = (resolver as unknown as {
      checkInterfaceSatisfaction: (
        s: string,
        m: Map<string, { params: { type: string }[]; results: { type: string }[] }>,
        i: string,
        info: { methods: Map<string, { params: { type: string }[]; results: { type: string }[] }> },
      ) => boolean;
    }).checkInterfaceSatisfaction(
      'X',
      new Map([['M', { params: [], results: [{ type: 'int' }] }]]),
      'I',
      { methods: new Map([['M', { params: [], results: [] }]]) },
    );
    expect(satisfied).toBe(false);
  });

  it('detects a result type mismatch as unsatisfied', () => {
    const resolver = makeResolver();
    const satisfied = (resolver as unknown as {
      checkInterfaceSatisfaction: (
        s: string,
        m: Map<string, { params: { type: string }[]; results: { type: string }[] }>,
        i: string,
        info: { methods: Map<string, { params: { type: string }[]; results: { type: string }[] }> },
      ) => boolean;
    }).checkInterfaceSatisfaction(
      'X',
      new Map([['M', { params: [], results: [{ type: 'int' }] }]]),
      'I',
      { methods: new Map([['M', { params: [], results: [{ type: 'string' }] }]]) },
    );
    expect(satisfied).toBe(false);
  });

  it('accepts a result type that is compatibly assignable (any vs int)', () => {
    const resolver = makeResolver();
    const satisfied = (resolver as unknown as {
      checkInterfaceSatisfaction: (
        s: string,
        m: Map<string, { params: { type: string }[]; results: { type: string }[] }>,
        i: string,
        info: { methods: Map<string, { params: { type: string }[]; results: { type: string }[] }> },
      ) => boolean;
    }).checkInterfaceSatisfaction(
      'X',
      new Map([['M', { params: [], results: [{ type: 'any' }] }]]),
      'I',
      { methods: new Map([['M', { params: [], results: [{ type: 'int' }] }]]) },
    );
    expect(satisfied).toBe(true);
  });

  it('extracts an interface method with no result as void', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype I interface {\n  M(p int)\n}',
      '/test.go',
    );
    expect(types[0]!.members.get('M')!.returnType).toBe('void');
  });

  it('extracts an interface method with an empty result list', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype I interface {\n  M() ()\n}',
      '/test.go',
    );
    expect(types[0]!.members.get('M')!.returnType).toBe('void');
  });

  it('falls through when the external resolver returns null', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType(
      'ExternalThing',
      { filePath: '/test.go', imports: [], resolveExternal: () => null },
    );
    expect(result).toBeNull();
  });

  it('parses a struct tag with a value starting with "="', () => {
    const resolver = makeResolver();
    const tags = resolver.parseStructTags('`json:"=value"`');
    expect(tags).toHaveLength(1);
    expect(tags[0]!.key).toBe('json');
    expect(tags[0]!.fieldName).toBeUndefined();
    expect(tags[0]!.options).toEqual(['=value']);
  });

  it('resolves a func type with an empty result list', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType('func(a int) ()', makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('function');
    expect(result!.returnType!.name).toBe('void');
  });

  it('resolves a func type with unnamed params', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType('func(int, string) bool', makeContext());
    expect(result).not.toBeNull();
    expect(result!.parameterTypes).toHaveLength(2);
    expect(result!.parameterTypes![0]!.name).toBe('int');
  });

  it('skips package-level var and const declarations', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\nvar Global = 1\nconst Limit = 10\n\ntype T struct {}\n',
      '/test.go',
    );
    // Only the struct type is extracted; var/const are skipped.
    expect(types.map((t) => t.name)).toEqual(['T']);
  });

  it('extracts an interface method with no params', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'package main\n\ntype Empty interface {\n  Close() error\n}',
      '/test.go',
    );
    const close = types[0]!.members.get('Close')!;
    expect(close.parameterTypes).toEqual([]);
    expect(close.returnType).toBe('error');
  });

  it('excludes a struct that does not satisfy the cached interface', () => {
    const resolver = makeResolver();
    resolver.extractTypes(
      'package main\n\ntype Reader interface {\n  Read() int\n}',
      '/test.go',
    );
    const satisfied = (resolver as unknown as {
      findSatisfiedInterfaces: (m: Map<string, unknown>) => string[];
    }).findSatisfiedInterfaces(new Map());
    expect(satisfied).toEqual([]);
  });
});

// ====================================================================
// Fallback extraction (injected grammar loader)
// ====================================================================

describe('GoResolver — fallback extraction (grammar unavailable)', () => {
  const makeFallback = (): GoResolver => new GoResolver(() => null);

  it('extracts structs via regex', () => {
    const types = makeFallback().extractTypes(
      'package main\n\ntype User struct {\n  Name string\n}',
      '/test.go',
    );
    const user = types.find((t) => t.name === 'User');
    expect(user).toBeDefined();
    expect(user!.kind).toBe('class');
  });

  it('extracts interfaces via regex', () => {
    const types = makeFallback().extractTypes(
      'type Reader interface {\n  Read() int\n}',
      '/test.go',
    );
    const iface = types.find((t) => t.name === 'Reader');
    expect(iface).toBeDefined();
    expect(iface!.kind).toBe('interface');
  });

  it('extracts functions (including methods with receiver) via regex', () => {
    const types = makeFallback().extractTypes(
      'func (u *User) GetName() string { return "" }\nfunc main() {}',
      '/test.go',
    );
    const names = types.map((t) => t.name);
    expect(names).toContain('GetName');
    expect(names).toContain('main');
  });

  it('extracts generic type params via regex', () => {
    const types = makeFallback().extractTypes(
      'type Pair[T, U] struct {\n  A T\n}',
      '/test.go',
    );
    const pair = types.find((t) => t.name === 'Pair');
    expect(pair).toBeDefined();
    expect(pair!.typeParameters).toEqual(['T', 'U']);
  });
});
