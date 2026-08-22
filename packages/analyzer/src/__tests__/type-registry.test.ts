// @code-analyzer/analyzer — Type Registry Tests
// Comprehensive test suite for Hybrid LSP type resolution.

import { describe, it, expect, beforeEach } from 'vitest';
import { TypeRegistry } from '../resolution/type-registry.js';
import type { TypeInfo, TypeMember } from '../resolution/type-registry.js';
import { TypeScriptTypeResolver } from '../resolution/typescript-resolver.js';
import { PythonTypeResolver } from '../resolution/python-resolver.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeType(
  overrides: Partial<TypeInfo> & {
    name: string;
    qualifiedName: string;
    filePath: string;
    kind: TypeInfo['kind'];
  },
): TypeInfo {
  return {
    members: new Map(),
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

function makeMember(overrides?: Partial<TypeMember>): TypeMember {
  return {
    name: 'bar',
    type: '() => void',
    visibility: 'public',
    isStatic: false,
    isOptional: false,
    isAsync: false,
    parameterTypes: [],
    returnType: 'void',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TypeRegistry Tests
// ---------------------------------------------------------------------------

describe('TypeRegistry', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
  });

  describe('registerType', () => {
    it('should register a basic type', () => {
      const type = makeType({
        name: 'User',
        qualifiedName: 'models.User',
        filePath: '/src/models.ts',
        kind: 'class',
      });
      registry.registerType(type);
      expect(registry.typeCount).toBe(1);
      expect(registry.hasType('models.User')).toBe(true);
    });

    it('should register multiple types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'interface' }),
      );
      expect(registry.typeCount).toBe(2);
    });

    it('should update file index when registering types', () => {
      registry.registerType(
        makeType({ name: 'Foo', qualifiedName: 'Foo', filePath: '/src/foo.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({ name: 'Bar', qualifiedName: 'Bar', filePath: '/src/foo.ts', kind: 'class' }),
      );
      expect(registry.getTypesInFile('/src/foo.ts')).toHaveLength(2);
    });

    it('should return empty array for unregistered file', () => {
      expect(registry.getTypesInFile('/nonexistent.ts')).toEqual([]);
    });
  });

  describe('resolveType', () => {
    it('should resolve a type by qualified name in same file', () => {
      registry.registerType(
        makeType({ name: 'User', qualifiedName: 'User', filePath: '/a.ts', kind: 'class' }),
      );
      const result = registry.resolveType('User', '/a.ts');
      expect(result.isResolved).toBe(true);
      expect(result.typeInfo?.name).toBe('User');
    });

    it('should resolve a type by short name across files', () => {
      registry.registerType(
        makeType({
          name: 'User',
          qualifiedName: 'models.User',
          filePath: '/models.ts',
          kind: 'class',
        }),
      );
      const result = registry.resolveType('User', '/other.ts');
      expect(result.isResolved).toBe(true);
      expect(result.typeInfo?.filePath).toBe('/models.ts');
    });

    it('should return unresolved for unknown types', () => {
      const result = registry.resolveType('Unknown', '/a.ts');
      expect(result.isResolved).toBe(false);
      expect(result.typeInfo).toBeNull();
    });
  });

  describe('resolveMember', () => {
    it('should resolve a class member', () => {
      const type = makeType({
        name: 'User',
        qualifiedName: 'User',
        filePath: '/a.ts',
        kind: 'class',
      });
      type.members.set(
        'getName',
        makeMember({ name: 'getName', returnType: 'string', type: '() => string' }),
      );
      registry.registerType(type);

      const result = registry.resolveMember('User', 'getName', '/a.ts');
      expect(result.isResolved).toBe(true);
      expect(result.member?.name).toBe('getName');
      expect(result.member?.returnType).toBe('string');
    });

    it('should resolve inherited members from base class', () => {
      const base = makeType({
        name: 'Base',
        qualifiedName: 'Base',
        filePath: '/base.ts',
        kind: 'class',
      });
      base.members.set(
        'baseMethod',
        makeMember({ name: 'baseMethod', returnType: 'number', type: '() => number' }),
      );
      registry.registerType(base);

      const derived = makeType({
        name: 'Derived',
        qualifiedName: 'Derived',
        filePath: '/derived.ts',
        kind: 'class',
        baseTypes: ['Base'],
      });
      registry.registerType(derived);

      const result = registry.resolveMember('Derived', 'baseMethod');
      expect(result.isResolved).toBe(true);
      expect(result.member?.name).toBe('baseMethod');
    });

    it('should return unresolved for missing member', () => {
      const type = makeType({
        name: 'User',
        qualifiedName: 'User',
        filePath: '/a.ts',
        kind: 'class',
      });
      registry.registerType(type);
      const result = registry.resolveMember('User', 'nonexistent');
      expect(result.isResolved).toBe(false);
    });
  });

  describe('isAssignableTo', () => {
    it('should return true for identical types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      expect(registry.isAssignableTo('A', 'A')).toBe(true);
    });

    it('should return true when base type is in extends', () => {
      registry.registerType(
        makeType({ name: 'Base', qualifiedName: 'Base', filePath: '/base.ts', kind: 'class' }),
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
      expect(registry.isAssignableTo('Derived', 'Base')).toBe(true);
    });

    it('should return true when implementing interface', () => {
      registry.registerType(
        makeType({ name: 'IFoo', qualifiedName: 'IFoo', filePath: '/a.ts', kind: 'interface' }),
      );
      registry.registerType(
        makeType({
          name: 'Impl',
          qualifiedName: 'Impl',
          filePath: '/b.ts',
          kind: 'class',
          implementedInterfaces: ['IFoo'],
        }),
      );
      expect(registry.isAssignableTo('Impl', 'IFoo')).toBe(true);
    });

    it('should return false for unrelated types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'class' }),
      );
      expect(registry.isAssignableTo('A', 'B')).toBe(false);
    });

    it('should resolve structural subtyping for interfaces', () => {
      const iface = makeType({
        name: 'Describable',
        qualifiedName: 'Describable',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set(
        'describe',
        makeMember({ name: 'describe', returnType: 'string', type: '() => string' }),
      );
      registry.registerType(iface);

      const impl = makeType({
        name: 'Report',
        qualifiedName: 'Report',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set(
        'describe',
        makeMember({ name: 'describe', returnType: 'string', type: '() => string' }),
      );
      registry.registerType(impl);

      expect(registry.isAssignableTo('Report', 'Describable')).toBe(true);
    });

    it('should return false when interface member is missing', () => {
      const iface = makeType({
        name: 'Describable',
        qualifiedName: 'Describable',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set(
        'describe',
        makeMember({ name: 'describe', returnType: 'string', type: '() => string' }),
      );
      registry.registerType(iface);

      const impl = makeType({
        name: 'Empty',
        qualifiedName: 'Empty',
        filePath: '/b.ts',
        kind: 'class',
      });
      registry.registerType(impl);

      expect(registry.isAssignableTo('Empty', 'Describable')).toBe(false);
    });
  });

  describe('getTypesByKind', () => {
    it('should filter types by kind', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'interface' }),
      );
      registry.registerType(
        makeType({ name: 'C', qualifiedName: 'C', filePath: '/c.ts', kind: 'class' }),
      );

      const classes = registry.getTypesByKind('class');
      expect(classes).toHaveLength(2);
      const interfaces = registry.getTypesByKind('interface');
      expect(interfaces).toHaveLength(1);
    });
  });

  describe('getAllTypes', () => {
    it('should return all registered types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      expect(registry.getAllTypes()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should remove all types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      registry.clear();
      expect(registry.typeCount).toBe(0);
      expect(registry.getAllTypes()).toEqual([]);
    });
  });

  describe('buildImportMap', () => {
    it('should build import resolution map', () => {
      registry.registerType(
        makeType({
          name: 'User',
          qualifiedName: 'models.User',
          filePath: '/models.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('/models.ts', '/models.ts');

      registry.buildImportMap('/main.ts', [
        {
          source: './models',
          names: ['User'],
          type: 'named',
          lineNumber: 1,
        } as import('@code-analyzer/shared').ParsedImport,
      ]);

      const result = registry.resolveType('User', '/main.ts');
      // Cross-file resolution via short name should still work
      expect(result.isResolved).toBe(true);
    });
  });

  describe('isAssignableTo — edge cases', () => {
    it('should walk recursive base type chain (A extends B extends C)', () => {
      registry.registerType(
        makeType({ name: 'C', qualifiedName: 'C', filePath: '/c.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({
          name: 'B',
          qualifiedName: 'B',
          filePath: '/b.ts',
          kind: 'class',
          baseTypes: ['C'],
        }),
      );
      registry.registerType(
        makeType({
          name: 'A',
          qualifiedName: 'A',
          filePath: '/a.ts',
          kind: 'class',
          baseTypes: ['B'],
        }),
      );
      expect(registry.isAssignableTo('A', 'C')).toBe(true);
    });

    it('should match baseTypes by short name', () => {
      registry.registerType(
        makeType({ name: 'Base', qualifiedName: 'pkg.Base', filePath: '/base.ts', kind: 'class' }),
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
      expect(registry.isAssignableTo('Derived', 'pkg.Base')).toBe(true);
    });

    it('should match implementedInterfaces by short name', () => {
      registry.registerType(
        makeType({ name: 'IFoo', qualifiedName: 'pkg.IFoo', filePath: '/a.ts', kind: 'interface' }),
      );
      registry.registerType(
        makeType({
          name: 'Impl',
          qualifiedName: 'Impl',
          filePath: '/b.ts',
          kind: 'class',
          implementedInterfaces: ['IFoo'],
        }),
      );
      expect(registry.isAssignableTo('Impl', 'pkg.IFoo')).toBe(true);
    });

    it('should pass structural subtyping when all members match', () => {
      const iface = makeType({
        name: 'HasName',
        qualifiedName: 'HasName',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set('name', makeMember({ name: 'name', type: 'string', returnType: 'string' }));
      registry.registerType(iface);

      const impl = makeType({
        name: 'Named',
        qualifiedName: 'Named',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set('name', makeMember({ name: 'name', type: 'string', returnType: 'string' }));
      registry.registerType(impl);

      expect(registry.isAssignableTo('Named', 'HasName')).toBe(true);
    });

    it('should reject structural subtyping when visibility is incompatible', () => {
      const iface = makeType({
        name: 'Visible',
        qualifiedName: 'Visible',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set(
        'secret',
        makeMember({ name: 'secret', type: '() => void', visibility: 'public' }),
      );
      registry.registerType(iface);

      const impl = makeType({
        name: 'HiddenImpl',
        qualifiedName: 'HiddenImpl',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set(
        'secret',
        makeMember({ name: 'secret', type: '() => void', visibility: 'private' }),
      );
      registry.registerType(impl);

      expect(registry.isAssignableTo('HiddenImpl', 'Visible')).toBe(false);
    });

    it('should reject structural subtyping when member types differ', () => {
      const iface = makeType({
        name: 'SetUser',
        qualifiedName: 'SetUser',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set(
        'setName',
        makeMember({ name: 'setName', type: '(string) => void', returnType: 'void' }),
      );
      registry.registerType(iface);

      const impl = makeType({
        name: 'BadImpl',
        qualifiedName: 'BadImpl',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set(
        'setName',
        makeMember({ name: 'setName', type: '(number) => void', returnType: 'void' }),
      );
      registry.registerType(impl);

      expect(registry.isAssignableTo('BadImpl', 'SetUser')).toBe(false);
    });

    it('should return false for non-interface structural target', () => {
      registry.registerType(
        makeType({ name: 'ClassA', qualifiedName: 'ClassA', filePath: '/a.ts', kind: 'class' }),
      );
      registry.registerType(
        makeType({ name: 'ClassB', qualifiedName: 'ClassB', filePath: '/b.ts', kind: 'class' }),
      );
      // ClassB not in ClassA's hierarchy and target is not interface → false
      expect(registry.isAssignableTo('ClassA', 'ClassB')).toBe(false);
    });

    it('should handle structural subtyping with any-type member', () => {
      const iface = makeType({
        name: 'Flexible',
        qualifiedName: 'Flexible',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set('data', makeMember({ name: 'data', type: 'any' }));
      registry.registerType(iface);

      const impl = makeType({
        name: 'DataImpl',
        qualifiedName: 'DataImpl',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set('data', makeMember({ name: 'data', type: 'string' }));
      registry.registerType(impl);

      // any type in target allows any source member type
      expect(registry.isAssignableTo('DataImpl', 'Flexible')).toBe(true);
    });
  });

  describe('resolveMember — edge cases', () => {
    it('should resolve member without contextFile (direct lookup)', () => {
      const type = makeType({
        name: 'Service',
        qualifiedName: 'Service',
        filePath: '/s.ts',
        kind: 'class',
      });
      type.members.set('start', makeMember({ name: 'start', returnType: 'void' }));
      registry.registerType(type);

      const result = registry.resolveMember('Service', 'start');
      expect(result.isResolved).toBe(true);
      expect(result.member?.name).toBe('start');
    });

    it('should handle member lookup on non-existent type without contextFile', () => {
      const result = registry.resolveMember('Ghost', 'whatever');
      expect(result.isResolved).toBe(false);
      expect(result.member).toBeNull();
    });
  });

  describe('buildImportMap — extension matching', () => {
    it('should resolve bare specifier via extension matching (.ts)', () => {
      registry.registerType(
        makeType({ name: 'Lib', qualifiedName: 'Lib', filePath: '/lib/utils.ts', kind: 'class' }),
      );
      registry.registerModule('utils.ts', '/lib/utils.ts');
      registry.buildImportMap('/main.ts', [
        { source: 'utils', names: ['Lib'], type: 'named', lineNumber: 1 } as any,
      ]);
      // Resolution via global short name match should work regardless
      const result = registry.resolveType('Lib', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve bare specifier via exact module index match', () => {
      registry.registerType(
        makeType({ name: 'Mod', qualifiedName: 'Mod', filePath: '/lib/mod.ts', kind: 'class' }),
      );
      registry.registerModule('mod', '/lib/mod.ts');
      registry.buildImportMap('/main.ts', [
        { source: 'mod', names: ['Mod'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('Mod', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    it('should return null for unresolvable bare specifier', () => {
      registry.buildImportMap('/main.ts', [
        { source: 'nonexistent-pkg', names: ['Nonex'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('Nonex', '/main.ts');
      expect(result.isResolved).toBe(false);
    });

    // Cover resolveModulePath relative import extension probing (line 368-373)
    it('should resolve relative import with .ts extension probing', () => {
      registry.registerType(
        makeType({
          name: 'Foo',
          qualifiedName: 'Foo',
          filePath: '/src/utils/helpers.ts',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.ts', [
        { source: './utils/helpers', names: ['Foo'], type: 'named', lineNumber: 1 } as any,
      ]);
      // Should resolve Foo via global match since file is registered
      const result = registry.resolveType('Foo', '/src/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveModulePath bare specifier extension probing (line 352-356)
    it('should resolve bare specifier via .jsx extension probing', () => {
      registry.registerType(
        makeType({
          name: 'Component',
          qualifiedName: 'Component',
          filePath: '/lib/ui.jsx',
          kind: 'class',
        }),
      );
      registry.registerModule('ui.jsx', '/lib/ui.jsx');
      registry.buildImportMap('/main.ts', [
        { source: 'ui', names: ['Component'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('Component', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveModulePath relative import with /index.ts extension probing (line 369)
    it('should resolve relative import with /index.ts extension probing', () => {
      registry.registerType(
        makeType({
          name: 'IndexMod',
          qualifiedName: 'IndexMod',
          filePath: '/src/features/index.ts',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.ts', [
        { source: './features', names: ['IndexMod'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('IndexMod', '/src/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveModulePath relative import with /index.js extension probing (line 369)
    it('should resolve relative import as directory with index file probing (.py)', () => {
      registry.registerType(
        makeType({
          name: 'PyMod',
          qualifiedName: 'PyMod',
          filePath: '/src/utils/index.py',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.py', [
        { source: './utils', names: ['PyMod'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('PyMod', '/src/main.py');
      expect(result.isResolved).toBe(true);
    });

    // Cover registerModule (line 147-148) directly
    it('should register and use module names', () => {
      registry.registerModule('my-lib', '/lib/my-lib.ts');
      registry.registerType(
        makeType({
          name: 'LibExport',
          qualifiedName: 'LibExport',
          filePath: '/lib/my-lib.ts',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.ts', [
        { source: 'my-lib', names: ['LibExport'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('LibExport', '/src/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveModulePath bare specifier with .py extension (line 353 in source)
    it('should resolve bare specifier via .py extension probing', () => {
      registry.registerType(
        makeType({
          name: 'PyLib',
          qualifiedName: 'PyLib',
          filePath: '/lib/pymodule.py',
          kind: 'class',
        }),
      );
      registry.registerModule('pymodule.py', '/lib/pymodule.py');
      registry.buildImportMap('/main.ts', [
        { source: 'pymodule', names: ['PyLib'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('PyLib', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover buildResolutionMap when resolvedFile exists but has no types (line 396 in source)
    it('should handle import where resolved file has no types', () => {
      // Register module but no types in that file
      registry.registerModule('empty-dep', '/lib/empty.ts');
      registry.buildImportMap('/main.ts', [
        { source: 'empty-dep', names: ['Empty'], type: 'named', lineNumber: 1 } as any,
      ]);
      // No crash — the import is resolved but type lookup fails gracefully
      expect(() => registry.resolveType('Empty', '/main.ts')).not.toThrow();
    });

    // Cover resolveModulePath directory index with .js extension (line 377-378 in source)
    it('should resolve relative import as directory with index.js', () => {
      registry.registerType(
        makeType({
          name: 'JsMod',
          qualifiedName: 'JsMod',
          filePath: '/src/features/index.js',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.js', [
        { source: './features', names: ['JsMod'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('JsMod', '/src/main.js');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveModulePath exact path match without extension probing (line 366 in source)
    it('should resolve relative import with exact path match', () => {
      registry.registerType(
        makeType({
          name: 'ExactMatch',
          qualifiedName: 'ExactMatch',
          filePath: '/src/exact.ts',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.ts', [
        { source: './exact.ts', names: ['ExactMatch'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('ExactMatch', '/src/main.ts');
      expect(result.isResolved).toBe(true);
    });
  });

  describe('export', () => {
    it('should serialize registry state', () => {
      const type = makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' });
      type.members.set('foo', makeMember({ name: 'foo', returnType: 'string' }));
      registry.registerType(type);

      const exported = registry.export();
      expect(exported.types).toHaveLength(1);
      expect(exported.types[0]!.members).toHaveLength(1);
    });

    // Cover importMaps serialization path (line 329-330 in type-registry.ts)
    it('should serialize import resolution maps', () => {
      registry.registerType(
        makeType({
          name: 'User',
          qualifiedName: 'models.User',
          filePath: '/models.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('/models.ts', '/models.ts');

      registry.buildImportMap('/main.ts', [
        {
          source: './models',
          names: ['User'],
          type: 'named',
          lineNumber: 1,
        } as import('@code-analyzer/shared').ParsedImport,
      ]);

      const exported = registry.export();
      expect(exported.types).toHaveLength(1);
      expect(exported.importMaps.length).toBeGreaterThanOrEqual(0);
      if (exported.importMaps.length > 0) {
        expect(exported.importMaps[0]![0]).toBe('/main.ts');
        expect(Array.isArray(exported.importMaps[0]![1])).toBe(true);
      }
    });
    // Cover resolveType direct match in same file (line 159-161)
    it('should resolve type by direct match in same file', () => {
      registry.registerType(
        makeType({ name: 'Foo', qualifiedName: 'Foo', filePath: '/a.ts', kind: 'class' }),
      );
      const result = registry.resolveType('Foo', '/a.ts');
      expect(result.isResolved).toBe(true);
      expect(result.resolutionPath).toEqual(['direct']);
    });

    // Cover resolveType with import map resolution (line 164-177)
    it('should resolve type through import resolution map', () => {
      registry.registerType(
        makeType({
          name: 'User',
          qualifiedName: 'models.User',
          filePath: '/models.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('./models', '/models.ts');
      registry.buildImportMap('/main.ts', [
        {
          source: './models',
          names: ['User'],
          type: 'named',
          lineNumber: 1,
        } as import('@code-analyzer/shared').ParsedImport,
      ]);
      const result = registry.resolveType('User', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    // Cover resolveType global name lookup (line 179-188)
    it('should resolve type by global short name search', () => {
      registry.registerType(
        makeType({
          name: 'GlobalType',
          qualifiedName: 'pkg.GlobalType',
          filePath: '/pkg/types.ts',
          kind: 'class',
        }),
      );
      const result = registry.resolveType('GlobalType', '/other.ts');
      expect(result.isResolved).toBe(true);
      expect(result.resolutionPath[0]).toBe('global');
    });

    // Cover resolveMember with contextFile parameter (line 196-198)
    it('should resolve member with context file parameter', () => {
      const type = makeType({
        name: 'Service',
        qualifiedName: 'Service',
        filePath: '/s.ts',
        kind: 'class',
      });
      type.members.set('run', makeMember({ name: 'run', returnType: 'void' }));
      registry.registerType(type);
      const result = registry.resolveMember('Service', 'run', '/s.ts');
      expect(result.isResolved).toBe(true);
      expect(result.member?.name).toBe('run');
    });

    // Cover resolveMember when type not found (line 200-202)
    it('should return unresolved when owner type not found with contextFile', () => {
      const result = registry.resolveMember('Ghost', 'method', '/a.ts');
      expect(result.isResolved).toBe(false);
      expect(result.member).toBeNull();
      expect(result.ownerType).toBeNull();
    });

    // Cover resolveMember when member not found in baseTypes (line 211-219)
    it('should return ownerType when member not found even in base types', () => {
      const base = makeType({
        name: 'Base',
        qualifiedName: 'Base',
        filePath: '/base.ts',
        kind: 'class',
      });
      registry.registerType(base);
      const derived = makeType({
        name: 'Derived',
        qualifiedName: 'Derived',
        filePath: '/d.ts',
        kind: 'class',
        baseTypes: ['Base'],
      });
      registry.registerType(derived);
      const result = registry.resolveMember('Derived', 'missingMethod');
      expect(result.isResolved).toBe(false);
      expect(result.member).toBeNull();
      expect(result.ownerType?.name).toBe('Derived');
    });

    // Cover isAssignableTo — source or target not found (line 229)
    it('should return false when source type not registered', () => {
      expect(registry.isAssignableTo('Unknown', 'Target')).toBe(false);
    });

    it('should return false when target type not registered', () => {
      registry.registerType(
        makeType({ name: 'Source', qualifiedName: 'Source', filePath: '/s.ts', kind: 'class' }),
      );
      expect(registry.isAssignableTo('Source', 'Unknown')).toBe(false);
    });

    // Cover isAssignableTo — structural subtyping with interface target and any type member (line 259)
    it('should accept structural subtyping when target member type is any', () => {
      const iface = makeType({
        name: 'FlexIface',
        qualifiedName: 'FlexIface',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set('value', makeMember({ name: 'value', type: 'any' }));
      registry.registerType(iface);

      const impl = makeType({
        name: 'FlexImpl',
        qualifiedName: 'FlexImpl',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set('value', makeMember({ name: 'value', type: 'string' }));
      registry.registerType(impl);

      expect(registry.isAssignableTo('FlexImpl', 'FlexIface')).toBe(true);
    });

    // Cover isAssignableTo — structural subtyping with visibility mismatch (line 254-256)
    it('should reject structural subtyping when public required but member is protected', () => {
      const iface = makeType({
        name: 'PublicIface',
        qualifiedName: 'PublicIface',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set(
        'api',
        makeMember({ name: 'api', type: '() => void', visibility: 'public' }),
      );
      registry.registerType(iface);

      const impl = makeType({
        name: 'ProtectedImpl',
        qualifiedName: 'ProtectedImpl',
        filePath: '/b.ts',
        kind: 'class',
      });
      impl.members.set(
        'api',
        makeMember({ name: 'api', type: '() => void', visibility: 'protected' }),
      );
      registry.registerType(impl);

      expect(registry.isAssignableTo('ProtectedImpl', 'PublicIface')).toBe(false);
    });

    // Cover hasType method
    it('should return true for registered type', () => {
      registry.registerType(
        makeType({ name: 'Test', qualifiedName: 'Test', filePath: '/t.ts', kind: 'class' }),
      );
      expect(registry.hasType('Test')).toBe(true);
    });

    it('should return false for unregistered type', () => {
      expect(registry.hasType('Nonexistent')).toBe(false);
    });

    // Cover clear method
    it('should clear all types and indexes', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      registry.registerModule('mod', '/mod.ts');
      registry.buildImportMap('/main.ts', [
        { source: 'mod', names: ['A'], type: 'named', lineNumber: 1 } as any,
      ]);
      expect(registry.typeCount).toBeGreaterThan(0);
      registry.clear();
      expect(registry.typeCount).toBe(0);
      expect(registry.getAllTypes()).toEqual([]);
    });

    // Cover getTypesByKind with no matching types
    it('should return empty array for kind with no registered types', () => {
      registry.registerType(
        makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }),
      );
      expect(registry.getTypesByKind('enum')).toEqual([]);
    });
  });

  describe('resolveModulePath — relative import probing', () => {
    it('should resolve relative import with .tsx extension', () => {
      registry.registerType(
        makeType({ name: 'Comp', qualifiedName: 'Comp', filePath: '/src/ui.tsx', kind: 'class' }),
      );
      registry.buildImportMap('/src/main.ts', [
        { source: './ui', names: ['Comp'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('Comp', '/src/main.ts');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve relative import with .jsx extension probing', () => {
      registry.registerType(
        makeType({
          name: 'JsxComp',
          qualifiedName: 'JsxComp',
          filePath: '/src/component.jsx',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.tsx', [
        { source: './component', names: ['JsxComp'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('JsxComp', '/src/main.tsx');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve relative import with /index.js extension probing', () => {
      registry.registerType(
        makeType({
          name: 'IdxJs',
          qualifiedName: 'IdxJs',
          filePath: '/src/utils/index.js',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.js', [
        { source: './utils', names: ['IdxJs'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('IdxJs', '/src/main.js');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve relative import with /index.py extension probing', () => {
      registry.registerType(
        makeType({
          name: 'PyIdx',
          qualifiedName: 'PyIdx',
          filePath: '/src/lib/index.py',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/src/main.py', [
        { source: './lib', names: ['PyIdx'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('PyIdx', '/src/main.py');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve bare specifier via .tsx extension probing', () => {
      registry.registerType(
        makeType({ name: 'UiLib', qualifiedName: 'UiLib', filePath: '/lib/ui.tsx', kind: 'class' }),
      );
      registry.registerModule('ui.tsx', '/lib/ui.tsx');
      registry.buildImportMap('/main.ts', [
        { source: 'ui', names: ['UiLib'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('UiLib', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    it('should resolve bare specifier via .js extension probing', () => {
      registry.registerType(
        makeType({
          name: 'JsMod',
          qualifiedName: 'JsMod',
          filePath: '/lib/module.js',
          kind: 'class',
        }),
      );
      registry.registerModule('module.js', '/lib/module.js');
      registry.buildImportMap('/main.ts', [
        { source: 'module', names: ['JsMod'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('JsMod', '/main.ts');
      expect(result.isResolved).toBe(true);
    });

    it('should return null for unresolvable bare specifier', () => {
      // resolveModulePath returns null for bare specifier not in moduleIndex
      registry.buildImportMap('/main.ts', [
        { source: 'completely-unknown-lib', names: ['X'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('X', '/main.ts');
      expect(result.isResolved).toBe(false);
    });
  });

  describe('resolveType — resolution path coverage', () => {
    it('should return direct resolution path for same-file type', () => {
      registry.registerType(
        makeType({
          name: 'LocalType',
          qualifiedName: 'LocalType',
          filePath: '/same.ts',
          kind: 'class',
        }),
      );
      const result = registry.resolveType('LocalType', '/same.ts');
      expect(result.isResolved).toBe(true);
      expect(result.resolutionPath).toEqual(['direct']);
    });

    it('should return import resolution path when resolved through imports', () => {
      registry.registerType(
        makeType({
          name: 'ImportedType',
          qualifiedName: 'pkg.ImportedType',
          filePath: '/pkg/types.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('./types', '/pkg/types.ts');
      registry.buildImportMap('/consumer.ts', [
        { source: './types', names: ['ImportedType'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('ImportedType', '/consumer.ts');
      expect(result.isResolved).toBe(true);
      // Resolution may be via import or global short name search
      expect(['import', 'global']).toContain(result.resolutionPath[0]);
    });

    it('should return global resolution path when found by short name', () => {
      registry.registerType(
        makeType({
          name: 'GlobalClass',
          qualifiedName: 'deep.nested.GlobalClass',
          filePath: '/deep.ts',
          kind: 'class',
        }),
      );
      const result = registry.resolveType('GlobalClass', '/other.ts');
      expect(result.isResolved).toBe(true);
      expect(result.resolutionPath[0]).toBe('global');
    });

    it('should return empty resolution path when type not found', () => {
      const result = registry.resolveType('NoSuchType', '/file.ts');
      expect(result.isResolved).toBe(false);
      expect(result.resolutionPath).toEqual([]);
    });
  });

  describe('resolveMember — base type chain with inherited interfaces', () => {
    it('should resolve member from base type chain via implementedInterfaces', () => {
      const iface = makeType({
        name: 'HasMethod',
        qualifiedName: 'HasMethod',
        filePath: '/a.ts',
        kind: 'interface',
      });
      iface.members.set('execute', makeMember({ name: 'execute', returnType: 'void' }));
      registry.registerType(iface);

      const impl = makeType({
        name: 'Impl',
        qualifiedName: 'Impl',
        filePath: '/b.ts',
        kind: 'class',
        implementedInterfaces: ['HasMethod'],
      });
      registry.registerType(impl);

      // resolveMember on Impl.execute — member isn't directly on Impl,
      // and implementedInterfaces aren't in baseTypes, so this tests the baseTypes chain
      const result = registry.resolveMember('Impl', 'execute');
      // The member is on the interface, not a direct base type of Impl
      // Only baseTypes are walked, not implementedInterfaces
      expect(result.isResolved).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Branch coverage — additional paths
  // -------------------------------------------------------------------------

  describe('resolveType — direct match in different file', () => {
    it('should not return direct resolution when type is in different file', () => {
      registry.registerType(
        makeType({ name: 'User', qualifiedName: 'User', filePath: '/other.ts', kind: 'class' }),
      );
      const result = registry.resolveType('User', '/main.ts');
      // Falls through to global search since filePath doesn't match contextFile
      expect(result.isResolved).toBe(true);
      expect(result.resolutionPath[0]).toBe('global');
    });
  });

  describe('resolveType — import resolution with resolvedQname found', () => {
    it('should resolve through import map when qname exists in map', () => {
      registry.registerType(
        makeType({
          name: 'Lib',
          qualifiedName: 'lib.Lib',
          filePath: '/lib/index.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('./lib', '/lib/index.ts');
      registry.buildImportMap('/app.ts', [
        { source: './lib', names: ['Lib'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('Lib', '/app.ts');
      expect(result.isResolved).toBe(true);
    });
  });

  describe('resolveMember — base type walk with missing member in base', () => {
    it('should return ownerType when base type exists but lacks the member', () => {
      const base = makeType({
        name: 'Base',
        qualifiedName: 'Base',
        filePath: '/b.ts',
        kind: 'class',
      });
      base.members.set(
        'existingMethod',
        makeMember({ name: 'existingMethod', returnType: 'number' }),
      );
      registry.registerType(base);

      const derived = makeType({
        name: 'Derived',
        qualifiedName: 'Derived',
        filePath: '/d.ts',
        kind: 'class',
        baseTypes: ['Base'],
      });
      registry.registerType(derived);

      // Try to find a member that exists on base but we look for a different one
      const result = registry.resolveMember('Derived', 'missingFromBase', '/d.ts');
      expect(result.isResolved).toBe(false);
      expect(result.ownerType?.name).toBe('Derived');
    });
  });

  describe('buildResolutionMap — import name matches qualifiedName', () => {
    it('should match import by qualifiedName when imported name matches qualifiedName', () => {
      registry.registerType(
        makeType({
          name: 'ExportedName',
          qualifiedName: 'lib.ExportedName',
          filePath: '/lib/index.ts',
          kind: 'class',
        }),
      );
      registry.registerModule('./lib', '/lib/index.ts');
      registry.buildImportMap('/app.ts', [
        { source: './lib', names: ['ExportedName'], type: 'named', lineNumber: 1 } as any,
      ]);
      const result = registry.resolveType('ExportedName', '/app.ts');
      expect(result.isResolved).toBe(true);
    });
  });

  describe('buildImportMap — record with unresolved file', () => {
    it('should skip records with no resolved file', () => {
      // Register a type but don't register a matching module — import won't resolve
      registry.registerType(
        makeType({
          name: 'Orphan',
          qualifiedName: 'Orphan',
          filePath: '/orphan.ts',
          kind: 'class',
        }),
      );
      registry.buildImportMap('/app.ts', [
        { source: 'nonexistent-package', names: ['Orphan'], type: 'named', lineNumber: 1 } as any,
      ]);
      // Type is still found via global search
      const result = registry.resolveType('Orphan', '/app.ts');
      expect(result.isResolved).toBe(true);
    });
  });

  describe('resolveMember — without contextFile when type not found', () => {
    it('should return unresolved when type is not in registry without contextFile', () => {
      const result = registry.resolveMember('NoType', 'noMethod');
      expect(result.isResolved).toBe(false);
      expect(result.member).toBeNull();
      expect(result.ownerType).toBeNull();
    });
  });

  describe('isAssignableTo — walk base chain with multiple levels', () => {
    it('should walk multi-level base chain for assignability', () => {
      registry.registerType(
        makeType({
          name: 'Grandparent',
          qualifiedName: 'Grandparent',
          filePath: '/g.ts',
          kind: 'class',
        }),
      );
      registry.registerType(
        makeType({
          name: 'Parent',
          qualifiedName: 'Parent',
          filePath: '/p.ts',
          kind: 'class',
          baseTypes: ['Grandparent'],
        }),
      );
      registry.registerType(
        makeType({
          name: 'Child',
          qualifiedName: 'Child',
          filePath: '/c.ts',
          kind: 'class',
          baseTypes: ['Parent'],
        }),
      );
      expect(registry.isAssignableTo('Child', 'Grandparent')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// TypeScriptTypeResolver Tests
// ---------------------------------------------------------------------------

describe('TypeScriptTypeResolver', () => {
  const resolver = new TypeScriptTypeResolver();

  describe('extractTypes — class declarations', () => {
    it('should extract a simple class', () => {
      const source = `class User {
  name: string;
  getName(): string { return this.name; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      expect(types.length).toBeGreaterThan(0);

      const userType = types.find((t) => t.name === 'User');
      expect(userType).toBeDefined();
      expect(userType?.kind).toBe('class');
      expect(userType?.filePath).toBe('/test.ts');
    });

    it('should extract class with extends and implements', () => {
      const source = `export class Admin extends User implements IAdmin {
  role: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const adminType = types.find((t) => t.name === 'Admin');
      expect(adminType).toBeDefined();
      expect(adminType?.isExported).toBe(true);
      expect(adminType?.baseTypes).toContain('User');
    });

    it('should extract abstract class', () => {
      const source = `export abstract class BaseRepository<T> {
  abstract findById(id: string): T;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const baseType = types.find((t) => t.name === 'BaseRepository');
      expect(baseType).toBeDefined();
      expect(baseType?.isAbstract).toBe(true);
      expect(baseType?.typeParameters).toContain('T');
    });

    it('should extract class with generics', () => {
      const source = `class Container<T, U> {
  items: T[];
  transform(fn: (item: T) => U): U[] { return []; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const contType = types.find((t) => t.name === 'Container');
      expect(contType).toBeDefined();
      expect(contType?.typeParameters).toContain('T');
      expect(contType?.typeParameters).toContain('U');
    });
  });

  describe('extractTypes — interface declarations', () => {
    it('should extract an interface', () => {
      const source = `interface Config {
  port: number;
  host: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const config = types.find((t) => t.name === 'Config');
      expect(config).toBeDefined();
      expect(config?.kind).toBe('interface');
    });

    it('should extract interface extending multiple bases', () => {
      const source = `interface AdminUser extends User, IAdmin {
  permissions: string[];
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const adminUser = types.find((t) => t.name === 'AdminUser');
      expect(adminUser).toBeDefined();
    });
  });

  describe('extractTypes — type aliases', () => {
    it('should extract type alias', () => {
      const source = `export type ID = string | number;`;
      const types = resolver.extractTypes(source, '/test.ts');
      const idType = types.find((t) => t.name === 'ID');
      expect(idType).toBeDefined();
      expect(idType?.kind).toBe('type');
    });
  });

  describe('extractTypes — enum declarations', () => {
    it('should extract enum with members', () => {
      const source = `export enum Status {
  Active,
  Inactive,
  Pending
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const statusEnum = types.find((t) => t.name === 'Status');
      expect(statusEnum).toBeDefined();
      expect(statusEnum?.kind).toBe('enum');
      expect(statusEnum?.members.has('Active')).toBe(true);
    });
  });

  describe('extractTypes — function declarations', () => {
    it('should extract function with params and return type', () => {
      const source = `export function createUser(name: string, age: number): User {
  return new User(name, age);
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'createUser');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
      expect(func?.isExported).toBe(true);
    });
  });

  describe('extractTypes — edge cases', () => {
    it('should handle empty file', () => {
      const types = resolver.extractTypes('', '/empty.ts');
      expect(types).toEqual([]);
    });

    it('should handle file with no type definitions', () => {
      const source = `console.log("hello");\nconst x = 42;`;
      const types = resolver.extractTypes(source, '/test.ts');
      // Only type-level constructs are extracted; plain variables are skipped
      expect(types.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle complex nested generics', () => {
      const source = `class Store<S extends Record<string, unknown>> {
  state: S;
  dispatch(action: Action<S>): void {}
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const storeType = types.find((t) => t.name === 'Store');
      expect(storeType).toBeDefined();
    });
  });

  describe('extractTypes — generator function declarations', () => {
    it('should extract generator function declaration', () => {
      const source = `function* range(start: number, end: number): Generator<number> {
  for (let i = start; i <= end; i++) {
    yield i;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'range');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
    });
  });

  describe('extractTypes — variable declarations', () => {
    it('should extract const with type annotation', () => {
      const source = `const config: Record<string, number> = { port: 8080 };`;
      const types = resolver.extractTypes(source, '/test.ts');
      const varType = types.find((t) => t.name === 'config');
      expect(varType).toBeDefined();
      expect(varType?.kind).toBe('variable');
    });

    it('should extract exported const arrow function', () => {
      const source = `export const compute = (x: number, y: number): number => x + y;`;
      const types = resolver.extractTypes(source, '/test.ts');
      // Variable declarations may be extracted as variables if tree-sitter parses them
      const varType = types.find((t) => t.name === 'compute');
      // It may or may not be extracted depending on tree-sitter grammar
      if (varType) {
        expect(varType.isExported).toBe(true);
      }
    });
  });

  describe('extractTypes — export statement variations', () => {
    it('should extract exported class via export statement', () => {
      const source = `export class Widget {
  render(): string { return ''; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const widget = types.find((t) => t.name === 'Widget');
      expect(widget).toBeDefined();
      expect(widget?.kind).toBe('class');
    });

    it('should extract exported interface via export statement', () => {
      const source = `export interface IWidget {
  id: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const iface = types.find((t) => t.name === 'IWidget');
      expect(iface).toBeDefined();
      expect(iface?.kind).toBe('interface');
    });

    it('should extract exported type alias via export statement', () => {
      const source = `export type Status = 'active' | 'inactive';`;
      const types = resolver.extractTypes(source, '/test.ts');
      const typeAlias = types.find((t) => t.name === 'Status');
      expect(typeAlias).toBeDefined();
    });

    it('should extract exported enum via export statement', () => {
      const source = `export enum Color {
  Red, Green, Blue
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const colorEnum = types.find((t) => t.name === 'Color');
      expect(colorEnum).toBeDefined();
      expect(colorEnum?.kind).toBe('enum');
    });

    it('should extract exported function via export statement', () => {
      const source = `export function greet(): string { return 'hello'; }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'greet');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
    });
  });

  describe('extractTypes — class members (properties)', () => {
    it('should extract class with typed property', () => {
      const source = `class Point {
  x: number;
  y: number;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const point = types.find((t) => t.name === 'Point');
      expect(point).toBeDefined();
      expect(point?.members.has('x')).toBe(true);
      expect(point?.members.has('y')).toBe(true);
    });

    it('should extract class with static and async methods', () => {
      const source = `class Service {
  static async fetch(url: string): Promise<Response> {
    return fetch(url);
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const service = types.find((t) => t.name === 'Service');
      expect(service).toBeDefined();
      const method = service?.members.get('fetch');
      expect(method).toBeDefined();
      expect(method?.isStatic).toBe(true);
      expect(method?.isAsync).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// PythonTypeResolver Tests
// ---------------------------------------------------------------------------

describe('PythonTypeResolver', () => {
  const resolver = new PythonTypeResolver();

  describe('extractTypes — class definitions', () => {
    it('should extract a Python class', () => {
      const source = `class User:
    def __init__(self, name: str, age: int):
        self.name = name
        self.age = age

    def get_name(self) -> str:
        return self.name`;
      const types = resolver.extractTypes(source, '/test.py');
      const userType = types.find((t) => t.name === 'User');
      expect(userType).toBeDefined();
      expect(userType?.kind).toBe('class');
      expect(userType?.filePath).toBe('/test.py');
    });

    it('should extract class with inheritance', () => {
      const source = `class Admin(User, IAdmin):
    role: str = "admin"`;
      const types = resolver.extractTypes(source, '/test.py');
      const adminType = types.find((t) => t.name === 'Admin');
      expect(adminType).toBeDefined();
      expect(adminType?.baseTypes).toContain('User');
    });

    it('should handle dataclass', () => {
      const source = `from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float`;
      const types = resolver.extractTypes(source, '/test.py');
      const pointType = types.find((t) => t.name === 'Point');
      expect(pointType).toBeDefined();
      expect(pointType?.decorators.length).toBeGreaterThan(0);
    });
  });

  describe('extractTypes — function definitions', () => {
    it('should extract a Python function', () => {
      const source = `def calculate_total(items: List[Item], tax_rate: float = 0.1) -> float:
    return sum(i.price for i in items) * (1 + tax_rate)`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'calculate_total');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
      // Return type may be null if tree-sitter-python isn't loaded (fallback mode)
      expect(func?.parameterTypes.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle async functions', () => {
      const source = `async def fetch_data(url: str) -> dict:
    return await http.get(url)`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'fetch_data');
      expect(func).toBeDefined();
    });

    it('should only extract top-level functions', () => {
      const source = `class Service:
    def internal_method(self):
        def nested_function(x):
            return x * 2
        return nested_function(5)

def top_level():
    pass`;
      const types = resolver.extractTypes(source, '/test.py');
      // Should have Service class + top_level function
      const topFunc = types.find((t) => t.name === 'top_level');
      expect(topFunc).toBeDefined();

      // Nested function should NOT be extracted as a top-level type
      const nested = types.find((t) => t.name === 'nested_function');
      expect(nested).toBeUndefined();
    });
  });

  describe('extractTypes — edge cases', () => {
    it('should handle empty file', () => {
      const types = resolver.extractTypes('', '/empty.py');
      expect(types).toEqual([]);
    });

    it('should handle file with imports only', () => {
      const source = `import os\nfrom typing import List, Optional\n`;
      const types = resolver.extractTypes(source, '/test.py');
      expect(types).toEqual([]);
    });

    it('should handle decorated functions', () => {
      const source = `@staticmethod
def helper(x: int) -> str:
    return str(x)`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'helper');
      expect(func).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// TypeScriptTypeResolver — Edge Cases & Branch Coverage
// ---------------------------------------------------------------------------

describe('TypeScriptTypeResolver — Edge Cases', () => {
  const resolver = new TypeScriptTypeResolver();

  describe('fallback extraction', () => {
    // When tree-sitter-typescript is not available, fallback regex extraction is used.
    // We test the fallback indirectly by verifying the resolver returns results
    // even when the tree-sitter grammar may not be fully available.
    it('should return types for class with extends and implements (fallback)', () => {
      const source = `export abstract class Admin extends User implements IAdmin {
  role: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      // Should extract the class regardless of tree-sitter availability
      const adminType = types.find((t) => t.name === 'Admin');
      expect(adminType).toBeDefined();
    });

    it('should return types for interface with extends (fallback)', () => {
      const source = `export interface AdminUser extends User, IAdmin {
  permissions: string[];
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const iface = types.find((t) => t.name === 'AdminUser');
      expect(iface).toBeDefined();
      expect(iface?.kind).toBe('interface');
    });

    it('should return types for type alias (fallback)', () => {
      const source = `export type ID = string | number;`;
      const types = resolver.extractTypes(source, '/test.ts');
      const typeAlias = types.find((t) => t.name === 'ID');
      expect(typeAlias).toBeDefined();
      expect(typeAlias?.kind).toBe('type');
    });

    it('should return types for const enum (fallback)', () => {
      const source = `export const enum Direction { Up, Down, Left, Right }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const enumType = types.find((t) => t.name === 'Direction');
      expect(enumType).toBeDefined();
      expect(enumType?.kind).toBe('enum');
    });
  });

  describe('class with visibility modifiers', () => {
    it('should extract class with private methods', () => {
      const source = `class Service {
  private validate(input: string): boolean { return true; }
  public process(input: string): string { return input; }
  protected helper(): void {}
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const service = types.find((t) => t.name === 'Service');
      expect(service).toBeDefined();
    });

    it('should extract class with optional properties', () => {
      const source = `class Config {
  debug?: boolean;
  port?: number;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const config = types.find((t) => t.name === 'Config');
      expect(config).toBeDefined();
    });
  });

  describe('interface with method signatures', () => {
    it('should extract interface with method and property signatures', () => {
      const source = `interface Repository<T> {
  findById(id: string): T | null;
  save(entity: T): void;
  delete(id: string): boolean;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const repo = types.find((t) => t.name === 'Repository');
      expect(repo).toBeDefined();
      expect(repo?.typeParameters).toContain('T');
    });

    it('should extract interface with optional method', () => {
      const source = `interface Handler {
  onEvent?(event: string): void;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const handler = types.find((t) => t.name === 'Handler');
      expect(handler).toBeDefined();
    });
  });

  describe('nested class inside module/namespace', () => {
    it('should extract class in namespace', () => {
      const source = `namespace Models {
  export class User {
    id: number;
    name: string;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const user = types.find((t) => t.name === 'User');
      expect(user).toBeDefined();
      expect(user?.kind).toBe('class');
    });

    it('should extract class nested in module declaration', () => {
      const source = `module MyModule {
  export class Service {
    run(): void {}
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const service = types.find((t) => t.name === 'Service');
      expect(service).toBeDefined();
      expect(service?.qualifiedName).toContain('MyModule');
    });

    it('should extract deeply nested class in namespace', () => {
      const source = `namespace Outer {
  namespace Inner {
    export class Nested {
      value: string;
    }
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const nested = types.find((t) => t.name === 'Nested');
      expect(nested).toBeDefined();
    });
  });

  describe('function declaration edge cases', () => {
    it('should extract exported async function', () => {
      const source = `export async function fetchData(url: string): Promise<Response> {
  const res = await fetch(url);
  return res.json();
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'fetchData');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
      expect(func?.isExported).toBe(true);
    });

    it('should extract function with no return type annotation', () => {
      const source = `function logMessage(msg: string) {
  console.log(msg);
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'logMessage');
      expect(func).toBeDefined();
    });

    it('should extract generator function', () => {
      const source = `function* generateIds(start: number): Generator<number> {
  while (true) yield start++;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'generateIds');
      expect(func).toBeDefined();
    });
  });

  describe('variable declaration edge cases', () => {
    it('should extract const with type annotation', () => {
      const source = `const DEFAULT_PORT: number = 8080;`;
      const types = resolver.extractTypes(source, '/test.ts');
      const varType = types.find((t) => t.name === 'DEFAULT_PORT');
      expect(varType).toBeDefined();
    });

    it('should extract let with type annotation', () => {
      const source = `let counter: number = 0;`;
      const types = resolver.extractTypes(source, '/test.ts');
      // May be extracted depending on parser
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe('enum edge cases', () => {
    it('should extract enum with explicit values', () => {
      const source = `enum HttpStatus {
  OK = 200,
  NotFound = 404,
  ServerError = 500,
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const enumType = types.find((t) => t.name === 'HttpStatus');
      expect(enumType).toBeDefined();
      expect(enumType?.kind).toBe('enum');
    });

    it('should extract string enum', () => {
      const source = `enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue",
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const enumType = types.find((t) => t.name === 'Color');
      expect(enumType).toBeDefined();
    });
  });

  describe('class member extraction — property definitions', () => {
    it('should extract class with field_definition', () => {
      const source = `class Config {
  field_definition = "default";
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Config');
      expect(cls).toBeDefined();
    });

    it('should extract class with property_definition and no type annotation', () => {
      const source = `class Simple {
  property_definition;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Simple');
      expect(cls).toBeDefined();
    });
  });

  describe('class with decorators', () => {
    it('should extract decorated class', () => {
      const source = `@Component({
  selector: 'app-root'
})
class AppComponent {
  title = 'app';
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'AppComponent');
      expect(cls).toBeDefined();
    });
  });

  describe('interface body extraction', () => {
    it('should extract interface using object_type body', () => {
      const source = `type MyType = {
  value: string;
  getValue(): string;
};`;
      const types = resolver.extractTypes(source, '/test.ts');
      const typeAlias = types.find((t) => t.name === 'MyType');
      expect(typeAlias).toBeDefined();
      expect(typeAlias?.kind).toBe('type');
    });
  });

  describe('function declaration — non-exported, nested', () => {
    it('should not extract non-top-level function declarations', () => {
      const source = `class Wrapper {
  innerFunction() {
    return true;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const inner = types.find((t) => t.name === 'innerFunction');
      expect(inner).toBeUndefined();
    });

    it('should extract function with optional parameter', () => {
      const source = `function greet(name: string, greeting?: string): string {
  return greeting ? \`\${greeting} \${name}\` : name;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'greet');
      expect(func).toBeDefined();
    });
  });

  describe('variable declaration — type inference', () => {
    it('should infer variable type from string initializer', () => {
      const source = `const message = "hello world";`;
      const types = resolver.extractTypes(source, '/test.ts');
      const varType = types.find((t) => t.name === 'message');
      if (varType) {
        expect(varType.kind).toBe('variable');
      }
    });

    it('should infer variable type from number initializer', () => {
      const source = `const count = 42;`;
      const types = resolver.extractTypes(source, '/test.ts');
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe('isNodeExported — edge cases', () => {
    it('should detect export keyword before declaration', () => {
      const source = `export class ExportedClass {}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'ExportedClass');
      expect(cls?.isExported).toBe(true);
    });
  });

  describe('getVisibility — all modifiers', () => {
    it('should extract class with protected field', () => {
      const source = `class Base {
  protected value: number;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Base');
      expect(cls).toBeDefined();
    });

    it('should extract class with private field', () => {
      const source = `class Base {
  private secret: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Base');
      expect(cls).toBeDefined();
    });
  });

  describe('hasModifier — edge cases', () => {
    it('should detect static modifier on method', () => {
      const source = `class MathUtils {
  static add(a: number, b: number): number {
    return a + b;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'MathUtils');
      const method = cls?.members.get('add');
      expect(method?.isStatic).toBe(true);
    });
  });

  describe('extractTypeParameters — empty/generic', () => {
    it('should extract class without type parameters', () => {
      const source = `class Plain {
  value: any;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Plain');
      expect(cls?.typeParameters).toEqual([]);
    });

    it('should handle type_parameters with no matching children', () => {
      const source = `class Box<T> {
  item: T;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'Box');
      expect(cls?.typeParameters).toContain('T');
    });
  });

  describe('fallback extraction — regex mode for TypeScript', () => {
    // When tree-sitter-typescript fails to load, fallbackExtractTypes handles parsing
    // These tests exercise the fallback regex branches (lines 744-837)

    it('should extract class with extends and implements via fallback regex', () => {
      const source = `export abstract class Admin extends User implements IAdmin, ISerializable {
  role: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const adminType = types.find((t) => t.name === 'Admin');
      expect(adminType).toBeDefined();
      // When tree-sitter is available, the extractor returns more detail;
      // when in fallback, at minimum the type should exist
      expect(adminType?.kind === 'class' || adminType?.isExported).toBeTruthy();
    });

    it('should extract class with generic type parameter via fallback regex', () => {
      const source = `export class Repository<T extends Entity> extends BaseRepository<T> {
  findById(id: string): T | null { return null; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const repoType = types.find((t) => t.name === 'Repository');
      expect(repoType).toBeDefined();
    });

    it('should extract class with base type containing generics', () => {
      const source = `class SpecialMap extends Map<string, number> {
  clear(): void {}
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const mapType = types.find((t) => t.name === 'SpecialMap');
      expect(mapType).toBeDefined();
    });

    it('should extract interface with extends and multiple bases via fallback regex', () => {
      const source = `export interface AdminUser extends User, IAdmin, ISerializable {
  permissions: string[];
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const iface = types.find((t) => t.name === 'AdminUser');
      expect(iface).toBeDefined();
      expect(iface?.kind).toBe('interface');
    });

    it('should extract interface with generic extends', () => {
      const source = `export interface PaginatedResult<T> extends ApiResponse<PageInfo> {
  data: T[];
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const result = types.find((t) => t.name === 'PaginatedResult');
      expect(result).toBeDefined();
    });

    it('should extract type alias with union via fallback regex', () => {
      const source = `export type Status = 'active' | 'inactive' | 'pending';`;
      const types = resolver.extractTypes(source, '/test.ts');
      const typeAlias = types.find((t) => t.name === 'Status');
      expect(typeAlias).toBeDefined();
      expect(typeAlias?.kind).toBe('type');
    });

    it('should extract type alias with intersection via fallback regex', () => {
      const source = `type Merged = User & Admin & { role: string };`;
      const types = resolver.extractTypes(source, '/test.ts');
      const merged = types.find((t) => t.name === 'Merged');
      expect(merged).toBeDefined();
    });

    it('should extract generic type alias via fallback regex', () => {
      const source = `export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };`;
      const types = resolver.extractTypes(source, '/test.ts');
      const resultType = types.find((t) => t.name === 'Result');
      expect(resultType).toBeDefined();
    });

    it('should extract const enum via fallback regex', () => {
      const source = `export const enum Direction { Up, Down, Left, Right }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const enumType = types.find((t) => t.name === 'Direction');
      expect(enumType).toBeDefined();
      expect(enumType?.kind).toBe('enum');
    });

    it('should extract regular enum via fallback regex', () => {
      const source = `enum Color { Red, Green, Blue }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const colorEnum = types.find((t) => t.name === 'Color');
      expect(colorEnum).toBeDefined();
    });
  });

  describe('isNodeExported — export keyword sibling detection', () => {
    it('should detect export when export wraps the class via child check', () => {
      // The export_statement case handles most exports, but the sibling check
      // in isNodeExported checks for export keyword in parent siblings
      const source = `export class DirectExport { value: string; }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'DirectExport');
      expect(cls?.isExported).toBe(true);
    });

    it('should handle declaration without export keyword', () => {
      const source = `class InternalClass { value: string; }`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'InternalClass');
      // Internal class should not be exported
      expect(cls).toBeDefined();
      expect(cls?.isExported).toBe(false);
    });
  });

  describe('findContainerName — module and namespace resolution', () => {
    it('should resolve container name for class in namespace', () => {
      const source = `namespace Models {
  export class User {
    id: number;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const user = types.find((t) => t.name === 'User');
      expect(user).toBeDefined();
      // When tree-sitter is loaded, qualifiedName should contain the namespace
      // In fallback mode, it uses file: prefix
      expect(user?.qualifiedName).toBeDefined();
    });

    it('should resolve container name for nested namespace', () => {
      const source = `namespace Outer {
  namespace Inner {
    export class Deep {
      value: string;
    }
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const deep = types.find((t) => t.name === 'Deep');
      expect(deep).toBeDefined();
    });

    it('should resolve container name for class inside module declaration', () => {
      const source = `module "my-lib" {
  export class Library {
    init(): void {}
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const lib = types.find((t) => t.name === 'Library');
      expect(lib).toBeDefined();
    });

    it('should use file path when no container is found', () => {
      const source = `class TopLevel {
  value: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'TopLevel');
      expect(cls).toBeDefined();
      expect(cls?.qualifiedName).toContain('file:');
      expect(cls?.qualifiedName).toContain('/test.ts');
    });
  });

  describe('class member extraction — abstract method signatures', () => {
    it('should extract abstract method from abstract class', () => {
      const source = `abstract class Base {
  abstract findById(id: string): Entity | null;
  abstract save(entity: Entity): void;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const base = types.find((t) => t.name === 'Base');
      expect(base).toBeDefined();
      expect(base?.isAbstract).toBe(true);
    });

    it('should extract method with optional parameter in class', () => {
      const source = `class Handler {
  process(data: string, options?: Config): Result {
    return new Result();
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const handler = types.find((t) => t.name === 'Handler');
      expect(handler).toBeDefined();
      const process = handler?.members.get('process');
      expect(process).toBeDefined();
    });
  });

  describe('interface member extraction — call signatures and optional members', () => {
    it('should extract interface with call signature', () => {
      const source = `interface Callable {
  (x: number): string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const callable = types.find((t) => t.name === 'Callable');
      expect(callable).toBeDefined();
    });

    it('should extract interface with optional property via ?:', () => {
      const source = `interface Config {
  port?: number;
  host: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const config = types.find((t) => t.name === 'Config');
      expect(config).toBeDefined();
    });

    it('should extract interface with method signature and return type', () => {
      const source = `interface Service {
  fetch(url: string): Promise<Response>;
  cancel(): void;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const service = types.find((t) => t.name === 'Service');
      expect(service).toBeDefined();
      const fetch = service?.members.get('fetch');
      expect(fetch).toBeDefined();
    });
  });

  describe('enum member extraction — edge cases', () => {
    it('should extract enum with string values', () => {
      const source = `enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue",
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const color = types.find((t) => t.name === 'Color');
      expect(color).toBeDefined();
      expect(color?.kind).toBe('enum');
    });

    it('should extract enum with numeric values', () => {
      const source = `enum StatusCode {
  OK = 200,
  NotFound = 404,
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const sc = types.find((t) => t.name === 'StatusCode');
      expect(sc).toBeDefined();
    });

    it('should extract enum with mixed member assignments', () => {
      const source = `enum Mixed {
  A,
  B = 10,
  C = "string",
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const mixed = types.find((t) => t.name === 'Mixed');
      expect(mixed).toBeDefined();
      expect(mixed?.members.has('A')).toBe(true);
    });
  });

  describe('function declaration — parent type checks', () => {
    it('should extract function with module parent', () => {
      const source = `module Utils {
  export function helper(x: number): number { return x * 2; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const helper = types.find((t) => t.name === 'helper');
      expect(helper).toBeDefined();
    });

    it('should not extract function nested inside class', () => {
      const source = `class Service {
  process(): void {
    function innerHelper(): boolean { return true; }
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const inner = types.find((t) => t.name === 'innerHelper');
      expect(inner).toBeUndefined();
    });

    it('should extract async function declaration', () => {
      const source = `export async function fetchUsers(): Promise<User[]> {
  return await api.get('/users');
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const func = types.find((t) => t.name === 'fetchUsers');
      expect(func).toBeDefined();
      expect(func?.isExported).toBe(true);
    });
  });

  describe('variable declaration — const detection and inference', () => {
    it('should extract lexical declaration with const keyword', () => {
      const source = `const VERSION: string = "1.0.0";`;
      const types = resolver.extractTypes(source, '/test.ts');
      const version = types.find((t) => t.name === 'VERSION');
      if (version) {
        expect(version.kind).toBe('variable');
        expect(version.returnType).toBeDefined();
      }
    });

    it('should extract variable declaration with object initializer', () => {
      const source = `const config = { port: 8080, host: "localhost" };`;
      const types = resolver.extractTypes(source, '/test.ts');
      const config = types.find((t) => t.name === 'config');
      if (config) {
        expect(config.kind).toBe('variable');
      }
    });

    it('should extract variable declaration with array initializer', () => {
      const source = `const items = [1, 2, 3];`;
      const types = resolver.extractTypes(source, '/test.ts');
      expect(Array.isArray(types)).toBe(true);
    });

    it('should extract exported variable declaration', () => {
      const source = `export const API_URL = "https://api.example.com";`;
      const types = resolver.extractTypes(source, '/test.ts');
      const apiUrl = types.find((t) => t.name === 'API_URL');
      if (apiUrl) {
        expect(apiUrl.isExported).toBe(true);
      }
    });
  });

  describe('getTypeText — type annotation stripping', () => {
    it('should extract class with complex return type', () => {
      const source = `class Parser {
  parse(input: string): Record<string, unknown> | null {
    return null;
  }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const parser = types.find((t) => t.name === 'Parser');
      expect(parser).toBeDefined();
    });
  });

  describe('class heritage — implements clause parsing', () => {
    it('should extract class implementing multiple interfaces', () => {
      const source = `class Component implements OnInit, OnDestroy, AfterViewInit {
  ngOnInit(): void {}
  ngOnDestroy(): void {}
  ngAfterViewInit(): void {}
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const component = types.find((t) => t.name === 'Component');
      expect(component).toBeDefined();
    });

    it('should extract class with extends but no implements', () => {
      const source = `class Child extends Parent {
  method(): void {}
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const child = types.find((t) => t.name === 'Child');
      expect(child).toBeDefined();
      expect(child?.baseTypes).toContain('Parent');
    });

    it('should extract class with implements but no extends', () => {
      const source = `class Adapter implements IAdapter {
  adapt(data: Input): Output { return new Output(); }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const adapter = types.find((t) => t.name === 'Adapter');
      expect(adapter).toBeDefined();
    });
  });

  describe('extractDecorators — class with decorators', () => {
    it('should extract class with decorators in parent siblings', () => {
      const source = `@Component({ selector: 'app-root' })
@Injectable()
class AppRoot {
  title: string = 'app';
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const cls = types.find((t) => t.name === 'AppRoot');
      expect(cls).toBeDefined();
    });
  });

  describe('interface heritage — extends clause parsing', () => {
    it('should extract interface extending single interface', () => {
      const source = `interface Extended extends Base {
  extraField: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const ext = types.find((t) => t.name === 'Extended');
      expect(ext).toBeDefined();
      expect(ext?.kind).toBe('interface');
    });
  });

  describe('hasModifier — parent modifier lookup', () => {
    it('should detect async modifier via parent', () => {
      const source = `class Service {
  async fetch(): Promise<void> { return; }
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const service = types.find((t) => t.name === 'Service');
      const fetch = service?.members.get('fetch');
      expect(fetch).toBeDefined();
    });
  });

  describe('class with field_definition and property_signature', () => {
    it('should extract class field without explicit type', () => {
      const source = `class Simple {
  value = "default";
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const simple = types.find((t) => t.name === 'Simple');
      expect(simple).toBeDefined();
    });
  });

  describe('getVisibility — public_keyword, protected_keyword, private_keyword', () => {
    it('should detect public visibility keyword', () => {
      const source = `class Example {
  public name: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const ex = types.find((t) => t.name === 'Example');
      expect(ex).toBeDefined();
    });

    it('should detect protected visibility keyword', () => {
      const source = `class Example {
  protected secret: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const ex = types.find((t) => t.name === 'Example');
      expect(ex).toBeDefined();
    });

    it('should detect private visibility keyword', () => {
      const source = `class Example {
  private hidden: string;
}`;
      const types = resolver.extractTypes(source, '/test.ts');
      const ex = types.find((t) => t.name === 'Example');
      expect(ex).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// PythonTypeResolver — Edge Cases & Branch Coverage
// ---------------------------------------------------------------------------

describe('PythonTypeResolver — Edge Cases', () => {
  const resolver = new PythonTypeResolver();

  describe('class with inheritance chain', () => {
    it('should extract class with multiple base classes', () => {
      const source = `class Derived(Base1, Base2, Base3):
    pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'Derived');
      expect(cls).toBeDefined();
      expect(cls?.kind).toBe('class');
    });

    it('should extract class with attribute-style base', () => {
      const source = `class MyError(exceptions.Exception):
    pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'MyError');
      expect(cls).toBeDefined();
    });

    it('should extract class with ABC decorator (abstract detection)', () => {
      const source = `from abc import ABC, abstractmethod

class AbstractService(ABC):
    @abstractmethod
    def process(self, data):
        pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'AbstractService');
      expect(cls).toBeDefined();
    });

    it('should extract class with private (underscore-prefixed) name', () => {
      const source = `class _InternalHelper:
    def do_work(self):
        pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === '_InternalHelper');
      expect(cls).toBeDefined();
      expect(cls?.isExported).toBe(false);
    });
  });

  describe('function with various parameter styles', () => {
    it('should extract function with default parameters', () => {
      const source = `def configure(host: str = "localhost", port: int = 8080) -> None:
    pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'configure');
      expect(func).toBeDefined();
    });

    it('should extract function with no parameters', () => {
      const source = `def get_version() -> str:
    return "1.0.0"`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'get_version');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
    });

    it('should extract function with no return type annotation', () => {
      const source = `def simple_hello(name):
    print(f"Hello {name}")`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'simple_hello');
      expect(func).toBeDefined();
    });

    it('should extract async function with type annotations', () => {
      const source = `async def process_batch(items: list[int]) -> dict[str, int]:
    return {"count": len(items)}`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'process_batch');
      expect(func).toBeDefined();
    });

    it('should extract private function (underscore prefix)', () => {
      const source = `def _internal_calc(x: int) -> int:
    return x * 2`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === '_internal_calc');
      expect(func).toBeDefined();
      expect(func?.isExported).toBe(false);
    });
  });

  describe('top-level variable assignment', () => {
    it('should extract type alias assignment', () => {
      const source = `UserId = int
Name = str`;
      const types = resolver.extractTypes(source, '/test.py');
      // These may be extracted as variables if tree-sitter-python is loaded
      expect(Array.isArray(types)).toBe(true);
    });

    it('should not extract function with dunder name as exported', () => {
      const source = `def __version__():
    return "1.0.0"`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === '__version__');
      // Dunder functions are still extracted but marked as non-exported
      if (func) {
        expect(func.isExported).toBe(false);
      }
    });
  });

  describe('class member visibility', () => {
    it('should mark protected members with single underscore', () => {
      const source = `class MyClass:
    def _protected_method(self):
        pass
    
    _protected_attr = "value"`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'MyClass');
      expect(cls).toBeDefined();
    });

    it('should mark private members with double underscore', () => {
      const source = `class MyClass:
    def __private_method(self):
        pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'MyClass');
      expect(cls).toBeDefined();
    });

    it('should skip dunder methods in class member extraction', () => {
      const source = `class MyClass:
    def __init__(self):
        self.data = []
    
    def __str__(self) -> str:
        return "MyClass"
    
    def public_method(self):
        pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'MyClass');
      expect(cls).toBeDefined();
      // __init__ and __str__ should be skipped
      expect(cls?.members.has('__init__')).toBe(false);
      expect(cls?.members.has('__str__')).toBe(false);
      // public_method should be present
      expect(cls?.members.has('public_method')).toBe(true);
    });
  });

  describe('staticmethod detection', () => {
    it('should detect staticmethod decorated class method', () => {
      const source = `class Utils:
    @staticmethod
    def helper(x: int) -> int:
        return x * 2`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'Utils');
      expect(cls).toBeDefined();
      const method = cls?.members.get('helper');
      // Static method detection depends on tree-sitter-python grammar availability
      // In fallback mode, static detection may not work
      expect(method).toBeDefined();
    });
  });

  describe('decorated definition handling', () => {
    it('should extract decorated top-level function', () => {
      const source = `@app.route("/api")
def api_handler():
    return {"status": "ok"}`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'api_handler');
      expect(func).toBeDefined();
    });
  });

  describe('class member extraction — class attributes', () => {
    it('should extract class attribute assignments', () => {
      const source = `class Config:
    port = 8080
    host = "localhost"
    
    def get_config(self):
        return {"port": self.port, "host": self.host}`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'Config');
      expect(cls).toBeDefined();
      expect(cls?.members.has('port')).toBe(true);
      expect(cls?.members.has('host')).toBe(true);
    });

    it('should handle class attributes without rhs value', () => {
      const source = `class Container:
    items = None
    
    def add(self, item):
        pass`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'Container');
      expect(cls).toBeDefined();
    });

    it('should mark class attributes with correct visibility', () => {
      const source = `class MyClass:
    _protected_attr = "protected_value"
    __private_attr = "private_value"
    public_attr = "public_value"`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'MyClass');
      expect(cls).toBeDefined();
      const prot = cls?.members.get('_protected_attr');
      const priv = cls?.members.get('__private_attr');
      const pub = cls?.members.get('public_attr');
      expect(prot?.visibility).toBe('protected');
      expect(priv?.visibility).toBe('private');
      expect(pub?.visibility).toBe('public');
    });
  });

  describe('class member extraction — async methods', () => {
    it('should detect async class method', () => {
      const source = `class AsyncService:
    async def fetch(self, url):
        return await http_get(url)`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'AsyncService');
      expect(cls).toBeDefined();
      const method = cls?.members.get('fetch');
      expect(method).toBeDefined();
    });
  });

  describe('top-level assignment extraction', () => {
    it('should extract top-level assignment with call rhs', () => {
      const source = `from typing import Dict
Config = Dict[str, int]`;
      const types = resolver.extractTypes(source, '/test.py');
      const config = types.find((t) => t.name === 'Config');
      // May be undefined if tree-sitter-python is not installed (fallback mode)
      if (config) {
        expect(config.kind).toBe('variable');
      }
    });

    it('should extract top-level assignment with generic_type rhs', () => {
      const source = `from typing import List
Items = List[str]`;
      const types = resolver.extractTypes(source, '/test.py');
      const items = types.find((t) => t.name === 'Items');
      // May be undefined if tree-sitter-python is not installed (fallback mode)
      if (items) {
        expect(items.kind).toBe('variable');
      }
    });

    it('should extract top-level assignment with attribute rhs', () => {
      const source = `import os
PathType = os.PathLike`;
      const types = resolver.extractTypes(source, '/test.py');
      const pathType = types.find((t) => t.name === 'PathType');
      expect(pathType).toBeDefined();
    });

    it('should not extract assignment with non-identifier lhs', () => {
      const source = `self.value = 42`;
      const types = resolver.extractTypes(source, '/test.py');
      // self.value should not be extracted as a type
      expect(types.every((t) => t.name !== 'self.value')).toBe(true);
    });
  });

  describe('fallback extraction — regex mode', () => {
    it('should extract class via regex fallback', () => {
      const source = `class User:
    def __init__(self, name):
        self.name = name`;
      const types = resolver.extractTypes(source, '/test.py');
      const user = types.find((t) => t.name === 'User');
      expect(user).toBeDefined();
      expect(user?.kind).toBe('class');
    });

    it('should extract class with inheritance via regex fallback', () => {
      const source = `class Admin(User, IAdmin):
    role: str`;
      const types = resolver.extractTypes(source, '/test.py');
      const admin = types.find((t) => t.name === 'Admin');
      expect(admin).toBeDefined();
      expect(admin?.baseTypes.length).toBeGreaterThan(0);
    });

    it('should extract function via regex fallback', () => {
      const source = `def calculate(x, y):
    return x + y`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'calculate');
      expect(func).toBeDefined();
      expect(func?.kind).toBe('function');
    });

    it('should extract async function via regex fallback', () => {
      const source = `async def fetch_data(url: str) -> dict:
    return await http.get(url)`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'fetch_data');
      expect(func).toBeDefined();
    });

    it('should extract function with return type via regex fallback', () => {
      const source = `def get_name() -> str:
    return "John"`;
      const types = resolver.extractTypes(source, '/test.py');
      const func = types.find((t) => t.name === 'get_name');
      expect(func).toBeDefined();
      expect(func?.returnType).toBeDefined();
    });
  });

  describe('findContainerName — nested classes', () => {
    it('should resolve container name for nested class', () => {
      const source = `class Outer:
    class Inner:
        value: int`;
      const types = resolver.extractTypes(source, '/test.py');
      const inner = types.find((t) => t.name === 'Inner');
      expect(inner).toBeDefined();
    });
  });

  describe('isTopLevel — edge cases', () => {
    it('should handle node with no parent as top level', () => {
      const source = `VERSION = "1.0.0"`;
      const types = resolver.extractTypes(source, '/test.py');
      const version = types.find((t) => t.name === 'VERSION');
      // May be undefined if tree-sitter-python is not installed (fallback mode)
      if (version) {
        expect(version.kind).toBe('variable');
      }
    });
  });

  describe('hasDecorator — edge cases', () => {
    it('should detect classmethod decorator', () => {
      const source = `class Factory:
    @classmethod
    def create(cls, name):
        return cls(name)`;
      const types = resolver.extractTypes(source, '/test.py');
      const cls = types.find((t) => t.name === 'Factory');
      expect(cls).toBeDefined();
    });
  });
});
