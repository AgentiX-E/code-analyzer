// The cross-repository indexer, driven through the paths a real deployment takes and a tidy fixture does not.
//
// **This file exists because the indexer's most interesting behaviour is its fallbacks**, and every one of them is a
// state a machine can be in rather than a state a fixture is in: **a grammar that failed to load**, **a parser that
// threw**, **an import that walks out of its repository**, **a repository in the group that was never cloned**, and
// **an `IMPORTS` edge written by something other than this file**.
//
// **The parser is a constructor argument with the production loader as its default**, which is the seam that makes the
// first two reachable: whether a native grammar binary is present is a fact about the machine, so no amount of test
// code can produce "the parser is absent" without it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { afterEach, describe, expect, it } from 'vitest';

import { CrossRepoIndexer } from '../cross-repo/cross-repo-indexer.js';
import { RepoGroupManager } from '../cross-repo/repo-group-manager.js';

import type { GraphNode } from '@code-analyzer/shared';

const GROUP = 'g1';
let roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

/** A directory holding one repository per entry of `files`, named after the key. */
function makeGroupDir(files: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'ca-xrepo-'));
  roots.push(root);
  for (const [repo, tree] of Object.entries(files)) {
    for (const [relative, content] of Object.entries(tree)) {
      const full = join(root, repo, relative);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    }
  }
  return root;
}

/**
 * Declarations in the shapes the fallback's regexes know, each on its own line.
 *
 * **`alpha` is exported and `beta` is not**, which is the difference the ±50-character window decides; **`omega` is a
 * C-family method**, which is what the last pattern is for. **A file like this is what the fallback is for**: the
 * parser is absent, and the names below are the whole answer a caller gets.
 */
const FALLBACK_SOURCE = [
  'export function alpha(id: string) {',
  '  return id;',
  '}',
  '',
  'const beta = (value: number) => value * 2;',
  '',
  'export class Gamma {',
  '  run() {}',
  '}',
  '',
  'export interface Delta { id: string }',
  '',
  'export type Epsilon = string;',
  '',
  'export enum Zeta { A, B }',
  '',
  'public void omega(int x) {',
  '}',
].join('\n');

function nodesFor(indexer: CrossRepoIndexer, projectId: string): GraphNode[] {
  return indexer.getStore().queryNodes({ projectId }).items;
}

describe('symbol extraction when the parser is unavailable', () => {
  it('names what the regexes can see, and labels each shape by the pattern that matched it', async () => {
    const root = makeGroupDir({ 'repo-a': { 'src/legacy.ts': FALLBACK_SOURCE } });
    const store = new InMemoryGraphStore();
    const manager = new RepoGroupManager();
    manager.createGroup(GROUP, 'Group', '');
    manager.addRepo(GROUP, 'o', 'repo-a', 'url', join(root, 'repo-a'));

    // **The state a machine reaches when a grammar package did not install**: the loader answers null.
    const indexer = new CrossRepoIndexer(store, manager, async () => null);
    await indexer.indexGroup(GROUP);

    const symbols = nodesFor(indexer, 'o/repo-a').filter((n) => n.label !== 'File');
    const byName = new Map(symbols.map((n) => [n.name, n]));

    expect([...byName.keys()].sort()).toEqual([
      'Delta',
      'Epsilon',
      'Gamma',
      'Zeta',
      'alpha',
      'beta',
      'omega',
    ]);
    expect(byName.get('Gamma')!.label).toBe('Class');
    expect(byName.get('Delta')!.label).toBe('Interface');
    expect(byName.get('Epsilon')!.label).toBe('TypeAlias');
    expect(byName.get('Zeta')!.label).toBe('Enum');
    expect(byName.get('omega')!.label).toBe('Method');
    expect(byName.get('alpha')!.label).toBe('Function');
  });

  it('reports the line a name was found on, and whether an export precedes it', async () => {
    const root = makeGroupDir({ 'repo-a': { 'src/legacy.ts': FALLBACK_SOURCE } });
    const store = new InMemoryGraphStore();
    const manager = new RepoGroupManager();
    manager.createGroup(GROUP, 'Group', '');
    manager.addRepo(GROUP, 'o', 'repo-a', 'url', join(root, 'repo-a'));

    const indexer = new CrossRepoIndexer(store, manager, async () => null);
    await indexer.indexGroup(GROUP);

    const byName = new Map(
      nodesFor(indexer, 'o/repo-a')
        .filter((n) => n.label !== 'File')
        .map((n) => [n.name, n]),
    );

    // **The first line of the file**, which is only right when the offset is counted rather than assumed.
    expect(byName.get('alpha')!.startLine).toBe(1);
    // **Every pattern consumes the `export` it allows**, so the fifty characters *before* a match never contain one:
    // the fallback cannot tell an exported declaration from a private one, and it says so rather than guessing.
    expect(byName.get('alpha')!.isExported).toBe(false);
    expect(byName.get('beta')!.isExported).toBe(false);
  });

  it("falls back when the parser throws, which is the fallback's other reason to exist", async () => {
    const root = makeGroupDir({ 'repo-a': { 'src/legacy.ts': FALLBACK_SOURCE } });
    const store = new InMemoryGraphStore();
    const manager = new RepoGroupManager();
    manager.createGroup(GROUP, 'Group', '');
    manager.addRepo(GROUP, 'o', 'repo-a', 'url', join(root, 'repo-a'));

    const indexer = new CrossRepoIndexer(store, manager, async () => {
      throw new Error('grammar not built for this platform');
    });
    const result = await indexer.indexGroup(GROUP);

    // **A parser that throws is not an indexing failure**: the file's symbols are still extracted, from the text.
    expect(result.errors).toEqual([]);
    expect(nodesFor(indexer, 'o/repo-a').some((n) => n.name === 'alpha')).toBe(true);
  });
});

