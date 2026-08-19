import { describe, it, expect } from 'vitest';
import { CrossFilePhase } from '../pipeline/phases/cross-file.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CAPTURE_TAGS } from '@code-analyzer/shared';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  ParsedFile,
  DiscoveredFile,
  SupportedLanguage,
} from '@code-analyzer/shared';
import type { UnifiedCapture } from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';

function makeConfig(): CodeAnalyzerConfig {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 0,
    maxFiles: 0,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

function makeParsedFile(
  filePath: string,
  language: SupportedLanguage,
  ast: unknown = null,
): ParsedFile {
  return {
    filePath,
    language,
    symbols: [],
    references: [],
    scopeTree: {
      name: 'file',
      kind: 'Class',
      startLine: 1,
      endLine: 100,
      children: [],
      symbols: [],
    },
    ast,
  };
}

function makeDiscoveredFile(filePath: string, content: string): DiscoveredFile {
  return {
    filePath,
    language: 'typescript',
    content,
    hash: 'abc',
    size: content.length,
  };
}

function makeCapture(
  tag: string,
  name: string | undefined,
  text: string,
  properties?: Record<string, string>,
): UnifiedCapture {
  return {
    tag: tag as UnifiedCapture['tag'],
    text,
    startLine: 1,
    endLine: 1,
    startByte: 0,
    endByte: text.length,
    name,
    properties,
  };
}

function makeCtx(phaseData?: Record<string, unknown>): PipelineContext {
  const ctx: PipelineContext = {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map(Object.entries(phaseData ?? {})),
    config: makeConfig(),
    graph: new InMemoryGraphStore() as unknown as PipelineContext['graph'],
  };
  return ctx;
}

describe('CrossFilePhase — content cache and language guards', () => {
  it('skips a parsed file whose content is missing when scan data is absent', async () => {
    // No scan phase data at all: contentCache stays empty, so every parsed
    // file is skipped via the fileContent guard.
    const ctx = makeCtx({
      parse: { parsedFiles: [makeParsedFile('/proj/a.ts', 'typescript')] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });

  it('skips a parsed file whose content is missing from an empty file list', async () => {
    const ctx = makeCtx({
      parse: { parsedFiles: [makeParsedFile('/proj/a.ts', 'typescript')] },
      scan: { discoveredFiles: [] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });

  it('handles an unknown language with no provider loader', async () => {
    const parsedFile = makeParsedFile('/proj/a.ts', 'unknownlang' as unknown as SupportedLanguage);
    const ctx = makeCtx({
      parse: { parsedFiles: [parsedFile] },
      scan: { discoveredFiles: [makeDiscoveredFile('/proj/a.ts', 'x = 1\n')] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });

  it('skips the capture merge when ast is not an array', async () => {
    // ast defaults to null (a non-array) while content + language are valid,
    // so the Array.isArray(ast) guard's else path is exercised.
    const parsedFile = makeParsedFile('/proj/a.ts', 'typescript');
    const ctx = makeCtx({
      parse: { parsedFiles: [parsedFile] },
      scan: {
        discoveredFiles: [makeDiscoveredFile('/proj/a.ts', 'export const x = 1;\n')],
      },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });

  it('skips a parsed file with no language', async () => {
    const ctx = makeCtx({
      parse: {
        parsedFiles: [makeParsedFile('/proj/a.ts', '' as unknown as SupportedLanguage)],
      },
      scan: { discoveredFiles: [makeDiscoveredFile('/proj/a.ts', 'x = 1\n')] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });

  it('returns success when parse data has no parsedFiles array', async () => {
    const ctx = makeCtx({ parse: {} });
    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { crossFileDeps: number }).crossFileDeps).toBe(0);
  });
});

describe('CrossFilePhase — capture-based import merge', () => {
  it('merges AST captures when the provider extracts no imports', async () => {
    // Content with no import statements: the TypeScript provider's
    // extractImports returns [], so every AST capture flows through the
    // capture-merge path (seenSources starts empty).
    const content = 'export const x = 1;\n';
    const parsedFile = makeParsedFile('/proj/a.ts', 'typescript');
    parsedFile.ast = [
      // named import with explicit names + importType 'named'
      makeCapture(CAPTURE_TAGS.IMPORT, './named', './named', {
        names: 'a,b',
        importType: 'named',
      }),
      // namespace import (importType 'namespace')
      makeCapture(CAPTURE_TAGS.IMPORT_WILDCARD, './ns', './ns', {
        names: 'c',
        importType: 'namespace',
      }),
      // default import with no names (empty names array path)
      makeCapture(CAPTURE_TAGS.IMPORT_DEFAULT, './def', './def', {
        importType: 'default',
      }),
      // capture with no name (falls back to text) and no importType (named)
      makeCapture(CAPTURE_TAGS.IMPORT, undefined, './text', { names: 'd' }),
    ];

    const ctx = makeCtx({
      parse: { parsedFiles: [parsedFile] },
      scan: { discoveredFiles: [makeDiscoveredFile('/proj/a.ts', content)] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');

    const crossFile = ctx.phaseData.get('crossFile') as {
      resolvedImports: Array<{
        importPath: string;
        importedSymbols: string[];
        semantics: string;
      }>;
    };
    expect(crossFile.resolvedImports).toHaveLength(4);

    const byPath = new Map(crossFile.resolvedImports.map((r) => [r.importPath, r]));
    expect(byPath.get('./named')).toMatchObject({
      importedSymbols: ['a', 'b'],
      semantics: 'named',
    });
    expect(byPath.get('./ns')).toMatchObject({
      importedSymbols: ['c'],
      semantics: 'namespace',
    });
    expect(byPath.get('./def')).toMatchObject({
      importedSymbols: [],
      semantics: 'named',
    });
    expect(byPath.get('./text')).toMatchObject({
      importedSymbols: ['d'],
      semantics: 'named',
    });
  });

  it('skips capture imports already seen from the provider', async () => {
    // A content whose provider returns one import; the duplicate AST capture
    // (same source) must be skipped, exercising seenSources.has(importPath).
    const content = "import { x } from './util';\n";
    const parsedFile = makeParsedFile('/proj/a.ts', 'typescript');
    parsedFile.ast = [
      makeCapture(CAPTURE_TAGS.IMPORT_NAMED, './util', './util', {
        names: 'x',
        importType: 'named',
      }),
    ];

    const ctx = makeCtx({
      parse: { parsedFiles: [parsedFile] },
      scan: { discoveredFiles: [makeDiscoveredFile('/proj/a.ts', content)] },
    });

    await new CrossFilePhase().execute(ctx);
    const crossFile = ctx.phaseData.get('crossFile') as {
      resolvedImports: Array<{ importPath: string }>;
    };
    // Only the provider's import is recorded (capture duplicate is skipped).
    const utilImports = crossFile.resolvedImports.filter((r) => r.importPath === './util');
    expect(utilImports).toHaveLength(1);
  });

  it('skips a capture with no resolvable path', async () => {
    const content = 'export const x = 1;\n';
    const parsedFile = makeParsedFile('/proj/a.ts', 'typescript');
    parsedFile.ast = [
      // No name and empty text -> importPath is empty -> skip.
      makeCapture(CAPTURE_TAGS.IMPORT, undefined, ''),
    ];

    const ctx = makeCtx({
      parse: { parsedFiles: [parsedFile] },
      scan: { discoveredFiles: [makeDiscoveredFile('/proj/a.ts', content)] },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('success');
    const crossFile = ctx.phaseData.get('crossFile') as {
      resolvedImports: unknown[];
    };
    expect(crossFile.resolvedImports).toHaveLength(0);
  });
});

describe('CrossFilePhase — error handling', () => {
  it('reports a non-Error exception thrown during execution', async () => {
    const ctx = makeCtx();
    ctx.phaseData.set('parse', {
      get parsedFiles() {
        throw 'boom';
      },
    });

    const result = await new CrossFilePhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
