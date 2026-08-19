import { describe, it, expect } from 'vitest';
import { TypeScriptTypeResolver } from '../resolution/typescript-resolver.js';

const makeResolver = () => new TypeScriptTypeResolver();
// Inject a loader that returns null to force the regex fallback path.
const makeFallbackResolver = () => new TypeScriptTypeResolver(() => null);

describe('TypeScriptTypeResolver — extraction (tree-sitter)', () => {
  it('extracts a method return type annotation', () => {
    const types = makeResolver().extractTypes(
      "class C {\n  m(): string { return ''; }\n}",
      '/test.ts',
    );
    const m = types[0]!.members.get('m')!;
    expect(m.returnType).toBe('string');
    expect(m.type).toBe('() => string');
  });

  it('extracts a method without a return annotation as void', () => {
    const types = makeResolver().extractTypes('class C {\n  work() { return 1; }\n}', '/test.ts');
    const work = types[0]!.members.get('work')!;
    expect(work.returnType).toBe('void');
  });

  it('extracts a class field type (public_field_definition)', () => {
    const types = makeResolver().extractTypes('class C {\n  count: number = 0;\n}', '/test.ts');
    const count = types[0]!.members.get('count')!;
    expect(count.returnType).toBe('number');
    expect(count.type).toBe('number');
  });

  it('extracts private/protected/public visibility via accessibility_modifier', () => {
    const types = makeResolver().extractTypes(
      [
        'class C {',
        '  private a(): void {}',
        '  protected b(): void {}',
        '  public c(): void {}',
        '  plain(): void {}',
        '}',
      ].join('\n'),
      '/test.ts',
    );
    const members = types[0]!.members;
    expect(members.get('a')!.visibility).toBe('private');
    expect(members.get('b')!.visibility).toBe('protected');
    expect(members.get('c')!.visibility).toBe('public');
    expect(members.get('plain')!.visibility).toBe('public');
  });

  it('detects async methods via the async modifier token', () => {
    const types = makeResolver().extractTypes(
      'class C {\n  async fetch(): Promise<void> {}\n}',
      '/test.ts',
    );
    expect(types[0]!.members.get('fetch')!.isAsync).toBe(true);
  });

  it('extracts interface extends base types', () => {
    const types = makeResolver().extractTypes(
      'interface Reader extends AutoCloseable, Other {\n}',
      '/test.ts',
    );
    expect(types[0]!.baseTypes).toEqual(['AutoCloseable', 'Other']);
  });

  it('extracts an interface method signature return type', () => {
    const types = makeResolver().extractTypes(
      'interface Reader {\n  read(p: string): number;\n}',
      '/test.ts',
    );
    const read = types[0]!.members.get('read')!;
    expect(read.returnType).toBe('number');
    expect(read.type).toBe('(string) => number');
  });

  it('extracts an interface property signature type', () => {
    const types = makeResolver().extractTypes(
      'interface Config {\n  value: string;\n}',
      '/test.ts',
    );
    const value = types[0]!.members.get('value')!;
    expect(value.returnType).toBe('string');
    expect(value.type).toBe('string');
  });

  it('extracts a function return type', () => {
    const types = makeResolver().extractTypes('function f(): number { return 1; }', '/test.ts');
    expect(types[0]!.returnType).toBe('number');
  });

  it('extracts a const variable with a type annotation as a variable with returnType', () => {
    const types = makeResolver().extractTypes('const total: number = 42;', '/test.ts');
    const v = types.find((t) => t.name === 'total')!;
    expect(v.kind).toBe('variable');
    expect(v.returnType).toBe('number');
  });

  it('extracts class decorators', () => {
    const types = makeResolver().extractTypes('@Component({})\nclass Foo {}\n', '/test.ts');
    expect(types[0]!.decorators).toContain('@Component({})');
  });

  it('extracts a non-exported class as not exported', () => {
    const types = makeResolver().extractTypes('class Plain {}\n', '/test.ts');
    expect(types[0]!.isExported).toBe(false);
  });

  it('extracts an abstract method signature return type', () => {
    const types = makeResolver().extractTypes(
      'abstract class C {\n  abstract m(): void;\n}',
      '/test.ts',
    );
    expect(types[0]!.members.get('m')!.returnType).toBe('void');
  });

  it('qualifies a nested class inside a method with its enclosing class', () => {
    const types = makeResolver().extractTypes(
      ['class Outer {', '  method() {', '    class Inner {}', '  }', '}'].join('\n'),
      '/test.ts',
    );
    const inner = types.find((t) => t.name === 'Inner')!;
    expect(inner.qualifiedName).toBe('Outer.Inner');
  });

  it('qualifies a doubly-nested class with the full enclosing chain', () => {
    const types = makeResolver().extractTypes(
      [
        'class A {',
        '  m1() {',
        '    class B {',
        '      m2() {',
        '        class C {}',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n'),
      '/test.ts',
    );
    const c = types.find((t) => t.name === 'C')!;
    expect(c.qualifiedName).toBe('A.B.C');
  });

  it('extracts a function with an untyped parameter as any', () => {
    const types = makeResolver().extractTypes('function f(x) { return x; }', '/test.ts');
    expect(types[0]!.parameterTypes).toEqual(['any']);
  });

  it('extracts a method with an untyped parameter as any', () => {
    const types = makeResolver().extractTypes('class C {\n  m(x) { return x; }\n}', '/test.ts');
    expect(types[0]!.members.get('m')!.parameterTypes).toEqual(['any']);
  });

  it('extracts a non-const (let) variable with a null returnType', () => {
    const types = makeResolver().extractTypes('let x: number = 1;', '/test.ts');
    const v = types.find((t) => t.name === 'x')!;
    expect(v.kind).toBe('variable');
    expect(v.returnType).toBeNull();
  });

  it('qualifies interface/type/enum inside a namespace', () => {
    const types = makeResolver().extractTypes(
      [
        'namespace N {',
        '  export interface I { x: number; }',
        '  export type T = string;',
        '  export enum E { A }',
        '}',
      ].join('\n'),
      '/test.ts',
    );
    const iface = types.find((t) => t.name === 'I')!;
    const alias = types.find((t) => t.name === 'T')!;
    const en = types.find((t) => t.name === 'E')!;
    expect(iface.qualifiedName).toBe('N.I');
    expect(alias.qualifiedName).toBe('N.T');
    expect(en.qualifiedName).toBe('N.E');
  });

  it('qualifies a variable inside a namespace', () => {
    const types = makeResolver().extractTypes(
      'namespace N {\n  const x: number = 1;\n}',
      '/test.ts',
    );
    const v = types.find((t) => t.name === 'x')!;
    expect(v.qualifiedName).toBe('N.x');
  });

  it('extracts an interface method with an untyped parameter as any', () => {
    const types = makeResolver().extractTypes('interface I {\n  m(x): void;\n}', '/test.ts');
    expect(types[0]!.members.get('m')!.parameterTypes).toEqual(['any']);
  });

  it('extracts an interface method without a return annotation as void', () => {
    const types = makeResolver().extractTypes('interface I {\n  m();\n}', '/test.ts');
    expect(types[0]!.members.get('m')!.returnType).toBe('void');
  });

  it('extracts an interface property without a type annotation as any', () => {
    const types = makeResolver().extractTypes('interface I {\n  x;\n}', '/test.ts');
    expect(types[0]!.members.get('x')!.returnType).toBe('any');
  });
});

describe('TypeScriptTypeResolver — fallback (regex)', () => {
  it('extracts a class with extends and implements', () => {
    const types = makeFallbackResolver().extractTypes(
      'export abstract class Admin extends User implements IAdmin, IUser {\n}',
      '/test.ts',
    );
    const admin = types.find((t) => t.name === 'Admin')!;
    expect(admin.kind).toBe('class');
    expect(admin.isAbstract).toBe(true);
    expect(admin.isExported).toBe(true);
    expect(admin.baseTypes).toEqual(['User']);
    expect(admin.implementedInterfaces).toEqual(['IAdmin', 'IUser']);
  });

  it('extracts a plain class with no heritage', () => {
    const types = makeFallbackResolver().extractTypes('class Plain {\n}', '/test.ts');
    const plain = types.find((t) => t.name === 'Plain')!;
    expect(plain.baseTypes).toEqual([]);
    expect(plain.implementedInterfaces).toEqual([]);
    expect(plain.isAbstract).toBe(false);
  });

  it('extracts a generic class extending a generic base', () => {
    const types = makeFallbackResolver().extractTypes(
      'class Wrapper<T> extends Box<String> {\n}',
      '/test.ts',
    );
    const wrapper = types.find((t) => t.name === 'Wrapper')!;
    expect(wrapper.baseTypes).toEqual(['Box<String>']);
  });

  it('extracts an interface with extends', () => {
    const types = makeFallbackResolver().extractTypes(
      'interface Reader extends AutoCloseable, Other {\n}',
      '/test.ts',
    );
    const reader = types.find((t) => t.name === 'Reader')!;
    expect(reader.kind).toBe('interface');
    expect(reader.baseTypes).toEqual(['AutoCloseable', 'Other']);
  });

  it('extracts an interface with no extends', () => {
    const types = makeFallbackResolver().extractTypes('interface Empty {\n}', '/test.ts');
    expect(types.find((t) => t.name === 'Empty')!.baseTypes).toEqual([]);
  });

  it('extracts a type alias', () => {
    const types = makeFallbackResolver().extractTypes('export type ID = string;', '/test.ts');
    const id = types.find((t) => t.name === 'ID')!;
    expect(id.kind).toBe('type');
    expect(id.isExported).toBe(true);
  });

  it('extracts an enum', () => {
    const types = makeFallbackResolver().extractTypes('enum Color {\n  Red,\n}', '/test.ts');
    const color = types.find((t) => t.name === 'Color')!;
    expect(color.kind).toBe('enum');
  });

  it('extracts a const enum', () => {
    const types = makeFallbackResolver().extractTypes(
      'export const enum Direction {\n  Up,\n}',
      '/test.ts',
    );
    const dir = types.find((t) => t.name === 'Direction')!;
    expect(dir.kind).toBe('enum');
    expect(dir.isExported).toBe(true);
  });

  it('computes location line numbers from source offsets', () => {
    const types = makeFallbackResolver().extractTypes(
      '// leading comment\nexport class Foo {\n}',
      '/test.ts',
    );
    const foo = types.find((t) => t.name === 'Foo')!;
    expect(foo.location.startLine).toBe(2);
  });
});
