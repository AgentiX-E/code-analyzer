// The workspace indexer with the pipeline switched on: calls, imports and a census.
//
// **This file exists because the pipeline path had no unit test at all.** `pipeline: true` was exercised by one e2e
// file, and that file skips itself when four released checkouts are not on disk - so on a clean runner the branch
// that turns a workspace from "a list of files" into "a call graph" ran nowhere. The measurement that made the option
// necessary (1 201 `IMPORTS` edges and 0 `CALLS` across four checkouts) is only reproducible if the option is
// covered by something a `git clone` can run.
//
// What is asserted here is the shape of the graph a workspace gets, not the quality of the resolver: the accuracy of
// `CALLS` is gated separately against CPython's own parser (`scripts/callgraph-oracle.py`).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { EDGE_CALLS, EDGE_IMPORTS } from '@code-analyzer/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { CrossRepoIndexer, workspacePhases } from '../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';

import type { NewGraphNode } from '@code-analyzer/infra';
import type { GraphEdge } from '@code-analyzer/shared';

let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A checkout holding one TypeScript module that calls into a second one. */
function makeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'ca-pipeline-'));
  roots.push(root);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'caller.ts'),
    [
      "import { helper } from './helper';",
      '',
      'export function caller(): number {',
      '  return helper();',
      '}',
      '',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    join(root, 'src', 'helper.ts'),
    ['export function helper(): number {', '  return 1;', '}', ''].join('\n'),
    'utf-8',
  );
  return root;
}

function makeIndexer(): {
  indexer: CrossRepoIndexer;
  store: InMemoryGraphStore;
  groups: RepoGroupManager;
} {
  const store = new InMemoryGraphStore();
  const groups = new RepoGroupManager();
  groups.createGroup('g1', 'one-repo', 'a workspace of one');
  return { indexer: new CrossRepoIndexer(store, groups), store, groups };
}

/** The smallest `File` node the store accepts, for the tests that only need two endpoints. */
function fileNode(name: string): NewGraphNode {
  return {
    projectId: 'p',
    label: 'File',
    name,
    qualifiedName: `file:p:${name}`,
    filePath: name,
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    isExported: false,
    complexity: 0,
    properties: {},
  };
}

/** Every edge of one relation between the two nodes addressed by qualified name. */ function edgesBetween(
  store: InMemoryGraphStore,
  type: string,
  from: string,
  to: string,
): GraphEdge[] {
  const source = store.getAllNodes().find((node) => node.qualifiedName === from);
  const target = store.getAllNodes().find((node) => node.qualifiedName === to);
  if (!source || !target) return [];
  return store
    .getAllEdges()
    .filter(
      (edge) => edge.type === type && edge.sourceId === source.id && edge.targetId === target.id,
    );
}

