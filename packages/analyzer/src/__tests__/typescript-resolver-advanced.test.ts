// @code-analyzer/analyzer — TypeScript Advanced Resolver Tests
// Covers the remaining generic utility handlers, indexed access types, and
// the AST extraction path (classes/interfaces/type aliases/enums/functions).

import { describe, it, expect } from 'vitest';
import { TypeScriptAdvancedResolver } from '../resolution/typescript-resolver-advanced.js';
import type { TypeContext } from '../resolution/type-resolver-base.js';

function makeResolver(): TypeScriptAdvancedResolver {
  return new TypeScriptAdvancedResolver();
}

function makeContext(filePath = '/test.ts'): TypeContext {
  return { filePath, imports: [] };
}

// ====================================================================
// Generic utility handlers
// ====================================================================

describe('TypeScriptAdvancedResolver — generic utility types', () => {
  it.each([
    ['Required', 'Required<User>'],
    ['Readonly', 'Readonly<User>'],
    ['Pick', "Pick<User, 'a'>"],
    ['Omit', "Omit<User, 'a'>"],
  ])('resolves %s<T> as a generic type', async (base, typeName) => {
    const result = await makeResolver().resolveType(typeName, makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toContain(base);
  });

  it('resolves Exclude<A, B> as a union type', async () => {
    const result = await makeResolver().resolveType('Exclude<A, B>', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('resolves Extract<A, B> as an intersection type', async () => {
    const result = await makeResolver().resolveType('Extract<A, B>', makeContext());
    expect(result!.kind).toBe('intersection');
  });

  it.each(['ReturnType', 'Parameters', 'InstanceType'])(
    'resolves %s<T> as an unknown type',
    async (base) => {
      const result = await makeResolver().resolveType(`${base}<typeof fn>`, makeContext());
      expect(result!.kind).toBe('unknown');
    },
  );

  it('resolves Awaited<T> wrapping the inner type', async () => {
    const result = await makeResolver().resolveType('Awaited<Promise<User>>', makeContext());
    expect(result!.kind).toBe('unknown');
    expect(result!.name).toBe('Awaited<Promise<User>>');
  });

  it('falls through to a generic type when arity mismatches a known handler', async () => {
    // Array<A, B> does not match the single-arg handler → general generic.
    const result = await makeResolver().resolveType('Array<string, number>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Array<string, number>');
  });

  it.each([
    ['ReadonlyArray', 'ReadonlyArray<A, B>'],
    ['Map', 'Map<A>'],
    ['Set', 'Set<A, B>'],
    ['Promise', 'Promise<A, B>'],
    ['Partial', 'Partial<A, B>'],
    ['Required', 'Required<A, B>'],
    ['Readonly', 'Readonly<A, B>'],
    ['Pick', 'Pick<A>'],
    ['Omit', 'Omit<A>'],
    ['Record', 'Record<A>'],
    ['Exclude', 'Exclude<A>'],
    ['Extract', 'Extract<A>'],
    ['NonNullable', 'NonNullable<A, B>'],
    ['ReturnType', 'ReturnType<A, B>'],
    ['Parameters', 'Parameters<A, B>'],
    ['InstanceType', 'InstanceType<A, B>'],
    ['Awaited', 'Awaited<A, B>'],
  ])('falls through to generic when %s has wrong arity', async (base, typeName) => {
    const result = await makeResolver().resolveType(typeName, makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toContain(base);
  });

  it('resolves a user-defined generic without a known handler', async () => {
    const result = await makeResolver().resolveType('Foo<Bar>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Foo<Bar>');
  });

  it('resolves an arrow function type with untyped params', async () => {
    const result = await makeResolver().resolveType('(a, b) => boolean', makeContext());
    expect(result!.kind).toBe('function');
    expect(result!.parameterTypes).toHaveLength(2);
  });

  it('returns the cached instance on a second resolve', async () => {
    const resolver = makeResolver();
    const a = await resolver.resolveType('Array<string>', makeContext());
    const b = await resolver.resolveType('Array<string>', makeContext());
    expect(a).toBe(b);
  });

  it('delegates to the external resolver when a match is found', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType('ExternalThing', {
      filePath: '/test.ts',
      imports: [],
      resolveExternal: () => ({ name: 'External', kind: 'object' }),
    });
    expect(result!.name).toBe('External');
  });

  it('returns null when the external resolver has no match', async () => {
    const resolver = makeResolver();
    const result = await resolver.resolveType('ExternalThing', {
      filePath: '/test.ts',
      imports: [],
      resolveExternal: () => null,
    });
    expect(result).toBeNull();
  });
});

// ====================================================================
// Indexed access types
// ====================================================================

describe('TypeScriptAdvancedResolver — indexed access types', () => {
  it('resolves T[K]', async () => {
    const result = await makeResolver().resolveType('User["name"]', makeContext());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('User["name"]');
  });

  it('resolves T["quoted"] with single quotes', async () => {
    const result = await makeResolver().resolveType("User['id']", makeContext());
    expect(result!.name).toBe('User["id"]');
  });

  it('returns null for a non-indexed access type', async () => {
    const result = await makeResolver().resolveType('JustAWord', makeContext());
    expect(result).toBeNull();
  });
});

// ====================================================================
// AST extraction — classes
// ====================================================================

describe('TypeScriptAdvancedResolver.extractTypes — classes', () => {
  it('extracts a class with heritage, generics, decorators, and members', () => {
    const resolver = makeResolver();
    const src = [
      '@Component({})',
      'export abstract class Foo<T extends string> extends Base<T> implements Bar, Baz {',
      '  private count: number = 0;',
      '  public name: string;',
      '  static id: number;',
      '  async fetch(x: string): Promise<number> { return 1; }',
      '  abstract compute(): void;',
      '}',
    ].join('\n');
    const types = resolver.extractTypes(src, '/test.ts');
    const cls = types.find((t) => t.name === 'Foo')!;
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.isAbstract).toBe(true);
    expect(cls.isExported).toBe(true);
    expect(cls.baseTypes).toEqual(['Base']);
    expect(cls.implementedInterfaces).toEqual(['Bar', 'Baz']);
    expect(cls.typeParameters).toEqual(['T']);
    expect(cls.decorators).toContain('@Component({})');

    const members = cls.members;
    expect(members.get('count')!.type).toBe('number');
    expect(members.get('count')!.visibility).toBe('private');
    expect(members.get('name')!.type).toBe('string');
    expect(members.get('name')!.visibility).toBe('public');
    expect(members.get('id')!.type).toBe('number');
    expect(members.get('id')!.isStatic).toBe(true);
    expect(members.get('fetch')!.parameterTypes).toEqual(['string']);
    expect(members.get('fetch')!.returnType).toBe('Promise<number>');
    expect(members.get('fetch')!.isAsync).toBe(true);
    expect(members.get('compute')!.returnType).toBe('void');
  });

  it('extracts a non-exported class as not exported', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('class Plain {\n  x: number;\n}', '/test.ts');
    expect(types[0]!.name).toBe('Plain');
    expect(types[0]!.isExported).toBe(false);
  });

  it('extracts a method without a return type annotation as void', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('class C {\n  work() { return 1; }\n}', '/test.ts');
    expect(types[0]!.members.get('work')!.returnType).toBe('void');
  });

  it('extracts a field without a type annotation as any', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('class C {\n  x;\n}', '/test.ts');
    expect(types[0]!.members.get('x')!.type).toBe('any');
  });

  it('extracts a function with an untyped parameter as any', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function f(a) { return a; }', '/test.ts');
    expect(types[0]!.parameterTypes).toEqual(['any']);
  });

  it('extracts a protected field with protected visibility', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('class C {\n  protected secret: boolean;\n}', '/test.ts');
    expect(types[0]!.members.get('secret')!.visibility).toBe('protected');
  });
});

