import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ScanPhase } from '../pipeline/phases/scan.js';
import { GraphBuilder } from '../graph/graph-builder.js';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { PipelineContext, CodeAnalyzerConfig } from '@code-analyzer/shared';

function makeConfig(projectId: string, rootPath: string): CodeAnalyzerConfig {
  return {
    projectId,
    rootPath,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 1024 * 1024,
    maxFiles: 1000,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

describe('ScanPhase — graph population branches', () => {
  let rootPath: string;

  beforeEach(() => {
    rootPath = join(tmpdir(), `scan-test-${randomUUID()}`);
    mkdirSync(join(rootPath, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  function makeCtx(withGraph: boolean): PipelineContext {
    const ctx: PipelineContext = {
      projectId: 'test-proj',
      rootPath,
      phaseData: new Map(),
      config: makeConfig('test-proj', rootPath),
    };
    if (withGraph) {
      const store = new InMemoryGraphStore();
      ctx.graph = new GraphBuilder(store).build(ctx);
    }
    return ctx;
  }

  it('scans successfully without a graph', async () => {
    writeFileSync(join(rootPath, 'src', 'a.ts'), 'export const a = 1;\n');
    const ctx = makeCtx(false);
    const result = await new ScanPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect((result.output as { filesDiscovered: number }).filesDiscovered).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('populates the graph for a root-level file with no directory', async () => {
    writeFileSync(join(rootPath, 'a.ts'), 'export const a = 1;\n');
    const ctx = makeCtx(true);
    const result = await new ScanPhase().execute(ctx);
    expect(result.status).toBe('success');
    const fileNodes = Array.from(ctx.graph!.nodes.values()).filter((n) => n.label === 'File');
    expect(fileNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('skips folder edges when the folder path is absent from the graph index', async () => {
    writeFileSync(join(rootPath, 'a.ts'), 'export const a = 1;\n');
    // Manually build a graph whose fileIndex is empty (no root folder node),
    // so currentFolderId resolves to undefined and both CONTAINS-edge blocks
    // are skipped.
    const ctx: PipelineContext = {
      projectId: 'test-proj',
      rootPath,
      phaseData: new Map(),
      config: makeConfig('test-proj', rootPath),
      graph: {
        projectId: 'test-proj',
        nodes: new Map(),
        edges: new Map(),
        qnameIndex: new Map(),
        fileIndex: new Map(),
      },
    };
    const result = await new ScanPhase().execute(ctx);
    expect(result.status).toBe('success');
    expect(ctx.graph!.edges.size).toBe(0);
  });

  it('returns failed when the root path is a regular file', async () => {
    const filePath = join(rootPath, 'not-a-dir.txt');
    writeFileSync(filePath, 'hello');
    const ctx: PipelineContext = {
      projectId: 'test-proj',
      rootPath: filePath,
      phaseData: new Map(),
      config: makeConfig('test-proj', filePath),
      graph: undefined,
    };
    const result = await new ScanPhase().execute(ctx);
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });
});
