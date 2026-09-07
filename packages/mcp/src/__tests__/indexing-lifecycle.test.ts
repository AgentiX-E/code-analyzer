// @code-analyzer/mcp — Indexing & Lifecycle Tools Tests

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from '../tools/tool-context.js';
import {
  analyzeRepository,
  analyzeRepositorySchema,
  listProjects,
  listProjectsSchema,
  deleteProject,
  deleteProjectSchema,
  indexStatus,
  indexStatusSchema,
  autoIndex,
  autoIndexSchema,
} from '../tools/indexing-lifecycle.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 0,
    projectId: 'p1',
    label: 'Function',
    name: 'foo',
    qualifiedName: 'pkg.foo',
    filePath: '/src/foo.ts',
    startLine: 1,
    endLine: 2,
    language: 'typescript',
    properties: {},
    signature: null,
    docstring: null,
    complexity: 5,
    isExported: true,
    fingerprint: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 0,
    projectId: 'p1',
    sourceId: 1,
    targetId: 2,
    type: 'CALLS',
    properties: {},
    weight: 1,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Seed a store with `count` nodes across two projects and one edge. */
function seedStore(count = 3): InMemoryGraphStore {
  const store = new InMemoryGraphStore();
  for (let i = 0; i < count; i++) {
    store.insertNode(makeNode({ name: `fn${i}`, qualifiedName: `pkg.fn${i}` }));
  }
  const a = store.insertNode(
    makeNode({ projectId: 'p2', name: 'other', qualifiedName: 'pkg.other' }),
  );
  store.insertEdge(makeEdge({ sourceId: a, targetId: a, projectId: 'p2' }));
  return store;
}

// ---------------------------------------------------------------------------
// Schema registration
// ---------------------------------------------------------------------------

describe('Indexing & Lifecycle — schemas', () => {
  it('declares required fields for each tool schema', () => {
    expect(analyzeRepositorySchema.type).toBe('object');
    expect(analyzeRepositorySchema.required).toContain('path');
    expect(analyzeRepositorySchema.properties.path).toBeDefined();

    expect(listProjectsSchema.type).toBe('object');
    expect(listProjectsSchema.properties.limit).toBeDefined();
    expect(listProjectsSchema.properties.offset).toBeDefined();

    expect(deleteProjectSchema.type).toBe('object');
    expect(deleteProjectSchema.required).toContain('projectId');

    expect(indexStatusSchema.type).toBe('object');
    expect(indexStatusSchema.required).toContain('projectId');

    expect(autoIndexSchema.type).toBe('object');
    expect(autoIndexSchema.required).toContain('path');
  });
});

// ---------------------------------------------------------------------------
// analyzeRepository
// ---------------------------------------------------------------------------

describe('analyzeRepository', () => {
  let srcDir: string;
  let emptyDir: string;

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), 'idx-lifecycle-'));
    srcDir = join(base, 'src');
    emptyDir = join(base, 'empty');
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(
      join(srcDir, 'index.ts'),
      'export function greet(name: string): string { return `hi ${name}`; }\n',
    );
  });

  afterAll(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('rejects a non-existent path', async () => {
    const result = await analyzeRepository({ path: '/definitely/not/here', projectId: 'p1' });
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('failed');
    expect(data.error).toContain('Path does not exist');
  });

  it('returns an indexing status when no store is provided', async () => {
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1' }, undefined);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('indexing');
    expect(data.projectId).toBe('p1');
  });

  it('auto-generates a projectId when none is provided', async () => {
    const result = await analyzeRepository({ path: srcDir }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.projectId).toMatch(/^project_\d+$/);
  });

  it('runs the pipeline and echoes an explicit language', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await analyzeRepository(
      { path: srcDir, projectId: 'p1', language: 'typescript' },
      ctx,
    );
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBeDefined();
    expect(data.language).toBe('typescript');
    expect(data.phaseCount).toBeGreaterThan(0);
  });

  it('reports auto-detected language when nodes are found and none specified', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.language).toBe('auto-detected');
  });

  it('reports unknown language when no nodes are found', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await analyzeRepository({ path: emptyDir, projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.language).toBe('unknown');
  });

  it('runs store-only re-index when passed a raw store with force', async () => {
    const store = seedStore(2);
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1', force: true }, store);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('re-indexed');
    expect(data.nodeCount).toBe(2);
    expect(data.language).toBe('auto-detected');
  });

  it('falls back to indexing status for a raw store without force', async () => {
    const store = seedStore(1);
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1' }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('indexing');
  });

  it('surfaces an Error from the pipeline as a failed analysis', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getPipeline = () => {
      throw new Error('pipeline boom');
    };
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('failed');
    expect(data.error).toContain('pipeline boom');
  });

  it('serializes a non-Error throw from the pipeline', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getPipeline = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain failure';
    };
    const result = await analyzeRepository({ path: srcDir, projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('plain failure');
  });
});

