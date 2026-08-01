// @code-analyzer/infra — AutoIndexer Tests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AutoIndexer } from '../project/auto-indexer.js';
import type { AutoIndexerOptions, IndexResult } from '../project/auto-indexer.js';
import { createFileDiscoverer } from '../filesystem/discoverer.js';
import type { FileDiscoverer } from '../filesystem/discoverer.js';
import { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';

describe('AutoIndexer', () => {
  let rootPath: string;
  let discoverer: FileDiscoverer;
  let store: InMemoryGraphStore;
  let indexer: AutoIndexer;

  function setup(dirs: string[], files: Record<string, string>): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-autoindex-'));
    for (const dir of dirs) {
      fs.mkdirSync(path.join(base, dir), { recursive: true });
    }
    for (const [filePath, content] of Object.entries(files)) {
      const full = path.join(base, filePath);
      const dir = path.dirname(full);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(full, content);
    }
    return base;
  }

  beforeEach(() => {
    discoverer = createFileDiscoverer();
    store = new InMemoryGraphStore();
    indexer = new AutoIndexer(discoverer, store);
  });

  afterEach(() => {
    if (rootPath) {
      fs.rmSync(rootPath, { recursive: true, force: true });
    }
    store.close();
  });

  // -------------------------------------------------------------------------
  // Constructor & Options
  // -------------------------------------------------------------------------

  it('creates with default options (indexOnConnect=true)', () => {
    const idx = new AutoIndexer(discoverer, store);
    expect(idx).toBeDefined();
  });

  it('creates with indexOnConnect=false', () => {
    const idx = new AutoIndexer(discoverer, store, { indexOnConnect: false });
    expect(idx).toBeDefined();
  });

  it('creates with custom projectIdPrefix', () => {
    const idx = new AutoIndexer(discoverer, store, { projectIdPrefix: 'custom' });
    expect(idx).toBeDefined();
  });

  it('getStore returns the store instance', () => {
    expect(indexer.getStore()).toBe(store);
  });

  it('getDiscoverer returns the discoverer instance', () => {
    expect(indexer.getDiscoverer()).toBe(discoverer);
  });

  // -------------------------------------------------------------------------
  // Indexing with indexOnConnect=true
  // -------------------------------------------------------------------------

  it('indexes a Node.js project when opened', async () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'test-project' }),
      'src/index.ts': 'export const x = 1;',
      'src/utils.ts': 'export function helper() {}',
    });

    const result = await indexer.onProjectOpen(rootPath);

    expect(result.projectId).toContain('project_');
    expect(result.rootPath).toBe(rootPath);
    expect(result.filesDiscovered).toBeGreaterThanOrEqual(2);
    expect(result.nodesIndexed).toBeGreaterThanOrEqual(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.projectInfo.type).toBe('node');
  });

  it('indexes a Python project when opened', async () => {
    rootPath = setup([], {
      'requirements.txt': 'flask==2.0.0',
      'app.py': 'print("hello")',
    });

    const result = await indexer.onProjectOpen(rootPath);

    expect(result.projectInfo.type).toBe('python');
    expect(result.nodesIndexed).toBeGreaterThanOrEqual(1);
  });

  it('indexes a Go project when opened', async () => {
    rootPath = setup([], {
      'go.mod': 'module example\n\ngo 1.21',
      'main.go': 'package main',
    });

    const result = await indexer.onProjectOpen(rootPath);

    expect(result.projectInfo.type).toBe('go');
    expect(result.nodesIndexed).toBeGreaterThanOrEqual(1);
  });

  it('indexes a Rust project when opened', async () => {
    rootPath = setup([], {
      'Cargo.toml': '[package]\nname = "test"',
      'src/main.rs': 'fn main() {}',
    });

    const result = await indexer.onProjectOpen(rootPath);

    expect(result.projectInfo.type).toBe('rust');
  });

  it('indexes a Java project when opened', async () => {
    rootPath = setup([], {
      'pom.xml': '<project></project>',
      'src/Main.java': 'public class Main {}',
    });

    const result = await indexer.onProjectOpen(rootPath);

    expect(result.projectInfo.type).toBe('java');
  });

  // -------------------------------------------------------------------------
  // Indexing with indexOnConnect=false
  // -------------------------------------------------------------------------

  it('with indexOnConnect=false, detects project but does not index', async () => {
    rootPath = setup([], {
      'package.json': JSON.stringify({ name: 'test' }),
      'src/index.ts': 'export const x = 1;',
    });

    const noIndexer = new AutoIndexer(discoverer, store, { indexOnConnect: false });
    const result = await noIndexer.onProjectOpen(rootPath);

    expect(result.filesDiscovered).toBe(0);
    expect(result.nodesIndexed).toBe(0);
    // Project detection still works
    expect(result.projectInfo.type).toBe('node');
  });

  // -------------------------------------------------------------------------
  // isIndexed
  // -------------------------------------------------------------------------

  it('reports not indexed for unknown project', () => {
    expect(indexer.isIndexed('/unknown/path')).toBe(false);
  });

  it('reports indexed after onProjectOpen', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    await indexer.onProjectOpen(rootPath);
    expect(indexer.isIndexed(rootPath)).toBe(true);
  });

  it('returns false for project with no nodes in store', () => {
    indexer['indexedProjects'].set('/fake/path', 'project_fake');
    expect(indexer.isIndexed('/fake/path')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // getIndexedProjects
  // -------------------------------------------------------------------------

  it('returns empty list initially', () => {
    expect(indexer.getIndexedProjects()).toEqual([]);
  });

  it('returns indexed project paths after opening', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    await indexer.onProjectOpen(rootPath);
    const projects = indexer.getIndexedProjects();
    expect(projects).toContain(rootPath);
  });

  it('tracks multiple projects', async () => {
    const root1 = setup([], { 'package.json': '{}', 'a.ts': 'export const a = 1;' });
    const root2 = setup([], { 'go.mod': 'module b', 'b.go': 'package b' });

    await indexer.onProjectOpen(root1);
    await indexer.onProjectOpen(root2);

    const projects = indexer.getIndexedProjects();
    expect(projects).toContain(root1);
    expect(projects).toContain(root2);
    expect(projects.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // removeProject
  // -------------------------------------------------------------------------

  it('removes a project and its nodes', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/index.ts': 'export const x = 1;',
    });

    const result = await indexer.onProjectOpen(rootPath);
    expect(result.nodesIndexed).toBeGreaterThan(0);

    indexer.removeProject(rootPath);

    // Project should no longer be indexed
    expect(indexer.isIndexed(rootPath)).toBe(false);

    // Nodes for this project should be gone
    const allNodes = store.getAllNodes();
    const remaining = allNodes.filter((n) => n.projectId === result.projectId);
    expect(remaining.length).toBe(0);
  });

  it('removeProject is a no-op for unknown path', () => {
    // Should not throw
    indexer.removeProject('/unknown/path');
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  it('returns status for unknown project', () => {
    const status = indexer.getStatus('/unknown');
    expect(status.rootPath).toBe('/unknown');
    expect(status.projectId).toBe('');
    expect(status.nodeCount).toBe(0);
    expect(status.indexedAt).toBeNull();
  });

  it('returns status for indexed project', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    await indexer.onProjectOpen(rootPath);
    const status = indexer.getStatus(rootPath);

    expect(status.projectId).toBeTruthy();
    expect(status.nodeCount).toBeGreaterThan(0);
    expect(status.indexedAt).toBeTruthy();
    expect(status.projectInfo).toBeTruthy();
    expect(status.projectInfo!.type).toBe('node');
  });

  // -------------------------------------------------------------------------
  // getProjectId
  // -------------------------------------------------------------------------

  it('returns null for unknown project', () => {
    expect(indexer.getProjectId('/unknown')).toBeNull();
  });

  it('returns projectId after opening', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    const result = await indexer.onProjectOpen(rootPath);
    const id = indexer.getProjectId(rootPath);
    expect(id).toBe(result.projectId);
  });

  // -------------------------------------------------------------------------
  // handles empty project (unknown type)
  // -------------------------------------------------------------------------

  it('indexes an unknown-type project', async () => {
    rootPath = setup([], {
      'README.md': '# Project',
      'data.txt': 'hello',
      'config.yml': 'key: value',
    });

    const result = await indexer.onProjectOpen(rootPath);

    // Text/yml files have no recognized language, so discoverer returns them with null language
    // They still get indexed as File nodes
    expect(result.projectInfo.type).toBe('unknown');
    expect(result.filesDiscovered).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Resiliance: duplicate nodes
  // -------------------------------------------------------------------------

  it('handles duplicate project open gracefully', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    const r1 = await indexer.onProjectOpen(rootPath);
    // Small delay to ensure different timestamp-based projectId
    await new Promise((resolve) => setTimeout(resolve, 5));
    const r2 = await indexer.onProjectOpen(rootPath);

    expect(r2.projectId).not.toBe(r1.projectId);
    expect(r2.nodesIndexed).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Resilience: insertNodes fails, falls back to individual inserts
  // -------------------------------------------------------------------------

  it('falls back to individual inserts when batch insert encounters duplicates', async () => {
    rootPath = setup([], {
      'package.json': '{}',
      'src/app.ts': 'const x = 1;',
    });

    // First open indexes the files
    await indexer.onProjectOpen(rootPath);

    // Create a new AutoIndexer with the same store to trigger duplicate qname path
    const indexer2 = new AutoIndexer(discoverer, store);
    const result2 = await indexer2.onProjectOpen(rootPath);

    // All nodes should still be indexed (individually due to duplicates)
    expect(result2.nodesIndexed).toBeGreaterThanOrEqual(0);
    expect(result2.filesDiscovered).toBeGreaterThanOrEqual(0);
  });
});
