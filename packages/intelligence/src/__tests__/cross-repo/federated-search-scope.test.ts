// The repository scope of a federated question, on the shape a real workspace has.
//
// **Why a second file rather than a case in `federated-search.test.ts`**: every fixture in that file names its
// projects `repo-a`, `repo-b`. The group indexer names them `owner/name`. A filter that compares a selector to
// `node.projectId` therefore passes every test in that file and selects nothing on a real workspace - which is exactly
// what happened: asked within the repository that holds the answer, `repoFilter: ['flask']` returned 0 of 469
// questions while the same questions across all four repositories returned the answer.
//
// These cases use the identifiers the indexer writes, so the fixture cannot be the reason they pass.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { beforeEach, describe, expect, it } from 'vitest';

import { FederatedSearchEngine } from '../../cross-repo/federated-search.js';
import { RepoGroupManager } from '../../cross-repo/repo-group-manager.js';

import type { GraphNode } from '@code-analyzer/shared';

function node(projectId: string, name: string, filePath: string): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId,
    label: 'Function',
    name,
    qualifiedName: `project:${projectId}:${filePath}:${name}`,
    filePath,
    startLine: 1,
    endLine: 5,
    language: 'typescript',
    properties: {
      name,
      filePath,
      startLine: 1,
      endLine: 5,
      language: 'typescript',
      isExported: true,
    },
    signature: `function ${name}()`,
    docstring: null,
    complexity: 1,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
  };
}

let store: InMemoryGraphStore;

beforeEach(() => {
  store = new InMemoryGraphStore();
  store.insertNode(node('pallets/flask', 'renderTemplate', 'src/flask/templating.py'));
  store.insertNode(node('expressjs/express', 'renderTemplate', 'lib/application.js'));
  store.insertNode(node('google/gson', 'toJson', 'src/main/java/Json.java'));
  store.insertNode(node('sindresorhus/got', 'toJson', 'source/core/index.ts'));
});

describe('repoFilter — a name, an id, or nothing', () => {
  it('selects by the repository name alone, on project ids the indexer writes', async () => {
    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('renderTemplate', { repoFilter: ['flask'] });

    // **Both repositories define the symbol, so the assertion is about which one survives**, not about a count that
    // could be satisfied by returning everything.
    expect(result.totalResults).toBe(1);
    expect(result.results[0]!.repo).toBe('pallets/flask');
    expect(result.unmatchedRepoFilters).toEqual([]);
  });

  it('selects by the full project id', async () => {
    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('renderTemplate', { repoFilter: ['expressjs/express'] });
    expect(result.results.map((r) => r.repo)).toEqual(['expressjs/express']);
  });

  it('never returns a repository the filter did not name', async () => {
    const engine = new FederatedSearchEngine(store);
    const all = await engine.search('toJson', {});
    const filtered = await engine.search('toJson', { repoFilter: ['gson'] });

    expect(filtered.totalResults).toBeGreaterThan(0);
    expect(filtered.totalResults).toBeLessThanOrEqual(all.totalResults);
    for (const item of filtered.results) expect(item.repo).toBe('google/gson');
  });

  it('reports a filter that named nothing, instead of returning an empty list and saying nothing', async () => {
    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('renderTemplate', { repoFilter: ['django'] });

    expect(result.totalResults).toBe(0);
    expect(result.unmatchedRepoFilters).toEqual(['django']);
  });

  it('does not accuse a filter that names a real repository of the query finding nothing', async () => {
    const engine = new FederatedSearchEngine(store);
    const result = await engine.search('nothingMatchesThisAtAll', { repoFilter: ['flask'] });

    expect(result.totalResults).toBe(0);
    // `pallets/flask` exists in the store, so the empty answer is the query's, and the caller is not sent to fix a
    // filter that is correct.
    expect(result.unmatchedRepoFilters).toEqual([]);
  });

  it('reports a filter that names no repository in the store, whether or not the query found anything', async () => {
    const engine = new FederatedSearchEngine(store);

    const withHits = await engine.search('renderTemplate', { repoFilter: ['django'] });
    expect(withHits.unmatchedRepoFilters).toEqual(['django']);

    const withoutHits = await engine.search('nothingMatchesThisAtAll', { repoFilter: ['django'] });
    expect(withoutHits.unmatchedRepoFilters).toEqual(['django']);
  });
});

describe('groupId — expanded through the manager that owns the group', () => {
  it('answers only from the group, though the store holds repositories outside it', async () => {
    const manager = new RepoGroupManager();
    manager.createGroup('web', 'web', 'two repositories');
    manager.addRepo('web', 'pallets', 'flask', '', '/tmp/flask');
    manager.addRepo('web', 'expressjs', 'express', '', '/tmp/express');
    manager.setRepoProjectId('web', 'pallets/flask', 'pallets/flask');
    manager.setRepoProjectId('web', 'expressjs/express', 'expressjs/express');

    const engine = new FederatedSearchEngine(store, manager);
    const result = await engine.search('toJson', { groupId: 'web' });

    // `toJson` is defined in the two repositories *outside* the group, so the group scope must answer nothing -
    // and it must be able to say why.
    expect(result.totalResults).toBe(0);
    expect(result.unmatchedRepoFilters).toEqual([]);
  });

  it('answers from the group when the symbol is inside it', async () => {
    const manager = new RepoGroupManager();
    manager.createGroup('web', 'web', 'two repositories');
    manager.addRepo('web', 'google', 'gson', '', '/tmp/gson');
    manager.setRepoProjectId('web', 'google/gson', 'google/gson');

    const engine = new FederatedSearchEngine(store, manager);
    const result = await engine.search('toJson', { groupId: 'web' });

    expect(result.results.map((r) => r.repo)).toEqual(['google/gson']);
  });

  it('throws rather than filtering nothing when the engine was given no resolver', async () => {
    const engine = new FederatedSearchEngine(store);
    await expect(engine.search('toJson', { groupId: 'web' })).rejects.toThrow(
      /groupId requires a repo group/,
    );
  });

  it('skips a repository that was added but never indexed, instead of selecting the empty id', () => {
    const manager = new RepoGroupManager();
    manager.createGroup('g', 'g', '');
    manager.addRepo('g', 'owner', 'indexed', '', '/tmp/a');
    manager.addRepo('g', 'owner', 'not-indexed', '', '/tmp/b');
    manager.setRepoProjectId('g', 'owner/indexed', 'owner/indexed');

    expect(manager.projectsInGroup('g')).toEqual(['owner/indexed']);
  });
});