// ---------------------------------------------------------------------------
// listProjects
// ---------------------------------------------------------------------------

describe('listProjects', () => {
  it('returns an empty result when no store is available', async () => {
    const result = await listProjects({}, undefined);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.hasMore).toBe(false);
  });

  it('lists projects from a raw store', async () => {
    const store = seedStore(3);
    const result = await listProjects({}, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBe(2); // p1 + p2
    expect(data.items).toHaveLength(2);
    expect(data.items.every((p: { status: string }) => p.status === 'ready')).toBe(true);
  });

  it('paginates with offset and limit', async () => {
    const store = seedStore(3);
    const result = await listProjects({ limit: 1, offset: 0 }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.returned).toBe(1);
    expect(data.hasMore).toBe(true);
  });

  it('resolves the store from a ToolContext', async () => {
    const ctx = new ToolContextImpl(seedStore(2));
    const result = await listProjects({}, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.total).toBeGreaterThanOrEqual(1);
  });

  it('surfaces an Error when node listing fails', async () => {
    const store = new InMemoryGraphStore();
    store.getAllNodes = () => {
      throw new Error('nodes boom');
    };
    const result = await listProjects({}, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('nodes boom');
  });

  it('serializes a non-Error failure', async () => {
    const store = new InMemoryGraphStore();
    store.getAllNodes = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain nodes';
    };
    const result = await listProjects({}, store);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('plain nodes');
  });
});

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

