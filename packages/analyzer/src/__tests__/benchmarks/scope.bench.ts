// @code-analyzer/analyzer — Scope Resolution Benchmarks
// Measures symbol scope tree construction and reference resolution throughput.

import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from './harness.js';
import type { BenchmarkCase } from './harness.js';
import { ScopeResolver } from '../../../src/resolution/scope-resolver.js';
import type {
  ParsedFile,
  SymbolDefinition,
  ReferenceSite,
  SemanticModel,
} from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSyntheticFiles(count: number, symbolsPerFile: number): ParsedFile[] {
  const files: ParsedFile[] = [];

  for (let f = 0; f < count; f++) {
    const symbols: SymbolDefinition[] = [];
    const references: ReferenceSite[] = [];

    for (let s = 0; s < symbolsPerFile; s++) {
      const symIdx = f * symbolsPerFile + s;
      const isClass = s % 5 === 0;
      const kind = isClass ? 'Class' as const : 'Function' as const;
      const name = isClass ? `Class${symIdx}` : `func${symIdx}`;

      symbols.push({
        name,
        qualifiedName: `file${f}.ts:${name}`,
        kind,
        startLine: s * 20,
        endLine: s * 20 + (isClass ? 30 : 8),
        containerName: s > 0 && isClass ? `Class${symIdx - (symIdx % 5)}` : undefined,
        isExported: symIdx % 3 === 0,
        filePath: `file${f}.ts`,
        language: 'typescript',
        signature: `${name}(...args: unknown[]): unknown`,
        docstring: null,
        visibility: null,
        isStatic: false,
        isAbstract: false,
        decorators: [],
        typeParameters: [],
      });

      // Add some references
      if (symIdx > 0) {
        const targetIdx = Math.floor(symIdx * 0.7) % symIdx;
        references.push({
          sourceLine: s * 20 + 1,
          targetName: isClass ? `Class${targetIdx}` : `func${targetIdx}`,
          targetQname: `file${f}.ts:Class${targetIdx}`,
          referenceKind: 'call',
          context: 'function_body',
        });
      }
    }

    files.push({
      filePath: `file${f}.ts`,
      content: `// Generated file ${f}`,
      language: 'typescript',
      symbols,
      references,
      captures: [],
      imports: [],
      exports: symbols.filter((s) => s.isExported).map((s) => s.name),
      errors: [],
    });
  }

  return files;
}

function createSemanticModel(files: ParsedFile[]): SemanticModel {
  return {
    id: 'bench-model',
    symbols: files.flatMap((f) => f.symbols),
    references: files.flatMap((f) => f.references),
    scopes: [],
  };
}

// ---------------------------------------------------------------------------
// Benchmark Tests
// ---------------------------------------------------------------------------

describe('Scope Resolution Benchmarks', () => {
  const resolver = new ScopeResolver();

  it(
    'should build scope trees for small codebase',
    { timeout: 30_000 },
    async () => {
      const files = createSyntheticFiles(50, 10);
      const model = createSemanticModel(files);

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'build-trees-50-files',
        category: 'scope',
        warmupIterations: 3,
        iterations: 30,
        fn: async () => {
          const trees = resolver.buildScopeTrees(files);
          expect(trees.length).toBe(50);
        },
      };

      const stats = await runner.runCase(benchCase);
      expect(stats.duration.mean).toBeLessThan(20); // <20ms
      console.log(`Build scope trees (50 files × 10 symbols): mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );

  it(
    'should build scope trees for large codebase',
    { timeout: 60_000 },
    async () => {
      const files = createSyntheticFiles(500, 15);

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'build-trees-500-files',
        category: 'scope',
        warmupIterations: 2,
        iterations: 10,
        fn: async () => {
          const trees = resolver.buildScopeTrees(files);
          expect(trees.length).toBe(500);
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Build scope trees (500 files × 15 symbols): mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );

  it(
    'should resolve references efficiently',
    { timeout: 30_000 },
    async () => {
      const files = createSyntheticFiles(100, 10);
      const model = createSemanticModel(files);
      const trees = resolver.buildScopeTrees(files);

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'resolve-references-100-files',
        category: 'scope',
        warmupIterations: 3,
        iterations: 20,
        fn: async () => {
          const refs = resolver.resolveReferences(files, trees, model);
          expect(refs.length).toBeGreaterThan(0);
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Resolve references (100 files × ~9 refs/file): mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );

  it(
    'should resolve calls efficiently',
    { timeout: 30_000 },
    async () => {
      const files = createSyntheticFiles(200, 10);
      const model = createSemanticModel(files);
      const trees = resolver.buildScopeTrees(files);
      const refs = resolver.resolveReferences(files, trees, model);

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'resolve-calls-200-files',
        category: 'scope',
        warmupIterations: 3,
        iterations: 20,
        fn: async () => {
          const calls = resolver.resolveCalls(refs, model);
          expect(calls.length).toBe(refs.length);
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Resolve calls (${refs.length} refs): mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );

  it(
    'should resolve imports efficiently',
    { timeout: 30_000 },
    async () => {
      const files = createSyntheticFiles(150, 8);
      const model = createSemanticModel(files);

      const runner = new BenchmarkRunner({ verbose: false });
      const benchCase: BenchmarkCase = {
        name: 'resolve-imports-150-files',
        category: 'scope',
        warmupIterations: 3,
        iterations: 20,
        fn: async () => {
          const imports = resolver.resolveImports(files, model);
          expect(Array.isArray(imports)).toBe(true);
        },
      };

      const stats = await runner.runCase(benchCase);
      console.log(`Resolve imports (150 files): mean=${stats.duration.mean.toFixed(2)}ms`);
    },
  );
});
