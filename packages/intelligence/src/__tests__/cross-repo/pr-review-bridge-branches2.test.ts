// @code-analyzer/intelligence — PR Review Bridge branch coverage (round 2):
// the discoverRelatedRepos source-repo exclusion and the buildContext
// shared-dependency intersection. Imports are read from IMPORTS edges (not a
// nonexistent "Import" node label), so a mocked indexer exposes a store whose
// IMPORTS edges carry an `importPath` property.

import { describe, it, expect, vi } from 'vitest';
import { PRReviewBridge } from '../../cross-repo/pr-review-bridge.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';
import type { CrossRepoIndexer } from '../../cross-repo/cross-repo-indexer.js';
import type { CodeReviewEngine } from '../../review/review-engine.js';

function makeGroupManager(): RepoGroupManager {
  const mgr = new RepoGroupManager();
  mgr.createGroup('test-group', 'Test Group', '');
  mgr.addRepo('test-group', 'myorg', 'service-a', 'https://github.com/myorg/service-a', '/tmp/a');
  mgr.addRepo('test-group', 'myorg', 'service-b', 'https://github.com/myorg/service-b', '/tmp/b');
  return mgr;
}

/** A minimal graph node: only the fields the bridge actually reads. */
const node = {
  id: 10,
  projectId: 'myorg/service-a',
  label: 'Function',
  name: 'fn',
  qualifiedName: 'fn()',
  filePath: 'src/a.ts',
  properties: {},
};

/** A mocked indexer whose IMPORTS edges expose a shared `react` import path. */
function makeIndexer() {
  const store = {
    getEdgesForNode: vi.fn((_nodeId: number, type?: string) => {
      if (type === 'IMPORTS') {
        return [{ properties: { importPath: 'react' } }];
      }
      return [];
    }),
  };
  return {
    getRepoNodes: vi.fn(() => [node]),
    getStore: () => store,
    analyzeCrossRepoImpact: vi.fn(async () => ({
      affectedRepos: ['myorg/service-a', 'myorg/service-b'],
      analysis: [],
    })),
    traceSymbolDependencies: vi.fn(async () => []),
  } as unknown as CrossRepoIndexer;
}

function makeBridge() {
  const indexer = makeIndexer();
  return {
    bridge: new PRReviewBridge(indexer, makeGroupManager(), {} as CodeReviewEngine),
    indexer,
  };
}

describe('PRReviewBridge — discoverRelatedRepos source-repo exclusion', () => {
  it('filters the source repo out of the impacted repo list', async () => {
    const { bridge } = makeBridge();
    const repos = await bridge.discoverRelatedRepos('test-group', 'myorg/service-a');
    expect(repos).toEqual(['myorg/service-b']);
  });
});

describe('PRReviewBridge — buildContext shared dependencies', () => {
  it('computes shared dependencies from IMPORTS edges across sibling repos', async () => {
    const { bridge, indexer } = makeBridge();
    const context = await bridge.buildContext('test-group', 'myorg/service-a', []);

    expect(context.sourceRepoId).toBe('myorg/service-a');
    // Both repos import `react` via IMPORTS edges, so it surfaces as shared.
    expect(context.sharedDependencies).toContain('react');
    expect(context.relatedRepos).toEqual(['myorg/service-b']);

    // Both repos' import paths were collected through the store.
    const store = (
      indexer as unknown as { getStore: () => { getEdgesForNode: unknown } }
    ).getStore();
    expect(vi.mocked(store.getEdgesForNode)).toHaveBeenCalledWith(10, 'IMPORTS');
  });
});

/** An indexer whose IMPORTS edges vary per repo (keyed by node id). */
function makeIndexerWithImportPaths(importPaths: Array<{ repoId: string; path: unknown }>) {
  const nodeIdByRepo = new Map([
    ['myorg/service-a', 10],
    ['myorg/service-b', 20],
    ['myorg/service-c', 30],
  ]);
  const store = {
    getEdgesForNode: vi.fn((nodeId: number, type?: string) => {
      if (type !== 'IMPORTS') return [];
      const repoId = [...nodeIdByRepo.entries()].find(([, id]) => id === nodeId)?.[0];
      return importPaths
        .filter((p) => p.repoId === repoId)
        .map((p) => ({ properties: { importPath: p.path } }));
    }),
  };
  return {
    getRepoNodes: vi.fn((repoId: string) => {
      const id = nodeIdByRepo.get(repoId);
      return id ? [{ ...node, id }] : [];
    }),
    getStore: () => store,
    analyzeCrossRepoImpact: vi.fn(async () => ({ affectedRepos: [], analysis: [] })),
    traceSymbolDependencies: vi.fn(async () => []),
  } as unknown as CrossRepoIndexer;
}

function makeGroupManagerThreeRepos(): RepoGroupManager {
  const mgr = new RepoGroupManager();
  mgr.createGroup('test-group', 'Test Group', '');
  mgr.addRepo('test-group', 'myorg', 'service-a', 'https://github.com/myorg/service-a', '/tmp/a');
  mgr.addRepo('test-group', 'myorg', 'service-b', 'https://github.com/myorg/service-b', '/tmp/b');
  mgr.addRepo('test-group', 'myorg', 'service-c', 'https://github.com/myorg/service-c', '/tmp/c');
  return mgr;
}

describe('PRReviewBridge — buildContext with a missing group', () => {
  it('leaves sharedDependencies empty when getGroup returns null', async () => {
    const { bridge } = makeBridge();
    const context = await bridge.buildContext('nonexistent-group', 'myorg/service-a', []);
    expect(context.sharedDependencies).toEqual([]);
  });
});

describe('PRReviewBridge — shared-dependency false path', () => {
  it('excludes a source import the sibling repo does not import', async () => {
    const indexer = makeIndexerWithImportPaths([
      { repoId: 'myorg/service-a', path: 'react' },
      { repoId: 'myorg/service-b', path: 'vue' },
    ]);
    const bridge = new PRReviewBridge(indexer, makeGroupManager(), {} as CodeReviewEngine);
    const context = await bridge.buildContext('test-group', 'myorg/service-a', []);
    expect(context.sharedDependencies).not.toContain('react');
  });

  it('deduplicates an import shared by multiple sibling repos', async () => {
    const indexer = makeIndexerWithImportPaths([
      { repoId: 'myorg/service-a', path: 'react' },
      { repoId: 'myorg/service-b', path: 'react' },
      { repoId: 'myorg/service-c', path: 'react' },
    ]);
    const bridge = new PRReviewBridge(
      indexer,
      makeGroupManagerThreeRepos(),
      {} as CodeReviewEngine,
    );
    const context = await bridge.buildContext('test-group', 'myorg/service-a', []);
    expect(context.sharedDependencies).toEqual(['react']);
  });
});

describe('PRReviewBridge — non-string importPath', () => {
  it('excludes import paths that are not non-empty strings', async () => {
    const indexer = makeIndexerWithImportPaths([
      { repoId: 'myorg/service-a', path: 123 },
      { repoId: 'myorg/service-b', path: '' },
    ]);
    const bridge = new PRReviewBridge(indexer, makeGroupManager(), {} as CodeReviewEngine);
    const context = await bridge.buildContext('test-group', 'myorg/service-a', []);
    expect(context.sharedDependencies).toEqual([]);
  });
});
