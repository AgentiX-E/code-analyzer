import { describe, it, expect, beforeEach } from 'vitest';
import { TypeRegistry } from '../resolution/type-registry.js';
import type { TypeInfo, TypeMember } from '../resolution/type-registry.js';

function makeType(
  overrides: Partial<TypeInfo> & {
    name: string;
    qualifiedName: string;
    filePath: string;
    kind: TypeInfo['kind'];
  },
): TypeInfo {
  return {
    members: new Map<string, TypeMember>(),
    baseTypes: [],
    implementedInterfaces: [],
    typeParameters: [],
    returnType: null,
    parameterTypes: [],
    isExported: true,
    isAbstract: false,
    decorators: [],
    location: { startLine: 1, endLine: 5 },
    ...overrides,
  };
}

describe('TypeRegistry — branch coverage', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
  });

  it('falls back to name when qualifiedName is empty', () => {
    registry.registerType(
      makeType({ name: 'Foo', qualifiedName: '', filePath: '/a.ts', kind: 'class' }),
    );
    expect(registry.hasType('Foo')).toBe(true);
  });

  it('resolves a later type in the global short-name loop', () => {
    registry.registerType(
      makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
    );
    registry.registerType(
      makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'class' }),
    );
    const result = registry.resolveType('B', '/other.ts');
    expect(result.isResolved).toBe(true);
    expect(result.typeInfo?.name).toBe('B');
  });

  it('returns unresolved for a member whose base type is not registered', () => {
    const derived = makeType({
      name: 'Derived',
      qualifiedName: 'Derived',
      filePath: '/d.ts',
      kind: 'class',
      baseTypes: ['Missing'],
    });
    registry.registerType(derived);
    const result = registry.resolveMember('Derived', 'foo', '/d.ts');
    expect(result.isResolved).toBe(false);
  });

  it('returns false when a base chain is not assignable to the target', () => {
    registry.registerType(
      makeType({ name: 'Base', qualifiedName: 'Base', filePath: '/b.ts', kind: 'class' }),
    );
    registry.registerType(
      makeType({
        name: 'Derived',
        qualifiedName: 'Derived',
        filePath: '/d.ts',
        kind: 'class',
        baseTypes: ['Base'],
      }),
    );
    registry.registerType(
      makeType({ name: 'Target', qualifiedName: 'Target', filePath: '/t.ts', kind: 'class' }),
    );
    expect(registry.isAssignableTo('Derived', 'Target')).toBe(false);
  });

  it('resolves a relative import with an exact file match', () => {
    registry.registerType(
      makeType({ name: 'Foo', qualifiedName: 'Foo', filePath: '/proj/./foo', kind: 'class' }),
    );
    registry.buildImportMap('/proj/bar.ts', [{ source: './foo', names: ['Foo'] }]);
    const result = registry.resolveType('Foo', '/proj/bar.ts');
    expect(result.isResolved).toBe(true);
  });

  it('resolves a relative import with an extension match', () => {
    registry.registerType(
      makeType({ name: 'Foo', qualifiedName: 'Foo', filePath: '/proj/./foo.ts', kind: 'class' }),
    );
    registry.buildImportMap('/proj/bar.ts', [{ source: './foo', names: ['Foo'] }]);
    const result = registry.resolveType('Foo', '/proj/bar.ts');
    expect(result.isResolved).toBe(true);
  });

  it('resolves a relative import via an index file', () => {
    // `/index.py` is only matched by the dedicated directory-index loop
    // (the extension loop already covers `/index.ts` and `/index.js`).
    registry.registerType(
      makeType({
        name: 'Foo',
        qualifiedName: 'Foo',
        filePath: '/proj/./foo/index.py',
        kind: 'class',
      }),
    );
    registry.buildImportMap('/proj/bar.ts', [{ source: './foo', names: ['Foo'] }]);
    const result = registry.resolveType('Foo', '/proj/bar.ts');
    expect(result.isResolved).toBe(true);
  });

  it('matches an imported name by qualifiedName', () => {
    registry.registerType(
      makeType({
        name: 'Actual',
        qualifiedName: 'ns.Foo',
        filePath: '/proj/./foo.ts',
        kind: 'class',
      }),
    );
    registry.buildImportMap('/proj/bar.ts', [{ source: './foo', names: ['ns.Foo'] }]);
    const result = registry.resolveType('ns.Foo', '/proj/bar.ts');
    expect(result.isResolved).toBe(true);
  });

  it('leaves an unmatched imported name unresolved', () => {
    registry.registerType(
      makeType({
        name: 'Actual',
        qualifiedName: 'Actual',
        filePath: '/proj/./foo.ts',
        kind: 'class',
      }),
    );
    registry.buildImportMap('/proj/bar.ts', [{ source: './foo', names: ['Missing'] }]);
    const result = registry.resolveType('Missing', '/proj/bar.ts');
    expect(result.isResolved).toBe(false);
  });

  it('builds an empty resolution map for a file with no import records', () => {
    // buildResolutionMap is private; reach it directly to exercise the guard.
    const r = registry as unknown as { buildResolutionMap: (filePath: string) => void };
    expect(() => r.buildResolutionMap('/nonexistent.ts')).not.toThrow();
  });
});
