import { describe, it, expect } from 'vitest';
import { ParsePhase } from '../pipeline/phases/parse.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  DiscoveredFile,
  SupportedLanguage,
} from '@code-analyzer/shared';

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

function makeFile(
  filePath: string,
  language: SupportedLanguage | null,
  content: string,
): DiscoveredFile {
  return { filePath, language, content, hash: 'abc', size: content.length };
}

function makeCtx(files: DiscoveredFile[], graph?: PipelineContext['graph']): PipelineContext {
  const ctx: PipelineContext = {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map([['scan', { discoveredFiles: files }]]),
    config: makeConfig(),
    graph,
  };
  return ctx;
}

describe('ParsePhase — defensive branches', () => {
  it('skips a discovered file with no language', async () => {
    const ctx = makeCtx([makeFile('/proj/a.txt', null, 'x')]);
    const result = await new ParsePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { filesParsed: number }).filesParsed).toBe(0);
  });

  it('parses a file without a graph', async () => {
    const ctx = makeCtx([makeFile('/proj/a.ts', 'typescript', 'export const x = 1;\n')]);
    const result = await new ParsePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { filesParsed: number }).filesParsed).toBe(1);
  });

  it('skips graph nodes when the file is absent from the file index', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx(
      [makeFile('/proj/a.ts', 'typescript', 'export const x = 1;\n')],
      store as unknown as PipelineContext['graph'],
    );
    const result = await new ParsePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { filesParsed: number }).filesParsed).toBe(1);
    expect(store.nodes.size).toBe(0);
  });

  it('links a top-level Go method to the file (no enclosing class)', async () => {
    const store = new InMemoryGraphStore();
    store.fileIndex.set('/proj/main.go', 1);
    const ctx = makeCtx(
      [
        makeFile(
          '/proj/main.go',
          'go',
          'package main\n\nfunc (s Service) Handle() error { return nil }\n',
        ),
      ],
      store as unknown as PipelineContext['graph'],
    );
    const result = await new ParsePhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { filesParsed: number }).filesParsed).toBe(1);

    const methodNodes = Array.from(store.nodes.values()).filter((n) => n.label === 'Method');
    expect(methodNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('reports a non-Error exception during execution', async () => {
    const ctx = makeCtx([]);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        throw 'boom';
      },
    });
    const result = await new ParsePhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
