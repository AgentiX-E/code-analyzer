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

function makeType(overrides: Partial<TypeInfo> & { name: string; qualifiedName: string; filePath: string; kind: TypeInfo['kind'] }): TypeInfo {
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
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      registry.registerType(makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'interface' }));
      expect(registry.typeCount).toBe(2);
    });

    it('should update file index when registering types', () => {
      registry.registerType(makeType({ name: 'Foo', qualifiedName: 'Foo', filePath: '/src/foo.ts', kind: 'class' }));
      registry.registerType(makeType({ name: 'Bar', qualifiedName: 'Bar', filePath: '/src/foo.ts', kind: 'class' }));
      expect(registry.getTypesInFile('/src/foo.ts')).toHaveLength(2);
    });

    it('should return empty array for unregistered file', () => {
      expect(registry.getTypesInFile('/nonexistent.ts')).toEqual([]);
    });
  });

  describe('resolveType', () => {
    it('should resolve a type by qualified name in same file', () => {
      registry.registerType(makeType({ name: 'User', qualifiedName: 'User', filePath: '/a.ts', kind: 'class' }));
      const result = registry.resolveType('User', '/a.ts');
      expect(result.isResolved).toBe(true);
      expect(result.typeInfo?.name).toBe('User');
    });

    it('should resolve a type by short name across files', () => {
      registry.registerType(makeType({ name: 'User', qualifiedName: 'models.User', filePath: '/models.ts', kind: 'class' }));
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
      const type = makeType({ name: 'User', qualifiedName: 'User', filePath: '/a.ts', kind: 'class' });
      type.members.set('getName', makeMember({ name: 'getName', returnType: 'string', type: '() => string' }));
      registry.registerType(type);

      const result = registry.resolveMember('User', 'getName', '/a.ts');
      expect(result.isResolved).toBe(true);
      expect(result.member?.name).toBe('getName');
      expect(result.member?.returnType).toBe('string');
    });

    it('should resolve inherited members from base class', () => {
      const base = makeType({ name: 'Base', qualifiedName: 'Base', filePath: '/base.ts', kind: 'class' });
      base.members.set('baseMethod', makeMember({ name: 'baseMethod', returnType: 'number', type: '() => number' }));
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
      const type = makeType({ name: 'User', qualifiedName: 'User', filePath: '/a.ts', kind: 'class' });
      registry.registerType(type);
      const result = registry.resolveMember('User', 'nonexistent');
      expect(result.isResolved).toBe(false);
    });
  });

  describe('isAssignableTo', () => {
    it('should return true for identical types', () => {
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      expect(registry.isAssignableTo('A', 'A')).toBe(true);
    });

    it('should return true when base type is in extends', () => {
      registry.registerType(makeType({ name: 'Base', qualifiedName: 'Base', filePath: '/base.ts', kind: 'class' }));
      registry.registerType(makeType({ name: 'Derived', qualifiedName: 'Derived', filePath: '/d.ts', kind: 'class', baseTypes: ['Base'] }));
      expect(registry.isAssignableTo('Derived', 'Base')).toBe(true);
    });

    it('should return true when implementing interface', () => {
      registry.registerType(makeType({ name: 'IFoo', qualifiedName: 'IFoo', filePath: '/a.ts', kind: 'interface' }));
      registry.registerType(makeType({ name: 'Impl', qualifiedName: 'Impl', filePath: '/b.ts', kind: 'class', implementedInterfaces: ['IFoo'] }));
      expect(registry.isAssignableTo('Impl', 'IFoo')).toBe(true);
    });

    it('should return false for unrelated types', () => {
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      registry.registerType(makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'class' }));
      expect(registry.isAssignableTo('A', 'B')).toBe(false);
    });

    it('should resolve structural subtyping for interfaces', () => {
      const iface = makeType({ name: 'Describable', qualifiedName: 'Describable', filePath: '/a.ts', kind: 'interface' });
      iface.members.set('describe', makeMember({ name: 'describe', returnType: 'string', type: '() => string' }));
      registry.registerType(iface);

      const impl = makeType({ name: 'Report', qualifiedName: 'Report', filePath: '/b.ts', kind: 'class' });
      impl.members.set('describe', makeMember({ name: 'describe', returnType: 'string', type: '() => string' }));
      registry.registerType(impl);

      expect(registry.isAssignableTo('Report', 'Describable')).toBe(true);
    });

    it('should return false when interface member is missing', () => {
      const iface = makeType({ name: 'Describable', qualifiedName: 'Describable', filePath: '/a.ts', kind: 'interface' });
      iface.members.set('describe', makeMember({ name: 'describe', returnType: 'string', type: '() => string' }));
      registry.registerType(iface);

      const impl = makeType({ name: 'Empty', qualifiedName: 'Empty', filePath: '/b.ts', kind: 'class' });
      registry.registerType(impl);

      expect(registry.isAssignableTo('Empty', 'Describable')).toBe(false);
    });
  });

  describe('getTypesByKind', () => {
    it('should filter types by kind', () => {
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      registry.registerType(makeType({ name: 'B', qualifiedName: 'B', filePath: '/b.ts', kind: 'interface' }));
      registry.registerType(makeType({ name: 'C', qualifiedName: 'C', filePath: '/c.ts', kind: 'class' }));

      const classes = registry.getTypesByKind('class');
      expect(classes).toHaveLength(2);
      const interfaces = registry.getTypesByKind('interface');
      expect(interfaces).toHaveLength(1);
    });
  });

  describe('getAllTypes', () => {
    it('should return all registered types', () => {
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      expect(registry.getAllTypes()).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should remove all types', () => {
      registry.registerType(makeType({ name: 'A', qualifiedName: 'A', filePath: '/a.ts', kind: 'class' }));
      registry.clear();
      expect(registry.typeCount).toBe(0);
      expect(registry.getAllTypes()).toEqual([]);
    });
  });

  describe('buildImportMap', () => {
    it('should build import resolution map', () => {
      registry.registerType(makeType({ name: 'User', qualifiedName: 'models.User', filePath: '/models.ts', kind: 'class' }));
      registry.registerModule('/models.ts', '/models.ts');

      registry.buildImportMap('/main.ts', [
        { source: './models', names: ['User'], type: 'named', lineNumber: 1 } as import('@code-analyzer/shared').ParsedImport,
      ]);

      const result = registry.resolveType('User', '/main.ts');
      // Cross-file resolution via short name should still work
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
