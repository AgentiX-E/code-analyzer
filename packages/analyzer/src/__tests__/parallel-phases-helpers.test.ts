// @code-analyzer/analyzer — Tests for Parallel Pipeline Phases helpers
// Covers the exported pure helpers (captureTagToNodeLabel, captureTagToReferenceKind,
// groupCaptures, getOrLoadProvider, toPhaseFailure) and the three phase classes'
// error-coercion catch paths.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CAPTURE_TAGS,
  createNoopPhaseLogger,
  EDGE_CALLS,
  EDGE_DEFINES,
} from '@code-analyzer/shared';
import type {
  UnifiedCapture,
  PipelineContext,
  DiscoveredFile,
  KnowledgeGraph,
  PhaseLogger,
} from '@code-analyzer/shared';
import { InMemoryGraphStore } from '@code-analyzer/infra';

import {
  captureTagToNodeLabel,
  captureTagToReferenceKind,
  groupCaptures,
  getOrLoadProvider,
  toPhaseFailure,
  ParallelScanPhase,
  ParallelParsePhase,
  ParallelBuildPhase,
} from '../pipeline/parallel-phases.js';
import { GraphBuilder } from '../graph/graph-builder.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCapture(
  tag: UnifiedCapture['tag'],
  overrides: Partial<UnifiedCapture> = {},
): UnifiedCapture {
  return {
    tag,
    text: 'sample',
    startLine: 1,
    endLine: 1,
    startByte: 0,
    endByte: 0,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    projectId: 'test-project',
    rootPath: '/fake/project',
    phaseData: new Map(),
    config: {
      projectId: 'test-project',
      rootPath: '/fake/project',
      excludePatterns: [],
      includePatterns: [],
      maxFileSize: 1024 * 1024,
      maxFiles: 1000,
      parseWorkers: 4,
      ignorePaths: [],
    },
    ...overrides,
  };
}

/** A Map whose get() throws a non-Error value — exercises the catch coercion. */
class ThrowingMap extends Map<string, unknown> {
  override get(_key: string): unknown {
    throw 'phaseData-boom';
  }
}

function makeDiscoveredFile(overrides: Partial<DiscoveredFile> = {}): DiscoveredFile {
  return {
    filePath: '/fake/project/src/app.ts',
    language: 'typescript',
    content: 'export function hello() { return "hi"; }',
    hash: 'abc123',
    size: 100,
    ...overrides,
  };
}

function makeGraph(): KnowledgeGraph {
  return {
    projectId: 'test',
    nodes: new Map(),
    edges: new Map(),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

// ---------------------------------------------------------------------------
// captureTagToNodeLabel
// ---------------------------------------------------------------------------

describe('captureTagToNodeLabel', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_DEF, 'Function'],
    [CAPTURE_TAGS.FUNCTION_CALL, 'Function'],
    [CAPTURE_TAGS.METHOD_DEF, 'Method'],
    [CAPTURE_TAGS.METHOD_CALL, 'Method'],
    [CAPTURE_TAGS.CLASS_DEF, 'Class'],
    [CAPTURE_TAGS.INTERFACE_DEF, 'Interface'],
    [CAPTURE_TAGS.ENUM_DEF, 'Enum'],
    [CAPTURE_TAGS.TYPE_DEF, 'TypeAlias'],
    [CAPTURE_TAGS.VARIABLE_DEF, 'Variable'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'Variable'],
    [CAPTURE_TAGS.CONSTANT_DEF, 'Variable'],
    [CAPTURE_TAGS.CONSTRUCTOR_DEF, 'Constructor'],
    [CAPTURE_TAGS.PROPERTY_DEF, 'Property'],
    [CAPTURE_TAGS.STRUCT_DEF, 'Struct'],
    [CAPTURE_TAGS.TRAIT_DEF, 'Trait'],
    [CAPTURE_TAGS.ROUTE_PATH, 'Route'],
    [CAPTURE_TAGS.ROUTE_METHOD, 'Route'],
    [CAPTURE_TAGS.COMPONENT_PROPS, 'Component'],
  ];

  it.each(cases)('maps %s to %s', (tag, label) => {
    expect(captureTagToNodeLabel(tag)).toBe(label);
  });

  it('falls back to Variable for an unmapped tag', () => {
    // DECORATOR is not part of the switch, so it hits the default arm.
    expect(captureTagToNodeLabel(CAPTURE_TAGS.DECORATOR)).toBe('Variable');
    expect(captureTagToNodeLabel('unknown.tag')).toBe('Variable');
  });
});

