// @code-analyzer/intelligence — LSP Infrastructure Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { t, typeToString } from '../lsp/type-rep.js';
import {
  TypeRegistry,
  buildProjectRegistry,
  createPerFileOverlay,
  type FileDefinition,
  type FileImport,
} from '../lsp/type-registry.js';

// ---------------------------------------------------------------------------
// Type Representation Tests
// ---------------------------------------------------------------------------

describe('TypeRep', () => {
  describe('type builders', () => {
    it('builds named types', () => {
      const tp = t.named('string', true);
      expect(tp.kind).toBe('named');
      expect(tp.name).toBe('string');
      expect(tp.isBuiltin).toBe(true);
    });

    it('builds union types', () => {
      const tp = t.union(t.named('string'), t.named('number'));
      expect(tp.kind).toBe('union');
      expect(tp.members.length).toBe(2);
    });

    it('builds function types', () => {
      const tp = t.func(
        [t.param('a', t.named('number')), t.param('b', t.named('number'))],
        t.named('number'),
      );
      expect(tp.kind).toBe('func');
      expect(tp.params.length).toBe(2);
      expect(tp.isAsync).toBe(false);
    });

    it('builds template types', () => {
      const tp = t.template(t.named('Array'), t.named('string'));
      expect(tp.kind).toBe('template');
      expect(tp.typeArgs.length).toBe(1);
    });

    it('builds literal types', () => {
      const strLit = t.literal('hello');
      expect(strLit.kind).toBe('literal');
      expect(strLit.value).toBe('hello');

      const numLit = t.literal(42);
      expect(numLit.kind).toBe('literal');
      expect(numLit.value).toBe(42);
    });

    it('builds Promise type', () => {
      const tp = t.promise(t.named('string'));
      expect(tp.kind).toBe('promise');
      expect(tp.valueType.kind).toBe('named');
    });

    it('builds array type', () => {
      const tp = t.array(t.named('number'));
      expect(tp.kind).toBe('array');
    });

    it('builds indexed access type', () => {
      const tp = t.indexedAccess(t.named('T'), t.literal('key'));
      expect(tp.kind).toBe('indexedAccess');
    });

    it('builds keyof type', () => {
      const tp = t.keyof(t.named('T'));
      expect(tp.kind).toBe('keyof');
    });
  });

  describe('typeToString', () => {
    it('renders named types', () => {
      expect(typeToString(t.named('string'))).toBe('string');
    });

    it('renders union types', () => {
      expect(typeToString(t.union(t.named('string'), t.named('number')))).toBe('string | number');
    });

    it('renders function types', () => {
      const fn = t.func([t.param('x', t.named('number'))], t.named('boolean'));
      expect(typeToString(fn)).toBe('(x: number) => boolean');
    });

    it('renders async function types', () => {
      const fn = t.func([t.param('x', t.named('number'))], t.named('string'), { isAsync: true });
      expect(typeToString(fn)).toBe('(x: number) => Promise<string>');
    });

    it('renders template types', () => {
      expect(typeToString(t.template(t.named('Array'), t.named('string')))).toBe('Array<string>');
    });

    it('renders literal types', () => {
      expect(typeToString(t.literal('hello'))).toBe('"hello"');
      expect(typeToString(t.literal(42))).toBe('42');
    });

    it('renders Promises', () => {
      expect(typeToString(t.promise(t.named('number')))).toBe('Promise<number>');
    });

    it('renders array', () => {
      expect(typeToString(t.array(t.named('string')))).toBe('Array<string>');
    });
  });
});

// ---------------------------------------------------------------------------
// Type Registry Tests
// ---------------------------------------------------------------------------