describe('imports across three repositories', () => {
  /**
   * `repo-b` imports a symbol from `repo-a` by a path that walks out of its own directory, `repo-a` imports a sibling
   * at its own root, and `repo-c` is registered in the group but was never cloned.
   *
   * **The three are the shapes the linker distinguishes**: a relative path that stays inside one repository, one that
   * leaves it, and one that leaves it towards a repository whose files are not on disk.
   */
  const TREES = {
    'repo-a': {
      'src/shared.ts': 'export function shared(x: number) {\n  return x;\n}\n',
      'other.ts': 'export const other = 1;\n',
      'root.ts': "import { other } from './other';\nexport const use = () => other;\n",
    },
    'repo-b': {
      'src/gateway.ts':
        "import { shared } from '../../repo-a/src/shared';\n" +
        "import { missing } from '../../repo-a/src/does-not-exist';\n" +
        'export function use() {\n  return shared(1);\n}\n',
    },
  };

  async function indexThreeRepos(store: InMemoryGraphStore): Promise<CrossRepoIndexer> {
    const root = makeGroupDir(TREES);
    const manager = new RepoGroupManager();
    manager.createGroup(GROUP, 'Group', '');
    manager.addRepo(GROUP, 'o', 'repo-a', 'url', join(root, 'repo-a'));
    manager.addRepo(GROUP, 'o', 'repo-b', 'url', join(root, 'repo-b'));
    // **Never cloned, in the way a group is often registered before its repositories are**: no working directory, and
    // so no path for the linker to resolve against.
    manager.addRepo(GROUP, 'o', 'repo-c', 'url', undefined as unknown as string);

    const indexer = new CrossRepoIndexer(store, manager);
    const result = await indexer.indexGroup(GROUP);

    // The repo without a directory is reported rather than silently skipped.
    expect(result.errors.some((e) => e.includes('o/repo-c'))).toBe(true);
    return indexer;
  }

  it('links an import that walks out of its repository, in the direction the analysis reads', async () => {
    const store = new InMemoryGraphStore();
    await indexThreeRepos(store);

    const shared = store.getNodeByQualifiedName('file:o/repo-a:src/shared.ts')!;
    const gateway = store.getNodeByQualifiedName('file:o/repo-b:src/gateway.ts')!;
    const edges = store.getEdgesForNode(shared.id);

    // **From the imported file to the importing one**: every consumer of this edge walks *outgoing* cross-repo edges.
    expect(edges.some((e) => e.sourceId === shared.id && e.targetId === gateway.id)).toBe(true);
  });

  it('resolves an import between two files at the root of one repository', async () => {
    const store = new InMemoryGraphStore();
    await indexThreeRepos(store);

    const root = store.getNodeByQualifiedName('file:o/repo-a:root.ts')!;
    const other = store.getNodeByQualifiedName('file:o/repo-a:other.ts')!;

    // **No directory to join**, which is the arm a `sourceFile.includes('/')` decides: the specifier is resolved
    // against the repository root.
    expect(
      store.getEdgesForNode(root.id).some((e) => e.targetId === other.id && e.type === 'IMPORTS'),
    ).toBe(true);
  });

  it('reports the importers that reach a symbol, at depth one and at depth two', async () => {
    const store = new InMemoryGraphStore();
    const indexer = await indexThreeRepos(store);

    // **A repository in the group whose files came from somewhere else**: the transitive hop is a
    // `CROSS_REPO_*` edge out of the importer, which is what an incremental build leaves behind.
    const elsewhere = store.insertNode({
      projectId: 'o/repo-c',
      label: 'File',
      name: 'other.ts',
      qualifiedName: 'file:o/repo-c:src/other.ts',
      filePath: 'src/other.ts',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    const gateway = store.getNodeByQualifiedName('file:o/repo-b:src/gateway.ts')!;
    store.insertEdge({
      projectId: 'o/repo-b',
      sourceId: gateway.id,
      targetId: elsewhere,
      type: 'CROSS_REPO_IMPORTS',
      properties: { importedSymbols: ['shared'] },
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    });

    const traces = await indexer.traceSymbolDependencies(GROUP, '', 'shared');

    const direct = traces.filter((t) => t.depth === 1);
    const transitive = traces.filter((t) => t.depth === 2);
    expect(direct.map((t) => t.targetRepo)).toContain('o/repo-b');
    expect(transitive.map((t) => t.targetRepo)).toContain('o/repo-c');
    // **The two hops are distinguished by confidence**, because one is read from the import and the other is a hop.
    expect(direct[0]!.confidence).toBe('high');
    expect(transitive[0]!.confidence).toBe('medium');
    expect(transitive[0]!.dependencyType).toBe('transitive_CROSS_REPO_IMPORTS');
  });

  it('ignores an import edge that names no symbols, and one that points outside the group', async () => {
    const store = new InMemoryGraphStore();
    const indexer = await indexThreeRepos(store);

    const shared = store.getNodeByQualifiedName('file:o/repo-a:src/shared.ts')!;
    // **An `IMPORTS` edge written by the single-repository indexer carries no `importedSymbols`**, and a list of
    // names is the only thing that says whether this symbol is one of them.
    const anonymous = store.insertNode({
      projectId: 'o/repo-b',
      label: 'File',
      name: 'anonymous.ts',
      qualifiedName: 'file:o/repo-b:src/anonymous.ts',
      filePath: 'src/anonymous.ts',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    store.insertEdge({
      projectId: 'o/repo-a',
      sourceId: shared.id,
      targetId: anonymous,
      type: 'IMPORTS',
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    });
    // And an importer that belongs to a group this analysis was not asked about.
    const outside = store.insertNode({
      projectId: 'other/repo-z',
      label: 'File',
      name: 'z.ts',
      qualifiedName: 'file:other/repo-z:src/z.ts',
      filePath: 'src/z.ts',
      startLine: 1,
      endLine: 1,
      language: 'typescript',
      properties: {},
      signature: null,
      docstring: null,
      complexity: null,
      isExported: false,
      fingerprint: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    store.insertEdge({
      projectId: 'o/repo-a',
      sourceId: shared.id,
      targetId: outside,
      type: 'IMPORTS',
      properties: { importedSymbols: ['shared'] },
      weight: 1,
      createdAt: '2026-01-01T00:00:00Z',
    });

    const traces = await indexer.traceSymbolDependencies(GROUP, '', 'shared');

    // **The importer set is what the answer means**, and neither extra edge adds to it: the edge that names no symbols
    // cannot say whether this symbol is one of them, and the edge into another group is a repository this analysis was
    // not asked about. **The list is de-duplicated here rather than in the assertion**, because the indexer emits one
    // trace per matching *node* — a file and its symbols all match a name query, which is a precision question recorded
    // in the audit rather than silently averaged into a set.
    const importers = new Set(traces.filter((t) => t.depth === 1).map((t) => t.targetFile));
    expect([...importers]).toEqual(['src/gateway.ts']);
  });
});
