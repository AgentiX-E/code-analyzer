// @code-analyzer/analyzer — TypeScript Advanced Resolver Tests
// Covers the generic utility handlers, indexed access types, union /
// intersection / conditional / mapped / template-literal / function types,
// and the AST extraction path (classes/interfaces/type aliases/enums/functions).

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

  it('resolves Array<T> with length/index members', async () => {
    const result = await makeResolver().resolveType('Array<string>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Array<string>');
    expect(result!.members!.length.name).toBe('number');
    expect(result!.members!['[index]'].kind).toBe('primitive');
  });

  it('resolves ReadonlyArray<T> with length/index members', async () => {
    const result = await makeResolver().resolveType('ReadonlyArray<string>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('ReadonlyArray<string>');
    expect(result!.members!.length.name).toBe('number');
  });

  it('resolves Map<K, V> with get/set/size members', async () => {
    const result = await makeResolver().resolveType('Map<string, number>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Map<string, number>');
    expect(result!.members!.size.name).toBe('number');
    expect(result!.members!.get.kind).toBe('function');
    expect(result!.members!.set.kind).toBe('function');
  });

  it('resolves Set<T> with add/size members', async () => {
    const result = await makeResolver().resolveType('Set<string>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Set<string>');
    expect(result!.members!.add.kind).toBe('function');
  });

  it('resolves Promise<T> with then/catch members', async () => {
    const result = await makeResolver().resolveType('Promise<string>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Promise<string>');
    expect(result!.members!.then.kind).toBe('function');
  });

  it('resolves Partial<T> as a generic type', async () => {
    const result = await makeResolver().resolveType('Partial<User>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Partial<User>');
  });

  it('resolves Record<K, V> as a generic type', async () => {
    const result = await makeResolver().resolveType('Record<string, number>', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.name).toBe('Record<string, number>');
  });

  it('resolves NonNullable<T> as non-nullable', async () => {
    const result = await makeResolver().resolveType('NonNullable<string>', makeContext());
    expect(result!.kind).toBe('primitive');
    expect(result!.isNullable).toBe(false);
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

  it('resolves a primitive type name directly', async () => {
    const result = await makeResolver().resolveType('string', makeContext());
    expect(result!.kind).toBe('primitive');
    expect(result!.name).toBe('string');
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

  it('exposes all cached types via getAllTypes', async () => {
    const resolver = makeResolver();
    await resolver.resolveType('Array<string>', makeContext());
    const all = resolver.getAllTypes();
    expect(all.has('Array<string>')).toBe(true);
    expect(all.get('Array<string>')!.kind).toBe('generic');
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
// Union / intersection / conditional / mapped / template-literal types
// ====================================================================

describe('TypeScriptAdvancedResolver — structural types', () => {
  it('resolves a union type', async () => {
    const result = await makeResolver().resolveType('A | B', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('resolves a three-way union type', async () => {
    const result = await makeResolver().resolveType('A | B | C', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(3);
  });

  it('skips empty segments in a malformed union (double pipe)', async () => {
    const result = await makeResolver().resolveType('A || B', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('skips a trailing empty segment in a malformed union', async () => {
    const result = await makeResolver().resolveType('A | B |', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('does not split a pipe nested inside angle brackets', async () => {
    const result = await makeResolver().resolveType('A<B | C> | D', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
    expect(result!.genericArgs![0]!.name).toBe('A<B|C>');
  });

  it('resolves a union whose left operand is a generic type', async () => {
    const result = await makeResolver().resolveType('Map<string, number> | null', makeContext());
    expect(result!.kind).toBe('union');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('resolves an intersection type', async () => {
    const result = await makeResolver().resolveType('A & B', makeContext());
    expect(result!.kind).toBe('intersection');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('skips empty segments in a malformed intersection (double ampersand)', async () => {
    const result = await makeResolver().resolveType('A && B', makeContext());
    expect(result!.kind).toBe('intersection');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('skips a trailing empty segment in a malformed intersection', async () => {
    const result = await makeResolver().resolveType('A & B &', makeContext());
    expect(result!.kind).toBe('intersection');
    expect(result!.genericArgs).toHaveLength(2);
  });

  it('resolves a conditional type', async () => {
    const result = await makeResolver().resolveType('T extends U ? X : Y', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.documentation).toContain('Conditional type');
  });

  it('resolves a mapped type', async () => {
    const result = await makeResolver().resolveType('{ [K in keyof T]: V }', makeContext());
    expect(result!.kind).toBe('generic');
    expect(result!.documentation).toContain('Mapped type');
  });

  it('resolves a readonly optional mapped type', async () => {
    const result = await makeResolver().resolveType(
      '{ readonly [K in keyof T]?: V }',
      makeContext(),
    );
    expect(result!.kind).toBe('generic');
  });

  it('resolves a template literal type', async () => {
    const tpl = '\u0060${prefix}${string}\u0060';
    const result = await makeResolver().resolveType(tpl, makeContext());
    expect(result!.kind).toBe('primitive');
    expect(result!.name).toBe(tpl);
  });

  it('resolves an arrow function type with typed params', async () => {
    const result = await makeResolver().resolveType(
      '(a: string, b: number) => boolean',
      makeContext(),
    );
    expect(result!.kind).toBe('function');
    expect(result!.parameterTypes).toHaveLength(2);
    expect(result!.parameterTypes![0]!.name).toBe('string');
    expect(result!.returnType!.name).toBe('boolean');
  });

  it('resolves an arrow function type with no params', async () => {
    const result = await makeResolver().resolveType('() => void', makeContext());
    expect(result!.kind).toBe('function');
    expect(result!.parameterTypes).toHaveLength(0);
    expect(result!.returnType!.name).toBe('void');
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

  it('resolves a namespaced base type with dots', async () => {
    const result = await makeResolver().resolveType('ns.User["name"]', makeContext());
    expect(result!.name).toBe('ns.User["name"]');
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

  it('skips computed member names without a property identifier', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes(
      'class C {\n  [Symbol.iterator]() {}\n  normal() {}\n}',
      '/test.ts',
    );
    const members = types[0]!.members;
    expect(members.has('[Symbol.iterator]')).toBe(false);
    expect(members.has('normal')).toBe(true);
  });

  it('extracts a decorated but non-exported class', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('@Component({}) class C {}', '/test.ts');
    expect(types[0]!.name).toBe('C');
    expect(types[0]!.decorators).toContain('@Component({})');
    expect(types[0]!.isExported).toBe(false);
  });

  it('does not extract an anonymous default-exported class', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('export default class {}', '/test.ts');
    expect(types).toHaveLength(0);
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

  it('extracts an empty enum with no members', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('export enum E {}', '/test.ts');
    expect(types[0]!.kind).toBe('enum');
    expect(types[0]!.members.size).toBe(0);
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

  it('marks a non-exported function as not exported', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function f() {}', '/test.ts');
    expect(types[0]!.isExported).toBe(false);
  });

  it('marks an async top-level function as async', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('async function fetch(): Promise<void> {}', '/test.ts');
    const fn = types.find((t) => t.name === 'fetch')!;
    expect(fn.kind).toBe('function');
    expect(fn.isAsync).toBe(true);
    expect(fn.returnType).toBe('Promise<void>');
  });

  it('extracts a generator function declaration', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function* gen(): number { yield 1; }', '/test.ts');
    const gen = types.find((t) => t.name === 'gen')!;
    expect(gen.kind).toBe('function');
    expect(gen.returnType).toBe('number');
  });

  it('extracts an exported generator function declaration', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('export function* gen() {}', '/test.ts');
    const gen = types.find((t) => t.name === 'gen')!;
    expect(gen.kind).toBe('function');
    expect(gen.isExported).toBe(true);
  });

  it('skips nested function declarations', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function outer() { function inner() {} }', '/test.ts');
    expect(types.map((t) => t.name)).toEqual(['outer']);
  });

  it('extracts optional and rest parameter types', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('function f(a?: string, ...rest: number[]) {}', '/test.ts');
    expect(types[0]!.parameterTypes).toEqual(['string', 'number[]']);
  });

  it('skips an interface call signature without a name', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('interface I { (): void; read(): void; }', '/test.ts');
    const iface = types[0]!;
    expect(iface.members.has('read')).toBe(true);
    expect(iface.members.size).toBe(1);
  });

  it('defaults an interface member without a return annotation to void', () => {
    const resolver = makeResolver();
    const types = resolver.extractTypes('interface I { read(); }', '/test.ts');
    expect(types[0]!.members.get('read')!.returnType).toBe('void');
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
