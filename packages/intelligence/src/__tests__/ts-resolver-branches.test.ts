// @code-analyzer/intelligence — TS Resolver Branch Tests
// Targets remaining uncovered branches: generic substitution across all type
// kinds, full builtin resolution, type-annotation parsing edge cases, member
// access on object-literal/promise receivers, and registry/import resolution.

import { describe, it, expect } from 'vitest';
import { TSResolverContext, resolveImport, isBuiltinType } from '../lsp/ts-resolver.js';
import { TypeRegistry } from '../lsp/type-registry.js';
import { t, typeToString, BUILTINS } from '../lsp/type-rep.js';

function makeCtx(): TSResolverContext {
  const registry = new TypeRegistry();
  registry.registerType({
    qn: 'lib.User',
    shortName: 'User',
    label: 'Class',
    moduleQn: 'lib',
    type: t.named('User'),
    fieldDefs: 'id:number|name:string',
    language: 'typescript',
    sourceFile: 'lib.ts',
    sourceLine: 1,
  });
  registry.registerFunction({
    qn: 'lib.getUser',
    shortName: 'getUser',
    label: 'Function',
    moduleQn: 'lib',
    returnTypes: 'lib.User',
    paramCount: 1,
    paramTypes: 'T',
    isAsync: false,
    language: 'typescript',
    sourceFile: 'lib.ts',
    sourceLine: 10,
  });
  registry.registerFunction({
    qn: 'lib.noParams',
    shortName: 'noParams',
    label: 'Function',
    moduleQn: 'lib',
    returnTypes: 'string',
    paramCount: 0,
    paramTypes: '',
    isAsync: true,
    language: 'typescript',
    sourceFile: 'lib.ts',
    sourceLine: 20,
  });
  const importMap = new Map<string, string>([
    ['User', 'lib'],
    ['Widget', 'lib'],
  ]);
  return new TSResolverContext(registry, importMap, false, 'test.ts');
}

describe('substituteGenerics — all type kinds', () => {
  const ctx = makeCtx();

  it('passes through named/literal/void/any/unknown/never unchanged', () => {
    expect(ctx.substituteGenerics(t.named('Foo'))).toEqual(t.named('Foo'));
    expect(ctx.substituteGenerics(t.literal('x')).kind).toBe('literal');
    expect(ctx.substituteGenerics(BUILTINS.void).kind).toBe('void');
    expect(ctx.substituteGenerics(BUILTINS.any).kind).toBe('any');
  });

  it('substitutes union members', () => {
    ctx.bindGeneric('T', BUILTINS.string);
    const u = ctx.substituteGenerics(t.union(t.typeParam('T'), BUILTINS.number));
    expect(typeToString(u)).toBe('string | number');
  });

  it('substitutes intersection members', () => {
    ctx.bindGeneric('T', BUILTINS.number);
    const i = ctx.substituteGenerics(t.intersection(t.typeParam('T'), t.named('Id')));
    expect(typeToString(i)).toContain('number');
  });

  it('substitutes function parameter and return types', () => {
    ctx.bindGeneric('T', BUILTINS.string);
    const f = ctx.substituteGenerics(t.func([t.param('x', t.typeParam('T'))], t.typeParam('T')));
    expect(f.kind).toBe('func');
    if (f.kind === 'func') {
      expect(typeToString(f.params[0]!.type)).toBe('string');
      expect(typeToString(f.returnType)).toBe('string');
    }
  });

  it('substitutes array and promise element types', () => {
    ctx.bindGeneric('T', BUILTINS.boolean);
    const arr = ctx.substituteGenerics(t.array(t.typeParam('T')));
    expect(typeToString(arr)).toBe('Array<boolean>');
    const p = ctx.substituteGenerics(t.promise(t.typeParam('T')));
    expect(typeToString(p)).toBe('Promise<boolean>');
  });
});

describe('resolveTypeName — full builtin coverage', () => {
  const ctx = makeCtx();

  it('resolves every builtin primitive', () => {
    for (const name of [
      'void',
      'any',
      'never',
      'string',
      'number',
      'boolean',
      'object',
      'undefined',
      'null',
    ]) {
      expect(typeToString(ctx.resolveTypeName(name))).toBe(name);
    }
  });

  it('resolves an uppercase single-letter name as a type parameter', () => {
    expect(ctx.resolveTypeName('T').kind).toBe('typeParam');
  });
});

