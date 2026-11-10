import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { GraphBuilder } from '../graph/graph-builder.js';
import { ScanPhase } from '../pipeline/phases/scan.js';

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
    // **`mkdtempSync` rather than a name built from a uuid**, because the create is atomic: a name that is chosen and
    // then created is a name another process can take between the two steps, and **the alert this fixes is about the
    // window, not about the randomness.** The path is still different on every run, which is what the scenarios need.
    rootPath = mkdtempSync(join(tmpdir(), 'scan-test-'));
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

// **The scope the configuration states and the pipeline used to ignore.**
//
// `includePatterns` has been in the schema, in the loader, in the validator and in `docs/CONFIGURATION.md` since the
// configuration was written, and every phase discovered the repository the excludes left behind. These two cases pin
// the wiring at the phase, which is the only place that can go wrong: the matcher has its own suite, the walk has
// its own, and what was missing was a caller.
describe('ScanPhase — the include list', () => {
  let rootPath: string;

  beforeEach(() => {
    // **Atomically created.** A uuid is unguessable but the create is still two steps - choose a name, then make the
    // directory - and `mkdtempSync` is one.
    rootPath = mkdtempSync(join(tmpdir(), 'scan-include-'));
    mkdirSync(join(rootPath, 'kotlin'), { recursive: true });
    mkdirSync(join(rootPath, 'java'), { recursive: true });
    writeFileSync(join(rootPath, 'kotlin', 'A.kt'), 'class A\n');
    writeFileSync(join(rootPath, 'java', 'B.java'), 'class B {}\n');
    writeFileSync(join(rootPath, 'Root.kt'), 'class Root\n');
  });

  afterEach(() => {
    rmSync(rootPath, { recursive: true, force: true });
  });

  function context(includePatterns: string[]): PipelineContext {
    return {
      projectId: 'test-proj',
      rootPath,
      phaseData: new Map(),
      config: { ...makeConfig('test-proj', rootPath), includePatterns },
      graph: undefined,
    };
  }

  it('discovers only the files the list admits, and leaves the rest out of the graph', async () => {
    const ctx = context(['**/*.kt']);
    ctx.graph = new GraphBuilder(new InMemoryGraphStore()).build(ctx);

    const result = await new ScanPhase().execute(ctx);

    expect(result.status).toBe('success');
    const discovered = (ctx.phaseData.get('scan') as { files: { filePath: string }[] }).files;
    expect(discovered.map((file) => file.filePath.split('/').pop()).sort()).toEqual([
      'A.kt',
      'Root.kt',
    ]);
    // **The graph is the same universe as the walk**, because a File node for a file the analysis never read is a
    // node with no declarations behind it - which is exactly what a caller of `search` would then rank.
    const names = [...ctx.graph.nodes.values()]
      .filter((node) => node.label === 'File')
      .map((node) => String(node.properties['name']))
      .sort();
    expect(names).toEqual(['A.kt', 'Root.kt']);
  });

  it('discovers everything when the list is empty', async () => {
    const ctx = context([]);
    await new ScanPhase().execute(ctx);
    const discovered = (ctx.phaseData.get('scan') as { files: { filePath: string }[] }).files;
    expect(discovered).toHaveLength(3);
  });
});
