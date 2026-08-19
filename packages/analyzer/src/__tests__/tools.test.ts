import { describe, it, expect } from 'vitest';
import { ToolsPhase } from '../pipeline/phases/tools.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { PipelineContext, CodeAnalyzerConfig, DiscoveredFile } from '@code-analyzer/shared';

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

function makeFile(filePath: string, content: string): DiscoveredFile {
  return { filePath, language: 'typescript', content, hash: 'abc', size: content.length };
}

function makeCtx(files: DiscoveredFile[], store: InMemoryGraphStore): PipelineContext {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map([['scan', { discoveredFiles: files }]]),
    config: makeConfig(),
    graph: store as unknown as PipelineContext['graph'],
  };
}

const TOOL = "registerCommand('search_code');\n";

describe('ToolsPhase — defensive branches', () => {
  it('creates a tool node without a HANDLES_TOOL edge when the file is unindexed', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([makeFile('/proj/a.ts', TOOL)], store);
    const result = await new ToolsPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { toolsFound: number }).toolsFound).toBeGreaterThanOrEqual(1);
    // No file index entry, so no edge should be created.
    expect(store.edges.size).toBe(0);
  });

  it('reports a non-Error exception during execution', async () => {
    const store = new InMemoryGraphStore();
    const ctx = makeCtx([], store);
    ctx.phaseData.set('scan', {
      get discoveredFiles(): DiscoveredFile[] {
        throw 'boom';
      },
    });
    const result = await new ToolsPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
