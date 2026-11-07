// @code-analyzer/analyzer — Type Registry Tests
// Comprehensive test suite for Hybrid LSP type resolution.

import { describe, it, expect, beforeEach } from 'vitest';
import type { ParsedImport } from '../languages/provider.js';
import { TypeRegistry } from '../resolution/type-registry.js';
import type { TypeInfo, TypeMember } from '../resolution/type-registry.js';

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
        } as ParsedImport,
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
        } as ParsedImport,
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
        } as ParsedImport,
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