describe('deleteProject', () => {
  it('deletes nodes and edges for a project from a raw store', async () => {
    const store = seedStore(3);
    const result = await deleteProject({ projectId: 'p1' }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(data.deletedNodes).toBe(3);
  });

  it('reports zero deletions when no store is available', async () => {
    const result = await deleteProject({ projectId: 'p1' }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(true);
    expect(data.deletedNodes).toBe(0);
    expect(data.deletedEdges).toBe(0);
  });

  it('deletes from a ToolContext store', async () => {
    const ctx = new ToolContextImpl(seedStore(2));
    const result = await deleteProject({ projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.deletedNodes).toBe(2);
  });

  it('surfaces an Error when deletion fails', async () => {
    const store = new InMemoryGraphStore();
    store.getAllEdges = () => {
      throw new Error('edges boom');
    };
    const result = await deleteProject({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toBe(false);
    expect(data.error).toContain('edges boom');
  });

  it('serializes a non-Error failure', async () => {
    const store = new InMemoryGraphStore();
    store.getAllEdges = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain edges';
    };
    const result = await deleteProject({ projectId: 'p1' }, store);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('plain edges');
  });
});

// ---------------------------------------------------------------------------
// indexStatus
// ---------------------------------------------------------------------------

describe('indexStatus', () => {
  it('reports ready status via ToolContext when nodes exist', async () => {
    const ctx = new ToolContextImpl(seedStore(2));
    const result = await indexStatus({ projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('ready');
    expect(data.nodeCount).toBe(2);
    expect(data.labelDistribution).toBeDefined();
  });

  it('reports empty status via ToolContext when no nodes exist', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    const result = await indexStatus({ projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('empty');
    expect(data.nodeCount).toBe(0);
  });

  it('reports status from a raw store fallback', async () => {
    const store = seedStore(3);
    const result = await indexStatus({ projectId: 'p1' }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('ready');
    expect(data.nodeCount).toBe(3);
  });

  it('reports empty status from a raw store fallback', async () => {
    const store = new InMemoryGraphStore();
    const result = await indexStatus({ projectId: 'p1' }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('empty');
  });

  it('reports integrity issues when the store has a node missing a qualified name', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(makeNode({ name: 'anonymous', qualifiedName: '' }));
    const result = await indexStatus({ projectId: 'p1' }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.issues).toBeDefined();
    expect(data.issues.length).toBeGreaterThan(0);
    expect(data.valid).toBe(false);
  });

  it('reports integrity issues via ToolContext when a node is missing a qualified name', async () => {
    const store = new InMemoryGraphStore();
    store.insertNode(makeNode({ name: 'anonymous', qualifiedName: '' }));
    const ctx = new ToolContextImpl(store);
    const result = await indexStatus({ projectId: 'p1' }, ctx);
    const data = JSON.parse(result.content[0].text);
    expect(data.issues).toBeDefined();
    expect(data.issues.length).toBeGreaterThan(0);
    expect(data.valid).toBe(false);
  });

  it('reports unknown status when no store is available', async () => {
    const result = await indexStatus({ projectId: 'p1' }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('unknown');
    expect(data.indexedAt).toBeNull();
  });

  it('surfaces an Error from graph stats', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getGraphStats = () => {
      throw new Error('stats boom');
    };
    const result = await indexStatus({ projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('error');
    expect(data.error).toContain('stats boom');
  });

  it('serializes a non-Error failure', async () => {
    const ctx = new ToolContextImpl(new InMemoryGraphStore());
    ctx.getGraphStats = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain stats';
    };
    const result = await indexStatus({ projectId: 'p1' }, ctx);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('plain stats');
  });
});

// ---------------------------------------------------------------------------
// autoIndex
// ---------------------------------------------------------------------------

describe('autoIndex', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'idx-auto-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
    writeFileSync(join(dir, 'main.ts'), 'export const answer = 42;\n');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a non-existent path', async () => {
    const result = await autoIndex({ path: '/definitely/not/here' }, new InMemoryGraphStore());
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('failed');
    expect(data.error).toContain('Path does not exist');
  });

  it('rejects when no graph store is available', async () => {
    const result = await autoIndex({ path: dir }, undefined);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.error).toContain('No graph store');
  });

  it('indexes a real project into the store', async () => {
    const store = new InMemoryGraphStore();
    const result = await autoIndex({ path: dir }, store);
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('indexed');
    expect(data.filesDiscovered).toBeGreaterThan(0);
    expect(data.type).toBeDefined();
    expect(data.languages).toBeDefined();
  });

  it('skips indexing when indexOnConnect is false', async () => {
    const store = new InMemoryGraphStore();
    const result = await autoIndex({ path: dir, indexOnConnect: false }, store);
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('indexed');
    expect(data.filesDiscovered).toBe(0);
    expect(data.nodesIndexed).toBe(0);
  });

  it('surfaces an Error from file discovery', async () => {
    const store = new InMemoryGraphStore();
    const infra = await import('@code-analyzer/infra');
    const spy = vi.spyOn(infra, 'createFileDiscoverer').mockImplementation(
      () =>
        ({
          discover: async () => {
            throw new Error('discover boom');
          },
          detectLanguage: () => null,
          matchGitignore: () => false,
        }) as never,
    );
    try {
      const result = await autoIndex({ path: dir }, store);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('discover boom');
    } finally {
      spy.mockRestore();
    }
  });

  it('serializes a non-Error discovery failure', async () => {
    const store = new InMemoryGraphStore();
    const infra = await import('@code-analyzer/infra');
    const spy = vi.spyOn(infra, 'createFileDiscoverer').mockImplementation(
      () =>
        ({
          discover: async () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw 'plain discover';
          },
          detectLanguage: () => null,
          matchGitignore: () => false,
        }) as never,
    );
    try {
      const result = await autoIndex({ path: dir }, store);
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error).toContain('plain discover');
    } finally {
      spy.mockRestore();
    }
  });
});