describe('TypeRegistry', () => {
  let registry: TypeRegistry;

  beforeEach(() => {
    registry = new TypeRegistry();
  });

  describe('Registration', () => {
    it('registers and looks up a type by QN', () => {
      registry.registerType({
        qn: 'proj.src.models.User',
        shortName: 'User',
        label: 'Class',
        moduleQn: 'proj.src.models',
        type: t.named('User'),
        language: 'typescript',
        sourceFile: 'src/models/User.ts',
        sourceLine: 10,
      });

      const found = registry.lookupType('proj.src.models.User');
      expect(found).not.toBeNull();
      expect(found!.shortName).toBe('User');
      expect(found!.label).toBe('Class');
    });

    it('looks up by short name', () => {
      registry.registerType({
        qn: 'proj.src.models.User', shortName: 'User', label: 'Class',
        moduleQn: 'proj.src.models', type: t.named('User'),
        language: 'typescript', sourceFile: 'src/models/User.ts', sourceLine: 10,
      });
      registry.registerType({
        qn: 'proj.src.views.UserView', shortName: 'UserView', label: 'Class',
        moduleQn: 'proj.src.views', type: t.named('UserView'),
        language: 'typescript', sourceFile: 'src/views/UserView.ts', sourceLine: 5,
      });

      const found = registry.lookupTypeByName('User');
      expect(found.length).toBeGreaterThanOrEqual(1);
      expect(found[0]!.shortName).toBe('User');
    });

    it('registers and looks up a function', () => {
      registry.registerFunction({
        qn: 'proj.src.services.login', shortName: 'login', label: 'Function',
        moduleQn: 'proj.src.services', returnTypes: 'boolean', paramCount: 2,
        paramTypes: 'string|string', isAsync: true,
        language: 'typescript', sourceFile: 'src/services/auth.ts', sourceLine: 20,
      });

      const found = registry.lookupFunction('proj.src.services.login');
      expect(found).not.toBeNull();
      expect(found!.shortName).toBe('login');
      expect(found!.isAsync).toBe(true);
    });
  });

  describe('Method index', () => {
    it('resolves methods on a receiver type', () => {
      // Register a class
      registry.registerType({
        qn: 'proj.services.Database', shortName: 'Database', label: 'Class',
        moduleQn: 'proj.services', type: t.named('Database'),
        language: 'typescript', sourceFile: 'src/services/Database.ts', sourceLine: 5,
      });

      // Register methods on that class
      registry.registerFunction({
        qn: 'proj.services.Database.connect', shortName: 'connect', label: 'Method',
        receiverType: 'proj.services.Database', moduleQn: 'proj.services',
        returnTypes: 'void', paramCount: 0, paramTypes: '', isAsync: true,
        language: 'typescript', sourceFile: 'src/services/Database.ts', sourceLine: 7,
      });

      const methods = registry.lookupMethod('Database', 'connect');
      expect(methods.length).toBe(1);
      expect(methods[0]!.label).toBe('Method');
    });
  });

  describe('Finalize', () => {
    it('prevents registration after finalize', () => {
      registry.registerType({
        qn: 'proj.A', shortName: 'A', label: 'Class', moduleQn: 'proj',
        type: t.named('A'), language: 'typescript', sourceFile: 'A.ts', sourceLine: 1,
      });

      registry.finalize();

      expect(() => registry.registerType({
        qn: 'proj.B', shortName: 'B', label: 'Class', moduleQn: 'proj',
        type: t.named('B'), language: 'typescript', sourceFile: 'B.ts', sourceLine: 1,
      })).toThrow('finalized');
    });
  });

  describe('Fallback (Tier-2 overlay)', () => {
    it('chains lookups to the fallback base', () => {
      const base = new TypeRegistry();
      base.registerType({
        qn: 'proj.lib.Utils', shortName: 'Utils', label: 'Class',
        moduleQn: 'proj.lib', type: t.named('Utils'),
        language: 'typescript', sourceFile: 'lib/Utils.ts', sourceLine: 3,
      });
      base.finalize();

      const overlay = new TypeRegistry(base);
      overlay.registerType({
        qn: 'proj.app.MyApp', shortName: 'MyApp', label: 'Class',
        moduleQn: 'proj.app', type: t.named('MyApp'),
        language: 'typescript', sourceFile: 'app/MyApp.ts', sourceLine: 1,
      });
      overlay.finalize();

      // Lookup in overlay succeeds
      expect(overlay.lookupType('proj.app.MyApp')).not.toBeNull();

      // Lookup falls through to base
      expect(overlay.lookupType('proj.lib.Utils')).not.toBeNull();
    });

    it('overlay can override base types', () => {
      const base = new TypeRegistry();
      base.registerType({
        qn: 'proj.A', shortName: 'A', label: 'Interface',
        moduleQn: 'proj', type: t.named('A'),
        language: 'typescript', sourceFile: 'base/A.ts', sourceLine: 1,
      });
      base.finalize();

      const overlay = new TypeRegistry(base);
      overlay.registerType({
        qn: 'proj.A', shortName: 'A', label: 'Class', // Different label
        moduleQn: 'proj', type: t.named('A'),
        language: 'typescript', sourceFile: 'overlay/A.ts', sourceLine: 1,
      });
      overlay.finalize();

      // Overlay's version wins
      const found = overlay.lookupType('proj.A');
      expect(found!.label).toBe('Class');
      expect(found!.sourceFile).toBe('overlay/A.ts');
    });
  });
});