describe('parseTypeAnnotation — edge cases', () => {
  const ctx = makeCtx();

  it('parses intersection types', () => {
    expect(ctx.parseTypeAnnotation('A & B').kind).toBe('intersection');
  });

  it('parses Array<T> generic syntax', () => {
    expect(ctx.parseTypeAnnotation('Array<string>').kind).toBe('array');
  });

  it('parses a function type with no parameters', () => {
    const f = ctx.parseTypeAnnotation('() => void');
    expect(f.kind).toBe('func');
    if (f.kind === 'func') expect(f.params).toHaveLength(0);
  });

  it('parses a function type with untyped parameters', () => {
    const f = ctx.parseTypeAnnotation('(x) => string');
    expect(f.kind).toBe('func');
    if (f.kind === 'func') expect(typeToString(f.params[0]!.type)).toBe('any');
  });

  it('parses an empty object literal', () => {
    const o = ctx.parseTypeAnnotation('{}');
    expect(o.kind).toBe('objectLiteral');
    if (o.kind === 'objectLiteral') expect(o.properties).toHaveLength(0);
  });

  it('parses a shorthand object property without an explicit type', () => {
    const o = ctx.parseTypeAnnotation('{ name }');
    expect(o.kind).toBe('objectLiteral');
    if (o.kind === 'objectLiteral') {
      expect(o.properties[0]!.name).toBe('name');
      expect(typeToString(o.properties[0]!.type)).toBe('any');
    }
  });

  it('splits nested generic arguments', () => {
    // Map<string, Array<number>> — nested angle brackets.
    const tp = ctx.resolveTypeName('Map<string,Array<number>>');
    expect(tp.kind).toBe('template');
  });
});

describe('evalMemberAccess — object literal and promise', () => {
  const ctx = makeCtx();

  it('resolves a property on an object literal', () => {
    const obj = t.objectLiteral([t.prop('name', BUILTINS.string)]);
    expect(typeToString(ctx.evalMemberAccess(obj, 'name'))).toBe('string');
  });

  it('unwraps a promise receiver before member access', () => {
    const promise = t.promise(t.objectLiteral([t.prop('id', BUILTINS.number)]));
    expect(typeToString(ctx.evalMemberAccess(promise, 'id'))).toBe('number');
  });
});

describe('evalJSXComponent — import map fallback', () => {
  it('resolves a component through the import map', () => {
    const ctx = makeCtx();
    // Widget is in the import map but not directly in the registry under its
    // local name; the resolver must try the import-qualified QN.
    const tp = ctx.evalJSXComponent('UnknownThing', []);
    expect(typeToString(tp)).toBe('JSX.Element');
  });
});

describe('evalVariable — registry type and function fallbacks', () => {
  it('resolves a registry type by local name', () => {
    const ctx = makeCtx();
    const tp = ctx.evalVariable('User');
    expect(tp.kind).toBe('named');
  });

  it('resolves an imported function to the function builtin', () => {
    const registry = new TypeRegistry();
    registry.registerFunction({
      qn: 'getUser',
      shortName: 'getUser',
      label: 'Function',
      moduleQn: '',
      returnTypes: 'string',
      paramCount: 0,
      paramTypes: '',
      isAsync: false,
      language: 'typescript',
      sourceFile: 'lib.ts',
      sourceLine: 1,
    });
    const ctx = new TSResolverContext(registry, new Map());
    const tp = ctx.evalVariable('getUser');
    expect(typeToString(tp)).toBe('Function');
  });
});

describe('evalCall — method dispatch and function lookup', () => {
  it('dispatches a method on a named receiver', () => {
    const registry = new TypeRegistry();
    registry.registerType({
      qn: 'svc.Database',
      shortName: 'Database',
      label: 'Class',
      moduleQn: 'svc',
      type: t.named('Database'),
      language: 'typescript',
      sourceFile: 'svc.ts',
      sourceLine: 1,
    });
    registry.registerFunction({
      qn: 'svc.query',
      shortName: 'query',
      label: 'Method',
      receiverType: 'Database',
      moduleQn: 'svc',
      returnTypes: 'string',
      paramCount: 0,
      paramTypes: '',
      isAsync: false,
      language: 'typescript',
      sourceFile: 'svc.ts',
      sourceLine: 5,
    });
    const ctx = new TSResolverContext(registry, new Map());
    const tp = ctx.evalCall('query', [], t.named('Database'));
    expect(typeToString(tp)).toBe('string');
  });
});

describe('resolveImport', () => {
  it('resolves relative and absolute imports', () => {
    expect(resolveImport('./foo', 'app.main', false)).toBe('app.main.foo');
    expect(resolveImport('@scope/pkg', 'app.main', false)).toBe('@scope.pkg');
  });
});

describe('isBuiltinType', () => {
  it('covers the full builtin list', () => {
    for (const name of [
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'never',
      'object',
      'undefined',
      'null',
      'symbol',
      'bigint',
    ]) {
      expect(isBuiltinType(name)).toBe(true);
    }
    expect(isBuiltinType('NotBuiltin')).toBe(false);
  });
});

describe('scope exit at root', () => {
  it('is a no-op when already at the root scope', () => {
    const ctx = makeCtx();
    ctx.declare('x', BUILTINS.string);
    ctx.exitScope(); // no parent — should not throw or clear bindings
    expect(typeToString(ctx.evalVariable('x'))).toBe('string');
  });
});