describe('CrossRepoIndexer with the pipeline', () => {
  it('indexes a checkout into calls as well as imports', async () => {
    const { indexer, store } = makeIndexer();
    await indexer.indexSingleRepo('one-repo', makeCheckout(), { pipeline: true });

    // **The relation that did not exist before.** The class's own pass writes `File` nodes, symbols and named
    // imports; without the pipeline the census below has no `CALLS` key at all, which is the defect the option
    // was added for.
    const census = indexer.censusOfEdges();
    expect(census[EDGE_IMPORTS]).toBeGreaterThanOrEqual(1);
    expect(census[EDGE_CALLS]).toBeGreaterThanOrEqual(1);

    const calls = edgesBetween(
      store,
      EDGE_CALLS,
      'project:one-repo:file:src/caller.ts:caller',
      'project:one-repo:file:src/helper.ts:helper',
    );
    expect(calls).toHaveLength(1);
    // The arm is recorded on the edge, so a consumer can tell a call resolved through an import from one resolved
    // in the caller's own file - the distinction the whole resolver is built around.
    expect(calls[0]!.properties?.['resolution']).toBe('import');

    const imports = edgesBetween(
      store,
      EDGE_IMPORTS,
      'file:one-repo:src/caller.ts',
      'file:one-repo:src/helper.ts',
    );
    expect(imports).toHaveLength(1);
  });

  it('returns the census it computed, not a second opinion', async () => {
    const { indexer, store, groups } = makeIndexer();
    groups.addRepo('g1', 'agenti', 'one', 'https://example.invalid/one', makeCheckout());
    const result = await indexer.indexGroup('g1', { pipeline: true });

    // **The census is what makes "a workspace can answer this" a measurable sentence.** It is computed from the
    // store after every repository is in, so it must agree with the store and carry the call relation the pass
    // above wrote - a group whose `edgesByType` was empty while its store held edges would make a gate read zero.
    expect(result.edgesByType).toEqual(indexer.censusOfEdges());
    expect(result.edgesByType[EDGE_CALLS]).toBeGreaterThanOrEqual(1);
    expect(Object.values(result.edgesByType).reduce((sum, n) => sum + n, 0)).toBe(
      store.getEdgeCount(),
    );
  });

  it('leaves no duplicate node when the same checkout is indexed twice', async () => {
    const { indexer, store } = makeIndexer();
    const root = makeCheckout();
    await indexer.indexSingleRepo('one-repo', root, { pipeline: true });
    const first = store.getAllNodes().length;

    // **A second pass must re-use the nodes the first wrote.** The pipeline inserts into its own graph and the
    // merge hands every node back; `insertNode` refuses a qualified name it already holds, so a second pass that
    // did not look the id up would throw rather than duplicate - and either way the workspace would be unusable
    // after a re-index, which is what an incremental run does on every commit.
    await indexer.indexSingleRepo('one-repo', root, { pipeline: true });
    const nodes = store.getAllNodes();
    expect(nodes.length).toBe(first);
    const qualified = nodes.map((node) => node.qualifiedName).filter(Boolean);
    expect(new Set(qualified).size).toBe(qualified.length);
  });

  it('writes one import edge for a pair both readers resolved', async () => {
    const { indexer, store } = makeIndexer();
    await indexer.indexSingleRepo('one-repo', makeCheckout(), { pipeline: true });

    // The pipeline resolved `./helper` and this class's own path reader resolved it too. Two edges for one fact
    // would double every import count in a workspace and make an impact analysis report a fan-in of two.
    const imports = store.getAllEdges().filter((edge) => edge.type === EDGE_IMPORTS);
    const pairs = imports.map((edge) => `${String(edge.sourceId)}->${String(edge.targetId)}`);
    expect(pairs.length).toBe(new Set(pairs).size);
  });

  it('reports the census with its keys in sorted order', () => {
    const { indexer, store } = makeIndexer();
    // Two relations inserted in reverse order, so insertion order and sorted order differ.
    const now = new Date().toISOString();
    const a = store.insertNode(fileNode('a'));
    const b = store.insertNode(fileNode('b'));
    store.insertEdge({
      projectId: 'p',
      sourceId: a,
      targetId: b,
      type: EDGE_IMPORTS,
      createdAt: now,
    });
    store.insertEdge({
      projectId: 'p',
      sourceId: a,
      targetId: b,
      type: EDGE_CALLS,
      createdAt: now,
    });

    const keys = Object.keys(indexer.censusOfEdges());
    expect(keys).toEqual([...keys].sort());
  });
});

describe('workspacePhases', () => {
  it('runs every phase but the one that reaches the network', () => {
    const ids = workspacePhases(false).map((phase) => phase.id);
    // **`embed` is the subtraction, and it is the only one.** Everything that builds structure stays, so the graph
    // a workspace gets is the graph a single-repository analysis gets minus the vectors nothing reads.
    expect(ids).not.toContain('embed');
    expect(ids).toContain('parse');
    expect(ids).toContain('scopeResolution');
  });

  it('keeps the embedding phase when it is asked for', () => {
    const asked = workspacePhases(true).map((phase) => phase.id);
    expect(asked).toContain('embed');
    // The same set plus one: an option that also dropped a phase would be a different pipeline, and a caller who
    // asked for vectors would silently lose a relation.
    expect(asked.filter((id) => id !== 'embed')).toEqual(workspacePhases(false).map((p) => p.id));
  });
});