// ====================================================================
// AST extraction — interfaces, aliases, enums, functions
// ====================================================================

describe('TypeScriptAdvancedResolver.extractTypes — interface/alias/enum/function', () => {
  it('extracts an interface with extends and member signatures', () => {
    const resolver = makeResolver();
    const src = [
      'export interface Reader<T> extends AutoCloseable {',
      '  read(p: string): number;',
      '  readonly value: string;',
      '}',
    ].join('\n');
    const types = resolver.extractTypes(src, '/test.ts');
    const iface = types.find((t) => t.name === 'Reader')!;
    expect(iface.kind).toBe('interface');
    expect(iface.baseTypes).toEqual(['AutoCloseable']);
    expect(iface.typeParameters).toEqual(['T']);
    expect(iface.members.get('read')!.returnType).toBe('number');
    expect(iface.members.get('value')!.returnType).toBe('string');
  });

  it('extracts a type alias with type params', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('export type Alias<T> = T | null;', '/test.ts');
    const alias = types.find((t) => t.name === 'Alias')!;
    expect(alias.kind).toBe('type');
    expect(alias.typeParameters).toEqual(['T']);
  });

  it('extracts an enum with constant members', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('export enum Color { Red, Green }', '/test.ts');
    const enm = types.find((t) => t.name === 'Color')!;
    expect(enm.kind).toBe('enum');
    expect(enm.members.has('Red')).toBe(true);
    expect(enm.members.has('Green')).toBe(true);
  });

  it('extracts an exported function with return and param types', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'export function greet(name: string): string { return name; }',
      '/test.ts',
    );
    const fn = types.find((t) => t.name === 'greet')!;
    expect(fn.kind).toBe('function');
    expect(fn.isExported).toBe(true);
    expect(fn.parameterTypes).toEqual(['string']);
    expect(fn.returnType).toBe('string');
  });

  it('extracts a function with no return type annotation as null', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function noop(x: number) { return x; }', '/test.ts');
    expect(types[0]!.returnType).toBeNull();
  });
});

// ====================================================================
// Fallback extraction (injected grammar loader)
// ====================================================================

describe('TypeScriptAdvancedResolver — fallback extraction', () => {
  const makeFallback = (): TypeScriptAdvancedResolver => new TypeScriptAdvancedResolver(() => null);

  it('extracts classes via regex', () => {
    const types = makeFallback().extractTypes(
      'export abstract class Foo<T> extends Bar implements Baz, Qux {\n}',
      '/test.ts',
    );
    const cls = types.find((t) => t.name === 'Foo')!;
    expect(cls.kind).toBe('class');
    expect(cls.baseTypes).toEqual(['Bar']);
    expect(cls.implementedInterfaces).toEqual(['Baz', 'Qux']);
    expect(cls.isAbstract).toBe(true);
  });

  it('extracts interfaces and type aliases via regex', () => {
    const types = makeFallback().extractTypes(
      'export interface Reader extends AutoCloseable {\n}\nexport type Alias = string;',
      '/test.ts',
    );
    const names = types.map((t) => t.name);
    expect(names).toContain('Reader');
    expect(names).toContain('Alias');
  });

  it('extracts a class and interface without heritage via regex', () => {
    const types = makeFallback().extractTypes(
      'class Simple {\n}\ninterface Plain {\n}',
      '/test.ts',
    );
    const cls = types.find((t) => t.name === 'Simple')!;
    expect(cls.baseTypes).toEqual([]);
    expect(cls.implementedInterfaces).toEqual([]);
    const iface = types.find((t) => t.name === 'Plain')!;
    expect(iface.baseTypes).toEqual([]);
  });
});