// ---------------------------------------------------------------------------
// captureTagToReferenceKind
// ---------------------------------------------------------------------------

describe('captureTagToReferenceKind', () => {
  const cases: Array<[string, string]> = [
    [CAPTURE_TAGS.FUNCTION_CALL, 'call'],
    [CAPTURE_TAGS.METHOD_CALL, 'call'],
    [CAPTURE_TAGS.IMPORT, 'import'],
    [CAPTURE_TAGS.IMPORT_NAMED, 'import'],
    [CAPTURE_TAGS.IMPORT_DEFAULT, 'import'],
    [CAPTURE_TAGS.IMPORT_WILDCARD, 'import'],
    [CAPTURE_TAGS.TYPE_REFERENCE, 'type'],
    [CAPTURE_TAGS.VARIABLE_ACCESS, 'access'],
  ];

  it.each(cases)('maps %s to %s', (tag, kind) => {
    expect(captureTagToReferenceKind(tag)).toBe(kind);
  });

  it('falls back to call for an unmapped tag', () => {
    // NEW_EXPRESSION is not part of the reference switch, so it hits default.
    expect(captureTagToReferenceKind(CAPTURE_TAGS.NEW_EXPRESSION)).toBe('call');
    expect(captureTagToReferenceKind('unknown.tag')).toBe('call');
  });
});

// ---------------------------------------------------------------------------
// groupCaptures
// ---------------------------------------------------------------------------

