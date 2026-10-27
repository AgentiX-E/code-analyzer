// @code-analyzer — the acceptance test for story 5: one workspace, two real repositories.
//
// **A user's story, not a package's:** "I own flask and I own werkzeug, and I need one answer across both — who
// uses this symbol, and what breaks in flask if I change that module." Every earlier cross-repository test built
// its two repositories out of a fixture, and a fixture is a repository whose imports the author already knew how
// to resolve. These are two checkouts of released tags, linked the way released packages are linked: by name.
//
// **The corpus is fetched, never committed** (`benchmarks/corpora/` is ignored): the workflow downloads flask 3.0.3
// and werkzeug 3.0.3 and points `CROSS_REPO_CORPUS_DIR` at the directory holding them. Without it the suite skips
// rather than passing on an empty graph — a skip is visible in the report, an empty graph is not.
//
// Every expected pair below is visible in the file it names; the ones asserted by name are a sample, and the count
// is the floor the full run produced (49).

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer, RepoGroupManager } from '@code-analyzer/intelligence';
import { describe, it, expect, beforeAll } from 'vitest';

import type { GraphEdge } from '@code-analyzer/shared';

const corpusRoot = process.env['CROSS_REPO_CORPUS_DIR'];
const enabled = corpusRoot !== undefined && existsSync(corpusRoot);

/** The checkout whose name starts with `prefix`, so a different pinned tag still runs. */
function checkoutNamed(prefix: string): string | null {
  if (!corpusRoot) return null;
  const entry = readdirSync(corpusRoot).find((name) => name.startsWith(prefix));
  return entry ? join(corpusRoot, entry) : null;
}

interface Workspace {
  store: InMemoryGraphStore;
  indexer: CrossRepoIndexer;
  groupId: string;
}

const GROUP = 'real-workspace';
const APP = 'pallets/flask';
const LIB = 'pallets/werkzeug';

async function openWorkspace(): Promise<Workspace> {
  const app = checkoutNamed('flask-');
  const lib = checkoutNamed('werkzeug-');
  if (!app || !lib) throw new Error('flask and werkzeug checkouts must both be present');

  const store = new InMemoryGraphStore();
  const groups = new RepoGroupManager();
  const indexer = new CrossRepoIndexer(store, groups);

  groups.createGroup(GROUP, 'pallets', 'flask and the werkzeug it imports');
  groups.addRepo(GROUP, 'pallets', 'flask', 'https://github.com/pallets/flask', app);
  groups.addRepo(GROUP, 'pallets', 'werkzeug', 'https://github.com/pallets/werkzeug', lib);

  await indexer.indexGroup(GROUP);
  return { store, indexer, groupId: GROUP };
}

/** Cross-repository import edges, as `imported file ← importing file`. */
function workspaceEdges(store: InMemoryGraphStore): string[] {
  return store
    .getAllEdges()
    .filter((edge: GraphEdge) => edge.type === 'IMPORTS')
    .filter((edge) => {
      const source = store.getNode(edge.sourceId);
      const target = store.getNode(edge.targetId);
      return (
        source !== null &&
        target !== null &&
        source.projectId !== target.projectId &&
        edge.properties?.['scope'] === 'workspace'
      );
    })
    .map((edge) => {
      const source = store.getNode(edge.sourceId)!;
      const target = store.getNode(edge.targetId)!;
      // The edge runs imported → importer; the arrow is written the way a reader would say it.
      return `${source.filePath} → ${target.filePath}`;
    });
}

describe.skipIf(!enabled)('story 5 — two real repositories in one workspace', () => {
  let workspace: Workspace;

  beforeAll(async () => {
    workspace = await openWorkspace();
  }, 120_000);

  it('indexes both checkouts into one graph without an error', () => {
    const nodes = workspace.store.getAllNodes();
    const repos = new Set(nodes.map((node) => node.projectId));
    expect(repos).toEqual(new Set([APP, LIB]));
    expect(nodes.length).toBeGreaterThan(7_000);
  });

  it('links the two repositories through the package name flask writes', () => {
    const edges = workspaceEdges(workspace.store);

    // The count is a floor: an extractor that finds more imports is an improvement, one that finds fewer is the
    // regression this test exists to catch. Before the package resolver existed the number was **0**.
    expect(edges.length).toBeGreaterThanOrEqual(49);

    // A sample, one per shape the resolver has to handle, each checkable by opening the file:
    //   `from werkzeug.exceptions import abort`      — a module, a name
    //   `from werkzeug.wrappers import Response`     — a package (its `__init__.py`)
    //   `import werkzeug.serving`                    — a namespace import
    //   `from werkzeug import run_simple`            — a **re-export**, served by the package root
    //   `from werkzeug.sansio.response import ...`   — a nested module
    expect(edges).toContain('src/werkzeug/exceptions.py → src/flask/helpers.py');
    expect(edges).toContain('src/werkzeug/wrappers/__init__.py → src/flask/app.py');
    expect(edges).toContain('src/werkzeug/serving.py → src/flask/cli.py');
    expect(edges).toContain('src/werkzeug/__init__.py → src/flask/cli.py');
    expect(edges).toContain('src/werkzeug/sansio/response.py → src/flask/json/provider.py');
  });

  it('answers "who uses this symbol in my other repository?"', async () => {
    const traces = await workspace.indexer.traceSymbolDependencies(
      workspace.groupId,
      LIB,
      'LocalProxy',
    );
    const files = traces.map((trace) => trace.targetFile);
    // `from werkzeug.local import LocalProxy` is written in both of these files.
    expect(files).toContain('src/flask/globals.py');
    expect(files).toContain('src/flask/logging.py');
  });

  it('answers "what breaks in flask if I change this symbol?"', async () => {
    const impact = await workspace.indexer.analyzeCrossRepoImpact(workspace.groupId, LIB, [
      'abort',
    ]);
    const entry = impact.analysis.find((item) => item.repo === APP);

    expect(impact.affectedRepos).toContain(APP);
    // `from werkzeug.exceptions import abort` appears in `helpers.py`; the answer names the file and the symbol,
    // not the importing file's basename.
    expect(entry?.affectedFiles).toContain('src/flask/helpers.py');
    expect(entry?.affectedSymbols).toEqual(['abort']);
  });

  it('says nothing is affected when the symbol lives only in the library', async () => {
    // `Map.bind_to_environ` is defined here and used inside werkzeug; flask never names it.
    const impact = await workspace.indexer.analyzeCrossRepoImpact(workspace.groupId, LIB, [
      'bind_to_environ',
    ]);
    const files = impact.analysis.flatMap((item) => item.affectedFiles);
    expect(files.filter((file) => file.includes('flask/app.py'))).toEqual([]);
  });
});
