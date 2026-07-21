import { describe, it, expect } from 'vitest';

import { ScopeResolver } from '../resolution/scope-resolver.js';

import type { ParsedFile, SymbolDefinition, ReferenceSite, ScopeTree, SemanticModel } from '@code-analyzer/shared';

describe('ScopeResolver', () => {
  const resolver = new ScopeResolver();

  function createSymbol(
    name: string,
    kind: SymbolDefinition['kind'],
    filePath: string,
    overrides: Partial<SymbolDefinition> = {},
  ): SymbolDefinition {
    return {
      name,
      kind,
      qualifiedName: `${filePath}::${name}`,
      startLine: 1,
      endLine: 5,
      isExported: overrides.isExported ?? false,
      containerName: overrides.containerName,
      signature: overrides.signature,
      returnType: overrides.returnType,
      docstring: overrides.docstring,
      visibility: overrides.visibility ?? 'public',
      properties: overrides.properties ?? {},
    };
  }

  function createReference(
    sourceFile: string,
    sourceLine: number,
    targetName: string,
    overrides: Partial<ReferenceSite> = {},
  ): ReferenceSite {
    return {
      sourceFile,
      sourceLine,
      sourceColumn: 1,
      targetName,
      referenceKind: overrides.referenceKind ?? 'call',
      targetQname: overrides.targetQname,
    };
  }

  function createSemanticModel(): SemanticModel {
    return {
      projectId: 'test',
      files: new Map(),
      symbolTable: new Map(),
      symbolToDefinitions: new Map(),
      unresolvedReferences: [],
    };
  }

  describe('buildScopeTrees', () => {
    it('should build a file scope tree from parsed files', () => {
      const symbols: SymbolDefinition[] = [
        createSymbol('hello', 'Function', 'test.ts'),
        createSymbol('MyClass', 'Class', 'test.ts'),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([file]);
      expect(trees).toHaveLength(1);
      expect(trees[0]!.name).toBe('test.ts');
      expect(trees[0]!.kind).toBe('File');
    });

    it('should handle nested symbols with container name', () => {
      const symbols: SymbolDefinition[] = [
        createSymbol('MyClass', 'Class', 'test.ts'),
        createSymbol('myMethod', 'Method', 'test.ts', { containerName: 'MyClass' }),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([file]);
      expect(trees).toHaveLength(1);
    });

    it('should return empty array for no files', () => {
      const trees = resolver.buildScopeTrees([]);
      expect(trees).toHaveLength(0);
    });
  });

  describe('resolveReferences', () => {
    it('should resolve same-file references', () => {
      const symbols: SymbolDefinition[] = [
        createSymbol('hello', 'Function', 'test.ts'),
      ];

      const references: ReferenceSite[] = [
        createReference('test.ts', 5, 'hello', { referenceKind: 'call' }),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols,
        references,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([file]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([file], trees, model);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.isResolved).toBe(true);
      expect(resolved[0]!.resolutionType).toBe('same-file');
      expect(resolved[0]!.targetFile).toBe('test.ts');
    });

    it('should resolve cross-file references', () => {
      const symbolsA: SymbolDefinition[] = [
        createSymbol('hello', 'Function', 'a.ts'),
      ];
      const symbolsB: SymbolDefinition[] = [
        createSymbol('world', 'Function', 'b.ts'),
      ];

      const fileA: ParsedFile = {
        filePath: 'a.ts',
        language: 'typescript',
        symbols: symbolsA,
        references: [createReference('a.ts', 5, 'world', { referenceKind: 'call' })],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const fileB: ParsedFile = {
        filePath: 'b.ts',
        language: 'typescript',
        symbols: symbolsB,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([fileA, fileB]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([fileA, fileB], trees, model);

      const unresolvedRef = resolved.find((r) => r.sourceSymbol === 'world');
      expect(unresolvedRef).toBeDefined();
    });

    it('should mark unresolved references as unresolved', () => {
      const symbols: SymbolDefinition[] = [];
      const references: ReferenceSite[] = [
        createReference('test.ts', 3, 'nonexistent', { referenceKind: 'call' }),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols,
        references,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([file]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([file], trees, model);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.isResolved).toBe(false);
      expect(resolved[0]!.resolutionType).toBe('unresolved');
    });

    it('should resolve by qualified name when available', () => {
      const symbols: SymbolDefinition[] = [
        createSymbol('hello', 'Function', 'test.ts'),
      ];

      const references: ReferenceSite[] = [
        createReference('test.ts', 5, 'hello', {
          referenceKind: 'call',
          targetQname: 'test.ts::hello',
        }),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols,
        references,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([file]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([file], trees, model);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.isResolved).toBe(true);
    });
  });

  describe('resolveCalls', () => {
    it('should convert resolved references to resolved calls', () => {
      const resolvedRefs = [
        {
          sourceFile: 'test.ts',
          sourceLine: 5,
          sourceSymbol: 'caller',
          targetFile: 'test.ts',
          targetSymbol: 'callee',
          isResolved: true,
          resolutionType: 'same-file' as const,
        },
        {
          sourceFile: 'test.ts',
          sourceLine: 10,
          sourceSymbol: 'unknown',
          targetFile: null,
          targetSymbol: null,
          isResolved: false,
          resolutionType: 'unresolved' as const,
        },
      ];

      const model = createSemanticModel();
      const calls = resolver.resolveCalls(resolvedRefs, model);

      expect(calls).toHaveLength(2);
      expect(calls[0]!.isResolved).toBe(true);
      expect(calls[0]!.calleeName).toBe('callee');
      expect(calls[1]!.isResolved).toBe(false);
    });

    it('should return empty array for empty references', () => {
      const model = createSemanticModel();
      const calls = resolver.resolveCalls([], model);
      expect(calls).toHaveLength(0);
    });
  });

  describe('resolveImports', () => {
    it('should resolve imports by matching import paths to file names', () => {
      const symbolsA: SymbolDefinition[] = [
        createSymbol('provider', 'Function', 'src/module.ts'),
      ];

      const referencesA: ReferenceSite[] = [
        createReference('src/consumer.ts', 1, './module', { referenceKind: 'import' }),
      ];

      const fileA: ParsedFile = {
        filePath: 'src/consumer.ts',
        language: 'typescript',
        symbols: [],
        references: referencesA,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const fileB: ParsedFile = {
        filePath: 'src/module.ts',
        language: 'typescript',
        symbols: symbolsA,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const model = createSemanticModel();
      const resolved = resolver.resolveImports([fileA, fileB], model);

      const moduleImport = resolved.find((r) => r.importPath === './module');
      expect(moduleImport).toBeDefined();
      expect(moduleImport!.isResolved).toBe(true);
      expect(moduleImport!.resolvedModule).toBe('src/module.ts');
    });

    it('should mark unresolvable imports as unresolved', () => {
      const references: ReferenceSite[] = [
        createReference('test.ts', 1, '@unknown/package', { referenceKind: 'import' }),
      ];

      const file: ParsedFile = {
        filePath: 'test.ts',
        language: 'typescript',
        symbols: [],
        references,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const model = createSemanticModel();
      const resolved = resolver.resolveImports([file], model);

      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.isResolved).toBe(false);
    });

    it('should resolve import by full file path', () => {
      const symbolsB: SymbolDefinition[] = [
        createSymbol('helper', 'Function', 'src/utils/helper.ts'),
      ];

      const referencesA: ReferenceSite[] = [
        createReference('src/index.ts', 1, 'src/utils/helper', { referenceKind: 'import' }),
      ];

      const fileA: ParsedFile = {
        filePath: 'src/index.ts',
        language: 'typescript',
        symbols: [],
        references: referencesA,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const fileB: ParsedFile = {
        filePath: 'src/utils/helper.ts',
        language: 'typescript',
        symbols: symbolsB,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const model = createSemanticModel();
      const resolved = resolver.resolveImports([fileA, fileB], model);

      const resolvedImport = resolved.find((r) => r.importPath === 'src/utils/helper');
      expect(resolvedImport).toBeDefined();
      expect(resolvedImport!.isResolved).toBe(true);
    });
  });

  describe('resolveReferences edge cases', () => {
    it('should handle cross-file resolution via import', () => {
      const symbolsA: SymbolDefinition[] = [
        createSymbol('myFunc', 'Function', 'a.ts', { qualifiedName: 'a.ts::myFunc' }),
      ];

      const symbolsB: SymbolDefinition[] = [
        createSymbol('myFunc', 'Function', 'b.ts', { qualifiedName: 'b.ts::myFunc' }),
      ];

      const referencesB: ReferenceSite[] = [
        createReference('b.ts', 10, 'myFunc', { referenceKind: 'call' }),
      ];

      const fileA: ParsedFile = {
        filePath: 'a.ts',
        language: 'typescript',
        symbols: symbolsA,
        references: [],
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const fileB: ParsedFile = {
        filePath: 'b.ts',
        language: 'typescript',
        symbols: symbolsB,
        references: referencesB,
        scopeTree: {} as ScopeTree,
        ast: null,
      };

      const trees = resolver.buildScopeTrees([fileA, fileB]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([fileA, fileB], trees, model);

      // reference from b.ts to myFunc should resolve to b.ts (same-file)
      const bRef = resolved.find((r) => r.sourceFile === 'b.ts' && r.sourceSymbol === 'myFunc');
      expect(bRef).toBeDefined();
      expect(bRef!.isResolved).toBe(true);
    });

    it('should mark as unresolved when multiple candidate files exist', () => {
      const symbolsA: SymbolDefinition[] = [
        createSymbol('sharedFunc', 'Function', 'a.ts'),
      ];
      const symbolsB: SymbolDefinition[] = [
        createSymbol('sharedFunc', 'Function', 'b.ts'),
      ];
      const symbolsC: SymbolDefinition[] = [];

      const referencesC: ReferenceSite[] = [
        createReference('c.ts', 5, 'sharedFunc', { referenceKind: 'call' }),
      ];

      const fileA: ParsedFile = {
        filePath: 'a.ts', language: 'typescript', symbols: symbolsA,
        references: [], scopeTree: {} as ScopeTree, ast: null,
      };
      const fileB: ParsedFile = {
        filePath: 'b.ts', language: 'typescript', symbols: symbolsB,
        references: [], scopeTree: {} as ScopeTree, ast: null,
      };
      const fileC: ParsedFile = {
        filePath: 'c.ts', language: 'typescript', symbols: symbolsC,
        references: referencesC, scopeTree: {} as ScopeTree, ast: null,
      };

      const trees = resolver.buildScopeTrees([fileA, fileB, fileC]);
      const model = createSemanticModel();
      const resolved = resolver.resolveReferences([fileA, fileB, fileC], trees, model);

      const cRef = resolved.find((r) => r.sourceFile === 'c.ts');
      expect(cRef).toBeDefined();
      // Multiple candidates → unresolved (ambiguous)
      expect(cRef!.isResolved).toBe(false);
      expect(cRef!.resolutionType).toBe('unresolved');
    });
  });
});