describe('groupCaptures', () => {
  it('returns empty symbols/references and a default scope tree for no captures', () => {
    const { symbols, references, scopeTree } = groupCaptures([], '/app/src/a.ts');
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
    expect(scopeTree.name).toBe('a.ts');
    expect(scopeTree.kind).toBe('File');
    expect(scopeTree.startLine).toBe(1);
    expect(scopeTree.endLine).toBe(1);
    expect(scopeTree.children).toEqual([]);
    expect(scopeTree.symbols).toEqual([]);
  });

  it('converts a definition capture into a symbol (name fallback to text)', () => {
    const { symbols, references, scopeTree } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_DEF, {
          name: 'doWork',
          startLine: 10,
          endLine: 30,
          properties: { signature: 'doWork(x)', returnType: 'Result', docstring: 'Docs' },
        }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols).toHaveLength(1);
    const s = symbols[0]!;
    expect(s.name).toBe('doWork');
    expect(s.kind).toBe('Function');
    expect(s.qualifiedName).toBe('file:/app/src/a.ts:doWork');
    expect(s.startLine).toBe(10);
    expect(s.endLine).toBe(30);
    expect(s.signature).toBe('doWork(x)');
    expect(s.returnType).toBe('Result');
    expect(s.docstring).toBe('Docs');
    expect(s.isExported).toBe(false);
    expect(s.visibility).toBe('public');
    expect(references).toEqual([]);
    // scopeTree endLine is the max capture endLine.
    expect(scopeTree.endLine).toBe(30);
    expect(scopeTree.children).toHaveLength(1);
    expect(scopeTree.symbols).toEqual(['file:/app/src/a.ts:doWork']);
  });

  it('uses capture.text as the name when name is absent', () => {
    const { symbols } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.CLASS_DEF, { text: 'MyClass', endLine: 5 })],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.name).toBe('MyClass');
    expect(symbols[0]!.qualifiedName).toBe('file:/app/src/a.ts:MyClass');
  });

  it('prefixes the qualified name with containerName when present', () => {
    const { symbols } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.METHOD_DEF, {
          name: 'run',
          containerName: 'MyClass',
          endLine: 3,
        }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols[0]!.qualifiedName).toBe('MyClass.run');
    expect(symbols[0]!.containerName).toBe('MyClass');
  });

  it('converts a reference capture into a reference site', () => {
    const { symbols, references } = groupCaptures(
      [
        makeCapture(CAPTURE_TAGS.FUNCTION_CALL, { name: 'target', startLine: 7 }),
        makeCapture(CAPTURE_TAGS.TYPE_REFERENCE, { text: 'Foo' }),
      ],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toHaveLength(2);
    expect(references[0]).toEqual({
      sourceFile: '/app/src/a.ts',
      sourceLine: 7,
      sourceColumn: 0,
      targetName: 'target',
      referenceKind: 'call',
    });
    expect(references[1]!.targetName).toBe('Foo');
    expect(references[1]!.referenceKind).toBe('type');
  });

  it('ignores captures that are neither definitions nor references', () => {
    const { symbols, references } = groupCaptures(
      [makeCapture(CAPTURE_TAGS.DECORATOR, { name: 'inject' })],
      '/app/src/a.ts',
    );
    expect(symbols).toEqual([]);
    expect(references).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getOrLoadProvider
// ---------------------------------------------------------------------------

describe('getOrLoadProvider', () => {
  const languages = [
    'typescript',
    'javascript',
    'python',
    'go',
    'java',
    'kotlin',
    'csharp',
    'rust',
    'yaml',
    'json',
    'sql',
    'bash',
    'toml',
    'markdown',
    'html',
    'css',
    'r',
    'groovy',
  ];

  it('loads a provider for every supported language', async () => {
    for (const language of languages) {
      const provider = await getOrLoadProvider(language);
      expect(provider, `provider for ${language}`).not.toBeNull();
      expect(typeof provider!.parse).toBe('function');
    }
  }, 60_000);

  it('returns the same cached instance on a second load', async () => {
    const first = await getOrLoadProvider('typescript');
    const second = await getOrLoadProvider('typescript');
    expect(second).toBe(first);
  });

  it('returns null for an unknown language', async () => {
    expect(await getOrLoadProvider('nosuch-language')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// toPhaseFailure
// ---------------------------------------------------------------------------

describe('toPhaseFailure', () => {
  it('uses err.message for an Error', () => {
    const result = toPhaseFailure(new Error('boom'), 'scan', createNoopPhaseLogger());
    expect(result).toEqual({ phaseId: 'scan', status: 'failed', error: 'boom' });
  });

  it('coerces a non-Error throw to its string form', () => {
    const result = toPhaseFailure('boom', 'parse', createNoopPhaseLogger(), '/fake/project');
    expect(result).toEqual({ phaseId: 'parse', status: 'failed', error: 'boom' });
  });

  it('coerces an arbitrary object via String()', () => {
    const result = toPhaseFailure({ toString: () => 'obj' }, 'dump', createNoopPhaseLogger());
    expect(result.error).toBe('obj');
  });

  it('reports through the supplied logger without throwing', () => {
    const seen: Array<{ message: string; error: unknown; context?: unknown }> = [];
    const logger: PhaseLogger = {
      ...createNoopPhaseLogger(),
      error: (message: string, error: unknown, context?: unknown) => {
        seen.push({ message, error, context });
      },
    };
    const result = toPhaseFailure('x', 'scan', logger, '/root');
    expect(result.status).toBe('failed');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.message).toBe('Phase execution failed');
    expect(seen[0]!.error).toBeInstanceOf(Error);
    expect(seen[0]!.context).toEqual({ phaseId: 'scan', filePath: '/root' });
  });
});

// ---------------------------------------------------------------------------
// Phase class catch paths (error coercion via the public execute() API)
// ---------------------------------------------------------------------------

describe('phase error handling (catch paths)', () => {
  it('scan returns failed when config.excludePatterns is not iterable', async () => {
    const phase = new ParallelScanPhase();
    const ctx = makeCtx({
      rootPath: process.cwd(),
      config: {
        ...makeCtx().config,
        excludePatterns: null as unknown as string[],
      },
    });
    const result = await phase.execute(ctx);
    expect(result.status).toBe('failed');
    expect(typeof result.error).toBe('string');
  });

  it('parse returns failed when phaseData throws on access', async () => {
    const phase = new ParallelParsePhase();
    const ctx = makeCtx({ phaseData: new ThrowingMap() });
    const result = await phase.execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('phaseData-boom');
  });

  it('build returns failed when the graph has an orphan edge', async () => {
    const phase = new ParallelBuildPhase();
    const store = new InMemoryGraphStore();
    const builder = new GraphBuilder(store);
    const graph: KnowledgeGraph = {
      projectId: 'test',
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };
    // An edge whose endpoints do not exist in graph.nodes makes dumpToStore throw.
    builder.addEdge(graph, 999, 998, EDGE_CALLS, 'test');
    const ctx = makeCtx({ graph });
    const result = await phase.execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// Phase graph-construction branch paths
// ---------------------------------------------------------------------------

describe('phase graph construction branches', () => {
  it('parse skips a file whose language has no parallel provider', async () => {
    const phase = new ParallelParsePhase();
    const ctx = makeCtx();
    // 'c' is a supported language but is absent from the parallel phase's
    // provider map, so getOrLoadProvider returns null and the file is skipped.
    ctx.phaseData.set('scan', {
      discoveredFiles: [makeDiscoveredFile({ language: 'c', filePath: '/fake/project/src/lib.c' })],
    });

    const result = await phase.execute(ctx);
    expect(result.status).toBe('success');
    expect(result.output).toEqual({ filesParsed: 0, filesFailed: 1 });
  });

  it('parse attaches a top-level method to the file node via a DEFINES edge', async () => {
    const phase = new ParallelParsePhase();
    const rootPath = '/fake/project';
    const graph = makeGraph();
    const builder = new GraphBuilder(new InMemoryGraphStore());
    const filePath = '/fake/project/src/obj.ts';
    builder.addNode(
      graph,
      'File',
      filePath,
      { name: 'obj.ts', filePath, language: 'typescript' },
      `file:${filePath}`,
    );

    const ctx = makeCtx({ rootPath, graph });
    ctx.phaseData.set('scan', {
      discoveredFiles: [
        makeDiscoveredFile({
          filePath,
          language: 'typescript',
          content: 'const obj = { greet() { return 1; } };',
        }),
      ],
    });

    const result = await phase.execute(ctx);
    expect(result.status).toBe('success');
    // 'greet' is a method with no enclosing class, so it links to the file node.
    const definesEdges = [...graph.edges.values()].filter((e) => e.type === EDGE_DEFINES);
    expect(definesEdges.length).toBeGreaterThan(0);
  });

  it('parse skips symbol graph construction when the file node is absent', async () => {
    const phase = new ParallelParsePhase();
    const rootPath = '/fake/project';
    const graph = makeGraph(); // no File node registered
    const ctx = makeCtx({ rootPath, graph });
    ctx.phaseData.set('scan', {
      discoveredFiles: [
        makeDiscoveredFile({
          filePath: '/fake/project/src/app.ts',
          language: 'typescript',
          content: 'export function f() { return 1; }',
        }),
      ],
    });

    const result = await phase.execute(ctx);
    expect(result.status).toBe('success');
    // fileNodeId was undefined, so no symbol nodes or edges were added.
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
  });

  it('scan records File nodes with an undefined language for extensionless files', async () => {
    const phase = new ParallelScanPhase();
    const dir = mkdtempSync(join(tmpdir(), 'ca-scan-null-lang-'));
    try {
      writeFileSync(join(dir, 'script.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'Makefile'), 'all:\n\techo hi\n');

      const graph = makeGraph();
      const ctx = makeCtx({ rootPath: dir, graph });

      const result = await phase.execute(ctx);
      expect(result.status).toBe('success');

      const makefileNode = [...graph.nodes.values()].find(
        (n) => n.label === 'File' && n.name === 'Makefile',
      );
      expect(makefileNode).toBeDefined();
      expect(makefileNode!.properties.language).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