// ---------------------------------------------------------------------------
// Project Registry Builder Tests
// ---------------------------------------------------------------------------

describe('buildProjectRegistry', () => {
  const defs: FileDefinition[] = [
    {
      qn: 'proj.models.User', shortName: 'User', label: 'Class',
      moduleQn: 'proj.models', resolvedType: t.named('User'),
      language: 'typescript', sourceFile: 'models/User.ts', sourceLine: 5,
    },
    {
      qn: 'proj.models.createUser', shortName: 'createUser', label: 'Function',
      moduleQn: 'proj.models', returnTypes: 'proj.models.User',
      paramCount: 1, paramTypes: 'string', isAsync: false,
      language: 'typescript', sourceFile: 'models/User.ts', sourceLine: 15,
    },
    {
      qn: 'proj.models.User.getId', shortName: 'getId', label: 'Method',
      receiverType: 'proj.models.User', moduleQn: 'proj.models',
      returnTypes: 'number', paramCount: 0, paramTypes: '', isAsync: false,
      language: 'typescript', sourceFile: 'models/User.ts', sourceLine: 10,
    },
  ];

  it('builds a registry from definitions', () => {
    const registry = buildProjectRegistry(defs);
    expect(registry.typeCount).toBe(1);
    expect(registry.functionCount).toBe(2);
  });

  it('resolves a type', () => {
    const registry = buildProjectRegistry(defs);
    const found = registry.lookupType('proj.models.User');
    expect(found).not.toBeNull();
    expect(found!.shortName).toBe('User');
  });

  it('resolves a function', () => {
    const registry = buildProjectRegistry(defs);
    const found = registry.lookupFunction('proj.models.createUser');
    expect(found).not.toBeNull();
    expect(found!.shortName).toBe('createUser');
  });

  it('buildRegistry is finalized', () => {
    const registry = buildProjectRegistry(defs);
    expect(registry.finalized).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-File Overlay Tests
// ---------------------------------------------------------------------------

describe('createPerFileOverlay', () => {
  const baseDefs: FileDefinition[] = [
    {
      qn: 'lib.utils.helper', shortName: 'helper', label: 'Function',
      moduleQn: 'lib.utils', returnTypes: 'string', paramCount: 1,
      paramTypes: 'string', isAsync: false,
      language: 'typescript', sourceFile: 'lib/utils.ts', sourceLine: 3,
    },
    {
      qn: 'lib.types.Config', shortName: 'Config', label: 'Interface',
      moduleQn: 'lib.types', resolvedType: t.objectLiteral([]),
      language: 'typescript', sourceFile: 'lib/types.ts', sourceLine: 1,
    },
  ];

  const ownDefs: FileDefinition[] = [
    {
      qn: 'app.handler.handle', shortName: 'handle', label: 'Function',
      moduleQn: 'app.handler', returnTypes: 'void', paramCount: 1,
      paramTypes: 'lib.types.Config', isAsync: true,
      language: 'typescript', sourceFile: 'app/handler.ts', sourceLine: 10,
    },
  ];

  const imports: FileImport[] = [
    { localName: 'helper', moduleQn: 'lib.utils', isDefault: false, isNamespace: false },
    { localName: 'Config', moduleQn: 'lib.types', isDefault: false, isNamespace: false },
  ];

  it('creates overlay chained to base', () => {
    const base = buildProjectRegistry(baseDefs);
    const { overlay, importMap } = createPerFileOverlay(base, ownDefs, imports);

    // Own def should be in overlay
    expect(overlay.lookupFunction('app.handler.handle')).not.toBeNull();

    // Base def should be reachable through fallback
    expect(overlay.lookupFunction('lib.utils.helper')).not.toBeNull();
    expect(overlay.lookupType('lib.types.Config')).not.toBeNull();

    // Import map should contain both imports
    expect(importMap.get('helper')).toBe('lib.utils');
    expect(importMap.get('Config')).toBe('lib.types');
  });

  it('resolves imported types through import map', () => {
    const base = buildProjectRegistry(baseDefs);
    const { overlay, importMap } = createPerFileOverlay(base, ownDefs, imports);

    // Resolve Config through import
    const resolved = overlay.resolveTypeWithImports('Config', importMap);
    expect(resolved).not.toBeNull();
    expect(resolved!.qn).toBe('lib.types.Config');
  });

  it('resolves namespace imports', () => {
    const nsImports: FileImport[] = [
      { localName: 'Lib', moduleQn: 'lib.utils', isDefault: false, isNamespace: true },
    ];

    const base = buildProjectRegistry(baseDefs);
    const { overlay, importMap } = createPerFileOverlay(base, [], nsImports);

    expect(importMap.has('Lib')).toBe(true);

    // Namespace-qualified lookup: Lib.helper
    // Note: 'helper' is a Function, not a Type, so resolveTypeWithImports returns null
    // Function resolution should use the function lookup API instead
    const resolved = overlay.resolveTypeWithImports('Lib.helper', importMap);
    expect(resolved).toBeNull(); // helper is a Function, not a type
  });

  it('returns null for unresolved imports', () => {
    const base = buildProjectRegistry(baseDefs);
    const { overlay, importMap } = createPerFileOverlay(base, [], []);

    const resolved = overlay.resolveTypeWithImports('NonExistent', importMap);
    expect(resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('TypeRegistry edge cases', () => {
  it('lookupType returns null for unknown QN', () => {
    const registry = new TypeRegistry();
    expect(registry.lookupType('nonexistent.Type')).toBeNull();
  });

  it('lookupFunctionByName returns empty for unknown name', () => {
    const registry = new TypeRegistry();
    expect(registry.lookupFunctionByName('unknown')).toEqual([]);
  });

  it('lookupMethod returns empty for unknown method', () => {
    const registry = new TypeRegistry();
    expect(registry.lookupMethod('Unknown', 'method')).toEqual([]);
  });

  it('handles empty registrations gracefully', () => {
    const registry = new TypeRegistry();
    registry.finalize();
    expect(registry.typeCount).toBe(0);
    expect(registry.functionCount).toBe(0);
  });

  it('handles multiple types with same short name', () => {
    const registry = new TypeRegistry();
    registry.registerType({
      qn: 'proj.a.Foo', shortName: 'Foo', label: 'Class', moduleQn: 'proj.a',
      type: t.named('Foo'), language: 'typescript', sourceFile: 'a.ts', sourceLine: 1,
    });
    registry.registerType({
      qn: 'proj.b.Foo', shortName: 'Foo', label: 'Class', moduleQn: 'proj.b',
      type: t.named('Foo'), language: 'typescript', sourceFile: 'b.ts', sourceLine: 1,
    });

    const found = registry.lookupTypeByName('Foo');
    expect(found.length).toBe(2);
  });

  it('handles deep chaining of registries', () => {
    const base = new TypeRegistry();
    base.registerType({
      qn: 'base.Type', shortName: 'Type', label: 'Interface', moduleQn: 'base',
      type: t.named('Type'), language: 'typescript', sourceFile: 'base.ts', sourceLine: 1,
    });
    base.finalize();

    const mid = new TypeRegistry(base);
    mid.registerType({
      qn: 'mid.Type', shortName: 'Type', label: 'Class', moduleQn: 'mid',
      type: t.named('Type'), language: 'typescript', sourceFile: 'mid.ts', sourceLine: 1,
    });
    mid.finalize();

    const top = new TypeRegistry(mid);
    top.registerType({
      qn: 'top.Type', shortName: 'Type', label: 'Class', moduleQn: 'top',
      type: t.named('Type'), language: 'typescript', sourceFile: 'top.ts', sourceLine: 1,
    });
    top.finalize();

    expect(top.lookupType('top.Type')).not.toBeNull();
    expect(top.lookupType('mid.Type')).not.toBeNull();
    expect(top.lookupType('base.Type')).not.toBeNull();

    // By short name should find all three
    const all = top.lookupTypeByName('Type');
    expect(all.length).toBe(3);
  });

  it('stats are accurate', () => {
    const defs: FileDefinition[] = [
      { qn: 'p.A', shortName: 'A', label: 'Class', moduleQn: 'p', resolvedType: t.named('A'), language: 'typescript', sourceFile: 'A.ts', sourceLine: 1 },
      { qn: 'p.B', shortName: 'B', label: 'Class', moduleQn: 'p', resolvedType: t.named('B'), language: 'typescript', sourceFile: 'B.ts', sourceLine: 1 },
      { qn: 'p.fn', shortName: 'fn', label: 'Function', moduleQn: 'p', returnTypes: 'void', paramCount: 0, paramTypes: '', isAsync: false, language: 'typescript', sourceFile: 'fn.ts', sourceLine: 1 },
    ];
    const registry = buildProjectRegistry(defs);
    expect(registry.typeCount).toBe(2);
    expect(registry.functionCount).toBe(1);
  });
});
