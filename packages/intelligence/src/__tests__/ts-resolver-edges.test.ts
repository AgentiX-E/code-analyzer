// @code-analyzer/intelligence — TS resolver edge branches: import-resolved
// function, generic argument binding, and field access.

import { describe, it, expect } from 'vitest';
import { TSResolverContext } from '../lsp/ts-resolver.js';
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
  // A function reachable only through the import map (no type of this name).
  registry.registerFunction({
    qn: 'lib.fetchUser',
    shortName: 'fetchUser',
    label: 'Function',
    moduleQn: 'lib',
    returnTypes: 'T',
    paramCount: 1,
    paramTypes: 'T',
    isAsync: false,
    language: 'typescript',
    sourceFile: 'lib.ts',
    sourceLine: 10,
  });
  const importMap = new Map<string, string>([['fetchUser', 'lib']]);
  return new TSResolverContext(registry, importMap, false, 'test.ts');
}

describe('TSResolverContext — literal and import fallbacks', () => {
  const ctx = makeCtx();

  it('resolves an import-mapped function name to the function builtin', () => {
    // `fetchUser` is in the import map but only a function exists at lib.fetchUser.
    expect(typeToString(ctx.evalVariable('fetchUser'))).toBe('Function');
  });
});

describe('TSResolverContext — call and generic binding', () => {
  it('resolves a function by short name and binds its generic parameter', () => {
    const ctx = makeCtx();
    // fetchUser has paramTypes 'T' and returnTypes 'T'; binding T = string.
    const ret = ctx.evalCall('fetchUser', [BUILTINS.string]);
    expect(typeToString(ret)).toBe('string');
  });
});

describe('TSResolverContext — member access field resolution', () => {
  it('resolves a field type from a named receiver with fieldDefs', () => {
    const ctx = makeCtx();
    const idType = ctx.evalMemberAccess(t.named('lib.User'), 'id');
    expect(typeToString(idType)).toBe('number');
  });

  it('returns unknown for an unknown field on a named receiver', () => {
    const ctx = makeCtx();
    const methodType = ctx.evalMemberAccess(t.named('lib.User'), 'unknownField');
    expect(methodType).toBe(BUILTINS.unknown);
  });
});
