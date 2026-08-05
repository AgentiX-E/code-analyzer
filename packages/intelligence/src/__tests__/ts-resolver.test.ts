// @code-analyzer/intelligence — TS LSP Resolver Tests

import { describe, it, expect, beforeEach } from 'vitest';
import { TSResolverContext, resolveImport, isBuiltinType } from '../lsp/ts-resolver.js';
import { TypeRegistry, buildProjectRegistry, createPerFileOverlay } from '../lsp/type-registry.js';
import { t, typeToString, BUILTINS } from '../lsp/type-rep.js';
import type { FileDefinition, FileImport } from '../lsp/type-registry.js';

describe('TSResolverContext', () => {
  let ctx: TSResolverContext;

  const registryDefs: FileDefinition[] = [
    {
      qn: 'lib.types.User', shortName: 'User', label: 'Class', moduleQn: 'lib.types',
      resolvedType: t.objectLiteral([
        t.prop('id', t.named('number', true)),
        t.prop('name', t.named('string', true)),
        t.prop('email', t.named('string', true)),
      ]),
      language: 'typescript', sourceFile: 'lib/types.ts', sourceLine: 1,
    },
    {
      qn: 'lib.types.createUser', shortName: 'createUser', label: 'Function',
      moduleQn: 'lib.types', returnTypes: 'lib.types.User', paramCount: 2,
      paramTypes: 'string|string', isAsync: false,
      language: 'typescript', sourceFile: 'lib/types.ts', sourceLine: 10,
    },
    {
      qn: 'services.db.query', shortName: 'query', label: 'Method',
      moduleQn: 'services.db', returnTypes: 'unknown', paramCount: 1,
      paramTypes: 'string', isAsync: true,
      language: 'typescript', sourceFile: 'services/db.ts', sourceLine: 5,
    },
    {
      qn: 'services.db.Database', shortName: 'Database', label: 'Class',
      moduleQn: 'services.db', resolvedType: t.named('Database'),
      language: 'typescript', sourceFile: 'services/db.ts', sourceLine: 3,
    },
  ];

  const imports: FileImport[] = [
    { localName: 'User', moduleQn: 'lib.types', isDefault: false, isNamespace: false },
    { localName: 'createUser', moduleQn: 'lib.types', isDefault: false, isNamespace: false },
  ];

  beforeEach(() => {
    const base = buildProjectRegistry(registryDefs);
    const { overlay, importMap } = createPerFileOverlay(base, [], imports);
    ctx = new TSResolverContext(overlay, importMap);
  });

  describe('Lexical scope', () => {
    it('declares and resolves variables', () => {
      ctx.declare('x', BUILTINS.string);
      const resolved = ctx.evalVariable('x');
      expect(typeToString(resolved)).toBe('string');
    });

    it('nested scopes shadow outer bindings', () => {
      ctx.declare('x', BUILTINS.string);
      ctx.enterScope();
      ctx.declare('x', BUILTINS.number);
      expect(typeToString(ctx.evalVariable('x'))).toBe('number');
      ctx.exitScope();
      expect(typeToString(ctx.evalVariable('x'))).toBe('string');
    });

    it('unresolved variable returns any', () => {
      const t = ctx.evalVariable('nonexistent');
      expect(typeToString(t)).toBe('any');
    });
  });

  describe('Literal evaluation', () => {
    it('string literal', () => expect(typeToString(ctx.evalLiteral('hello'))).toBe('string'));
    it('number literal', () => expect(typeToString(ctx.evalLiteral(42))).toBe('number'));
    it('boolean literal', () => expect(typeToString(ctx.evalLiteral(true))).toBe('boolean'));
    it('null literal', () => expect(typeToString(ctx.evalLiteral(null))).toBe('null'));
    it('undefined literal', () => expect(typeToString(ctx.evalLiteral(undefined))).toBe('undefined'));
  });

  describe('Import resolution', () => {
    it('resolves imported type', () => {
      const userType = ctx.evalVariable('User');
      expect(userType.kind).toBe('objectLiteral');
    });

    it('resolveImport computes module QN', () => {
      expect(resolveImport('./foo', 'app.main', false)).toBe('app.main.foo');
      expect(resolveImport('../lib/utils', 'app.components.widget', false)).toBe('app.components.lib.utils');
    });
  });

  describe('Type resolution', () => {
    it('resolves builtin types', () => {
      expect(typeToString(ctx.resolveTypeName('string'))).toBe('string');
      expect(typeToString(ctx.resolveTypeName('number'))).toBe('number');
      expect(typeToString(ctx.resolveTypeName('void'))).toBe('void');
      expect(typeToString(ctx.resolveTypeName('unknown'))).toBe('unknown');
    });

    it('resolves generic types', () => {
      const tp = ctx.resolveTypeName('Array<string>');
      expect(tp.kind).toBe('template');
    });

    it('resolves union types from annotation', () => {
      const tp = ctx.parseTypeAnnotation('string | number');
      expect(tp.kind).toBe('union');
    });

    it('resolves array types', () => {
      const tp = ctx.parseTypeAnnotation('string[]');
      expect(tp.kind).toBe('array');
    });

    it('resolves Promise types', () => {
      const tp = ctx.parseTypeAnnotation('Promise<number>');
      expect(tp.kind).toBe('promise');
    });

    it('resolves function types', () => {
      const tp = ctx.parseTypeAnnotation('(a: string, b: number) => boolean');
      expect(tp.kind).toBe('func');
      if (tp.kind === 'func') {
        expect(tp.params.length).toBe(2);
        expect(typeToString(tp.returnType)).toBe('boolean');
      }
    });

    it('resolves object literal types', () => {
      const tp = ctx.parseTypeAnnotation('{ name: string; age: number }');
      expect(tp.kind).toBe('objectLiteral');
    });

    it('isBuiltinType identifies builtins', () => {
      expect(isBuiltinType('string')).toBe(true);
      expect(isBuiltinType('number')).toBe(true);
      expect(isBuiltinType('MyCustomType')).toBe(false);
    });
  });

  describe('Generic inference', () => {
    it('binds and substitutes generic parameters', () => {
      ctx.bindGeneric('T', BUILTINS.string);
      const param = t.typeParam('T');
      const result = ctx.substituteGenerics(param);
      expect(typeToString(result)).toBe('string');
    });

    it('substitutes generics in template types', () => {
      ctx.bindGeneric('T', BUILTINS.number);
      const templ = t.template(t.named('Array'), t.typeParam('T'));
      const result = ctx.substituteGenerics(templ);
      expect(typeToString(result)).toBe('Array<number>');
    });

    it('unbound generic falls back to constraint or unknown', () => {
      const param = t.typeParam('U');
      const result = ctx.substituteGenerics(param);
      expect(typeToString(result)).toBe('unknown');
    });
  });

  describe('Call evaluation', () => {
    it('evaluates call to registered function', () => {
      const returnType = ctx.evalCall('createUser', [BUILTINS.string, BUILTINS.string]);
      expect(returnType.kind).toBe('objectLiteral');
    });

    it('resolves method dispatch on receiver type', () => {
      const dbType = t.named('Database');
      const returnType = ctx.evalCall('query', [BUILTINS.string], dbType);
      // Promise<unknown> — async method
      expect(returnType.kind).toBe('promise');
    });
  });

  describe('Member access', () => {
    it('resolves field on registered type', () => {
      const userType = ctx.evalVariable('User');
      const nameType = ctx.evalMemberAccess(userType, 'name');
      expect(typeToString(nameType)).toBe('string');
    });

    it('resolves nested member access', () => {
      const userType = ctx.evalVariable('User');
      const idType = ctx.evalMemberAccess(userType, 'id');
      expect(typeToString(idType)).toBe('number');
    });

    it('unresolved member returns unknown', () => {
      const userType = ctx.evalVariable('User');
      const nonExistent = ctx.evalMemberAccess(userType, 'password');
      expect(typeToString(nonExistent)).toBe('unknown');
    });
  });

  describe('JSDoc mode', () => {
    it('parses JSDoc types in jsMode', () => {
      const jsCtx = new TSResolverContext(
        new TypeRegistry(), new Map(), true, 'test.js',
      );
      const tp = jsCtx.evalJSDocType('string');
      expect(typeToString(tp)).toBe('string');
    });

    it('returns unknown for JSDoc types in non-jsMode', () => {
      const tp = ctx.evalJSDocType('string');
      expect(typeToString(tp)).toBe('unknown');
    });
  });

  describe('JSX component resolution', () => {
    it('resolves known component type', () => {
      const tp = ctx.evalJSXComponent('User', [
        { name: 'id', value: BUILTINS.number },
        { name: 'name', value: BUILTINS.string },
      ]);
      // User is in registry
      expect(tp.kind).toBe('objectLiteral');
    });

    it('falls back to JSX.Element for unknown components', () => {
      const tp = ctx.evalJSXComponent('UnknownComponent', []);
      expect(typeToString(tp)).toBe('JSX.Element');
    });
  });

  describe('Scope management', () => {
    it('enterScope and exitScope nest correctly', () => {
      ctx.declare('global', BUILTINS.string);
      ctx.enterScope();
      ctx.declare('local', BUILTINS.number);
      expect(typeToString(ctx.evalVariable('global'))).toBe('string');
      expect(typeToString(ctx.evalVariable('local'))).toBe('number');
      ctx.exitScope();
      expect(typeToString(ctx.evalVariable('global'))).toBe('string');
      expect(typeToString(ctx.evalVariable('local'))).toBe('any');
    });
  });
});
