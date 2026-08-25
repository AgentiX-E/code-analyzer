// @ts-nocheck
// @code-analyzer/intelligence — Type registry branch coverage: finalized-seal
// errors, batch registration default-value fallbacks, namespace-import
// resolution, and method-index receiver matching.

import { describe, it, expect } from 'vitest';
import {
  TypeRegistry,
  buildProjectRegistry,
  createPerFileOverlay,
  type FileDefinition,
} from '../lsp/type-registry.js';
import { t } from '../lsp/type-rep.js';

function makeType(qn: string, shortName: string) {
  return {
    qn,
    shortName,
    label: 'Class',
    moduleQn: 'proj',
    type: t.named(shortName),
    language: 'typescript' as const,
    sourceFile: 'src/a.ts',
    sourceLine: 1,
  };
}

function makeFunc(qn: string, shortName: string, receiverType?: string) {
  return {
    qn,
    shortName,
    label: receiverType ? 'Method' : 'Function',
    receiverType,
    moduleQn: 'proj',
    returnTypes: 'void',
    paramCount: 0,
    paramTypes: '',
    isAsync: false,
    language: 'typescript' as const,
    sourceFile: 'src/a.ts',
    sourceLine: 1,
  };
}

describe('TypeRegistry — finalized seal', () => {
  it('throws when registering after finalize', () => {
    const r = new TypeRegistry();
    r.finalize();
    expect(() => r.registerType(makeType('proj.X', 'X'))).toThrow(/finalized/);
    expect(() => r.registerFunction(makeFunc('proj.f', 'f'))).toThrow(/finalized/);
  });
});

describe('TypeRegistry — lookup miss fallbacks', () => {
  it('returns null/empty on miss with no fallback', () => {
    const r = new TypeRegistry();
    expect(r.lookupType('proj.Missing')).toBeNull();
    expect(r.lookupFunction('proj.missing')).toBeNull();
    expect(r.lookupTypeByName('Missing')).toEqual([]);
    expect(r.lookupFunctionByName('missing')).toEqual([]);
    expect(r.lookupMethod('Missing', 'm')).toEqual([]);
  });

  it('chains lookup misses to a fallback registry', () => {
    const base = new TypeRegistry();
    base.registerType(makeType('proj.Base', 'Base'));
    base.registerFunction(makeFunc('proj.baseFn', 'baseFn'));
    const overlay = new TypeRegistry(base);

    expect(overlay.lookupType('proj.Base')?.shortName).toBe('Base');
    expect(overlay.lookupFunction('proj.baseFn')?.shortName).toBe('baseFn');
    expect(overlay.lookupTypeByName('Base').length).toBe(1);
    expect(overlay.lookupFunctionByName('baseFn').length).toBe(1);
  });
});

describe('TypeRegistry — method index receiver matching', () => {
  it('matches a method by receiver short name and rejects a non-receiver func', () => {
    const r = new TypeRegistry();
    r.registerFunction(makeFunc('proj.User.login', 'login', 'proj.User'));
    r.registerFunction(makeFunc('proj.standalone', 'standalone'));

    const methods = r.lookupMethod('User', 'login');
    expect(methods.length).toBe(1);
    expect(methods[0].qn).toBe('proj.User.login');
  });
});

describe('TypeRegistry — resolveTypeWithImports', () => {
  it('resolves a namespace import local name to a module QN', () => {
    const r = new TypeRegistry();
    r.registerType(makeType('proj.mod.Type', 'Type'));

    // Direct QN match
    expect(r.resolveTypeWithImports('proj.mod.Type', new Map())?.qn).toBe('proj.mod.Type');

    // Namespace import: Lib -> proj.mod, localName "Lib.Type"
    const imports = new Map([['Lib', 'proj.mod']]);
    expect(r.resolveTypeWithImports('Lib.Type', imports)?.qn).toBe('proj.mod.Type');
  });
});

describe('buildProjectRegistry / createPerFileOverlay — default fallbacks', () => {
  it('applies default values for omitted optional function fields', () => {
    const def: FileDefinition = {
      qn: 'proj.fn',
      shortName: 'fn',
      label: 'Function',
      moduleQn: 'proj',
      language: 'typescript',
      sourceFile: 'src/a.ts',
      sourceLine: 1,
      // returnTypes/paramCount/paramTypes/isAsync omitted on purpose
    };
    const registry = buildProjectRegistry([def]);
    expect(registry.lookupFunction('proj.fn')?.returnTypes).toBe('unknown');
    expect(registry.lookupFunction('proj.fn')?.paramCount).toBe(0);
    expect(registry.functionCount).toBe(1);
  });

  it('applies a default unknown type for a type def without a resolvedType', () => {
    const def: FileDefinition = {
      qn: 'proj.Thing',
      shortName: 'Thing',
      label: 'Class',
      moduleQn: 'proj',
      language: 'typescript',
      sourceFile: 'src/a.ts',
      sourceLine: 1,
      // resolvedType omitted
    };
    const registry = buildProjectRegistry([def]);
    expect(registry.lookupType('proj.Thing')?.type.kind).toBe('unknown');
  });

  it('builds an import map for namespace imports', () => {
    const base = new TypeRegistry();
    base.registerType(makeType('proj.mod.Type', 'Type'));
    const own: FileDefinition[] = [];
    const imports = [
      { localName: 'Lib', moduleQn: 'proj.mod', isDefault: false, isNamespace: true },
    ];
    const { overlay, importMap } = createPerFileOverlay(base, own, imports);
    expect(importMap.get('Lib')).toBe('proj.mod');
    expect(overlay.lookupType('proj.mod.Type')?.shortName).toBe('Type');
  });
});
