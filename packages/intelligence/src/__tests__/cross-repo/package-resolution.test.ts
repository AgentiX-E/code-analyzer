// Two checkouts, one group, and a dependency that is named as a **package** rather than as a path.
//
// **This is the shape the fixtures never had.** `cross-repo-e2e` links its two repositories with `../../`, which is
// the monorepo layout; two repositories that are released separately link through `import werkzeug.utils`, and the
// indexer produced nothing for that shape. Every case here builds two real directories with real manifests, because
// the resolution rule is "the file exists under this layout" and nothing else.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { describe, it, expect, beforeEach } from 'vitest';

import { CrossRepoIndexer, RepoGroupManager } from '@code-analyzer/intelligence';

import type { GraphEdge } from '@code-analyzer/shared';

function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cross-repo-pkg-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

/** The library: `helpers` is declared in its own module and re-exported by the package root. */
function libraryCheckout(): string {
  return checkout({
    'pyproject.toml': '[project]\nname = "acmelib"\n',
    'src/acmelib/__init__.py': 'from .helpers import shout\n\n__all__ = ["shout"]\n',
    'src/acmelib/helpers.py': 'def shout(text):\n    return text.upper()\n',
    'src/acmelib/deep/__init__.py': '',
    'src/acmelib/deep/thing.py': 'VALUE = 1\n',
    'src/acmelib/unused.py': 'NEVER = 0\n',
  });
}

interface Group {
  store: InMemoryGraphStore;
  indexer: CrossRepoIndexer;
  groupId: string;
  appRepo: string;
  libRepo: string;
}

async function index(appFiles: Record<string, string>): Promise<Group> {
  const appRepo = 'acme/app';
  const libRepo = 'acme/lib';
  const groupId = 'g';

  const store = new InMemoryGraphStore();
  const groups = new RepoGroupManager();
  const indexer = new CrossRepoIndexer(store, groups);

  groups.createGroup(groupId, 'acme', '');
  groups.addRepo(groupId, 'acme', 'app', '', checkout(appFiles));
  groups.addRepo(groupId, 'acme', 'lib', '', libraryCheckout());

  await indexer.indexGroup(groupId);
  return { store, indexer, groupId, appRepo, libRepo };
}

function workspaceEdges(store: InMemoryGraphStore): GraphEdge[] {
  return store
    .getAllEdges()
    .filter((edge) => edge.type === 'IMPORTS' && edge.properties?.['scope'] === 'workspace');
}

describe('cross-repository resolution by package name', () => {
  let group: Group;

  beforeEach(async () => {
    group = await index({
      'pyproject.toml': '[project]\nname = "acme-app"\n',
      'src/app/__init__.py': 'from acmelib.helpers import shout\n',
      'src/app/main.py': 'import acmelib.deep.thing\nfrom acmelib import shout\n',
    });
  });

  it('creates an edge from the imported file to the importing file, carrying the names', async () => {
    const edges = workspaceEdges(group.store);
    expect(edges).toHaveLength(3);

    const described = edges
      .map((edge) => {
        const imported = group.store.getNode(edge.sourceId)!;
        const importer = group.store.getNode(edge.targetId)!;
        return {
          imported: imported.filePath,
          importer: importer.filePath,
          names: edge.properties?.['importedSymbols'],
          resolution: edge.properties?.['resolution'],
        };
      })
      .sort((a, b) => `${a.importer} ${a.imported}`.localeCompare(`${b.importer} ${b.imported}`));

    expect(described).toEqual([
      {
        imported: 'src/acmelib/helpers.py',
        importer: 'src/app/__init__.py',
        names: ['shout'],
        resolution: 'package',
      },
      {
        imported: 'src/acmelib/__init__.py',
        importer: 'src/app/main.py',
        names: ['shout'],
        resolution: 'package',
      },
      {
        imported: 'src/acmelib/deep/thing.py',
        importer: 'src/app/main.py',
        names: ['*'],
        resolution: 'package',
      },
    ]);
  });

  it('records a namespace import as `*`, because the module is reachable through the binding', async () => {
    // `import acmelib.deep.thing` binds `acmelib`; nothing in the statement names `VALUE`. Recording the bound
    // segment made every question about a member of `thing` unanswerable.
    const bindings = group.store
      .getAllEdges()
      .filter((edge) => edge.type === 'IMPORTS' && edge.properties?.['scope'] === 'workspace')
      .map((edge) => edge.properties?.['importedSymbols']);
    expect(bindings).toContainEqual(['*']);
  });

  it('resolves a relative Python import inside the library', () => {
    // `.helpers` is Python for "the module next to me"; read as a path it became `src/acmelib/.helpers`.
    const intra = group.store
      .getAllEdges()
      .filter((edge) => edge.type === 'IMPORTS' && edge.properties?.['scope'] === 'repo')
      .map((edge) => {
        const importer = group.store.getNode(edge.sourceId)!;
        const imported = group.store.getNode(edge.targetId)!;
        return `${importer.filePath} -> ${imported.filePath}`;
      });
    expect(intra).toContain('src/acmelib/__init__.py -> src/acmelib/helpers.py');
  });

  it('reports no cross-repository edge for a module nobody imports', () => {
    const importedFiles = workspaceEdges(group.store).map(
      (edge) => group.store.getNode(edge.sourceId)!.filePath,
    );
    expect(importedFiles).not.toContain('src/acmelib/unused.py');
  });
});

describe('a graph built twice is the same graph', () => {
  it('does not duplicate an edge it has already inserted', async () => {
    const group = await index({
      'pyproject.toml': '',
      'src/app/one.py': 'from acmelib.helpers import shout\n',
    });

    const first = await group.indexer.buildCrossRepoGraph(group.groupId);
    const second = await group.indexer.buildCrossRepoGraph(group.groupId);
    expect(second.crossRepoEdges).toBe(first.crossRepoEdges);
    // **The first version reported 147 edges on the real pair** — one call's 49, re-inserted, plus the first call's
    // `CROSS_REPO_IMPORTS` edges re-derived as `CROSS_REPO_DEPENDS`.
    expect(workspaceEdges(group.store)).toHaveLength(1);
  });
});

describe('one edge per (importer, imported) pair', () => {
  it('carries every name two statements asked the same file for', async () => {
    const group = await index({
      'pyproject.toml': '',
      'src/app/two.py': 'from acmelib.helpers import shout\nfrom acmelib.helpers import shout\n',
    });

    const edges = workspaceEdges(group.store);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.properties?.['importedSymbols']).toEqual(['shout']);
  });
});

describe('a specifier that matches a package but names no file', () => {
  it('resolves nothing, and says so by staying out of the graph', async () => {
    const group = await index({
      'pyproject.toml': '',
      'src/app/absent.py': 'from acmelib.nonexistent import thing\n',
    });
    expect(workspaceEdges(group.store)).toEqual([]);
  });

  it('survives a group member that was never cloned', async () => {
    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);

    groups.createGroup('g', 'acme', '');
    groups.addRepo('g', 'acme', 'app', '', checkout({ 'app.py': 'from acmelib import shout\n' }));
    // A repository in the group with no checkout: `indexGroup` records the failure and the link pass skips it.
    groups.addRepo('g', 'acme', 'lib', '', '');

    const result = await indexer.indexGroup('g');
    expect(result.errors).toHaveLength(1);
    expect(workspaceEdges(store)).toEqual([]);
  });
});

describe('trace and impact follow the re-export chain', () => {
  it('finds a consumer that imports the name from the package root', async () => {
    const group = await index({
      'pyproject.toml': '',
      // `shout` is declared in `helpers.py` and re-exported by `__init__.py`; the consumer only ever writes
      // `from acmelib import shout`, so the declaring file has no edge to it.
      'src/app/late.py': 'from acmelib import shout\n',
    });

    const traces = await group.indexer.traceSymbolDependencies(group.groupId, 'acme/lib', 'shout');
    expect(traces.map((trace) => trace.targetFile)).toContain('src/app/late.py');
  });

  it('names the affected files, not the file names, when a symbol is asked about', async () => {
    const group = await index({
      'pyproject.toml': '',
      'src/app/late.py': 'from acmelib import shout\n',
      'src/app/other.py': 'from acmelib.helpers import shout\n',
    });

    const impact = await group.indexer.analyzeCrossRepoImpact(group.groupId, 'acme/lib', ['shout']);
    const entry = impact.analysis.find((item) => item.repo === 'acme/app');

    expect(entry?.affectedFiles).toEqual(['src/app/late.py', 'src/app/other.py']);
    // **The symbols are what the importer asked for.** The first version answered with the *file names*
    // `late.py, other.py`, because the edge's target is a file and its `name` is a basename.
    expect(entry?.affectedSymbols).toEqual(['shout']);
  });

  it('treats a namespace import as reaching every name in the file', async () => {
    // `import acmelib.helpers` binds the module: `helpers.shout` is reachable through it even though the statement
    // names nothing, so a question about `shout` has to consider this file.
    const group = await index({
      'pyproject.toml': '',
      'src/app/ns.py': 'import acmelib.helpers\n',
    });
    const impact = await group.indexer.analyzeCrossRepoImpact(group.groupId, 'acme/lib', ['shout']);
    expect(impact.analysis.flatMap((item) => item.affectedFiles)).toEqual(['src/app/ns.py']);
  });

  it('leaves out a repository whose imports never mention the changed symbol', async () => {
    const group = await index({
      'pyproject.toml': '',
      'src/app/unrelated.py': 'from acmelib.helpers import OTHER\n',
      'src/app/real.py': 'from acmelib.helpers import shout\n',
    });

    const impact = await group.indexer.analyzeCrossRepoImpact(group.groupId, 'acme/lib', ['shout']);
    const files = impact.analysis.flatMap((item) => item.affectedFiles);
    expect(files).toEqual(['src/app/real.py']);
  });

  it('answers with an empty set when the symbol is used nowhere', async () => {
    const group = await index({ 'pyproject.toml': '', 'src/app/x.py': 'VALUE = 1\n' });
    const impact = await group.indexer.analyzeCrossRepoImpact(group.groupId, 'acme/lib', ['shout']);
    expect(impact.affectedRepos).toEqual([]);
    expect(impact.analysis).toEqual([]);
  });
});

describe('a repository with no manifest cannot be addressed', () => {
  it('leaves the import unresolved rather than guessing a file', async () => {
    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);

    groups.createGroup('g', 'acme', '');
    // No `pyproject.toml`: nothing states that this checkout publishes `lib`.
    groups.addRepo('g', 'acme', 'app', '', checkout({ 'app.py': 'from lib.core import thing\n' }));
    groups.addRepo('g', 'acme', 'lib', '', checkout({ 'lib/core.py': 'thing = 1\n' }));

    await indexer.indexGroup('g');
    expect(workspaceEdges(store)).toEqual([]);
  });
});

describe('a package that imports itself by name', () => {
  /**
   * `from acmelib.helpers import shout` written **inside** `acmelib` — an absolute import of one's own package,
   * which is the ordinary way a Python package refers to its own modules and the shape that made the first spike
   * fail: the specifier names a package, and the only package that answers it is the importer's own.
   */
  async function indexSelfImporter(): Promise<{
    store: InMemoryGraphStore;
    indexer: CrossRepoIndexer;
  }> {
    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);

    groups.createGroup('g', 'acme', '');
    groups.addRepo(
      'g',
      'acme',
      'lib',
      '',
      checkout({
        'pyproject.toml': '[project]\nname = "acmelib"\n',
        'src/acmelib/__init__.py': '',
        'src/acmelib/helpers.py': 'def shout(text):\n    return text.upper()\n',
        'src/acmelib/own.py': 'from acmelib.helpers import shout\n\nVALUE = shout("x")\n',
      }),
    );

    await indexer.indexGroup('g');
    return { store, indexer };
  }

  it('resolves it to the file in its own checkout, as an ordinary in-repository import', async () => {
    const { store } = await indexSelfImporter();

    const own = store.getNodeByQualifiedName('file:acme/lib:src/acmelib/own.py')!;
    const helpers = store.getNodeByQualifiedName('file:acme/lib:src/acmelib/helpers.py')!;
    const edge = store
      .getEdgesForNode(own.id)
      .find((candidate) => candidate.type === 'IMPORTS' && candidate.targetId === helpers.id);

    expect(edge).toBeDefined();
    // **Not a cross-repository edge**: the package the specifier names is the importing repository's own, so the
    // relation is the re-export walk's raw material rather than a workspace hop.
    expect(edge!.properties['scope']).toBe('repo');
    expect(edge!.properties['importedSymbols']).toEqual(['shout']);
  });
});

describe('a path that names a repository whose group entry has no project id', () => {
  /** A checkout directory named exactly as the repository, which is what a cross-repository `../` path spells. */
  function namedCheckouts(root: string, trees: Record<string, Record<string, string>>): void {
    for (const [name, files] of Object.entries(trees)) {
      for (const [path, content] of Object.entries(files)) {
        const full = join(root, name, path);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, content);
      }
    }
  }

  it('still links an import added after the registration lost it, by path and by package name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cross-repo-reloaded-'));
    namedCheckouts(root, {
      app: {
        'pyproject.toml': '[project]\nname = "acme-app"\n',
        'src/app/__init__.py': '',
        // Indexed empty of imports; the statements are written below, after the group is re-registered.
        'src/app/late.py': 'VALUE = 1\n',
      },
      lib: {
        'pyproject.toml': '[project]\nname = "acmelib"\n',
        'src/acmelib/__init__.py': '',
        'src/acmelib/helpers.py': 'def shout(text):\n    return text.upper()\n',
      },
    });

    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);
    groups.createGroup('g', 'acme', '');
    groups.addRepo('g', 'acme', 'app', '', join(root, 'app'));
    groups.addRepo('g', 'acme', 'lib', '', join(root, 'lib'));
    await indexer.indexGroup('g');

    /*
     * **A group entry and a graph on disk outlive each other.** Re-registering the repositories is the state a
     * reloaded store leaves behind: the files are indexed, and the entry that names their `projectId` is new — so
     * the linker has to address them by `fullName` until the next index. Both specifier shapes are exercised
     * because they take different lookups: one walks the path, the other asks the manifest.
     */
    groups.removeRepo('g', 'acme/app');
    groups.removeRepo('g', 'acme/lib');
    groups.addRepo('g', 'acme', 'app', '', join(root, 'app'));
    groups.addRepo('g', 'acme', 'lib', '', join(root, 'lib'));

    writeFileSync(
      join(root, 'app/src/app/late.py'),
      'from acmelib.helpers import shout\nfrom ../../lib/src/acmelib/helpers import shout\n',
    );

    await indexer.buildCrossRepoGraph('g');

    const late = store.getNodeByQualifiedName('file:acme/app:src/app/late.py')!;
    const incoming = store
      .getAllEdges()
      .filter((edge) => edge.type === 'IMPORTS' && edge.targetId === late.id);
    // One edge, because both statements ask the same file for the same name and the edge is per pair.
    expect(incoming).toHaveLength(1);
    expect(store.getNode(incoming[0]!.sourceId)!.filePath).toBe('src/acmelib/helpers.py');
  });
});

describe('a package member the indexer never turned into a node', () => {
  it('resolves on disk and produces no edge, because existence is decided by the graph', async () => {
    const app = checkout({
      'package.json': JSON.stringify({ name: 'acme-app', version: '1.0.0' }),
      'src/main.js': "import { thing } from 'acmelib/dist/index';\nexport const use = thing;\n",
    });
    const lib = checkout({
      'package.json': JSON.stringify({ name: 'acmelib', version: '1.0.0' }),
      'dist/index.js': 'export const thing = 1;\n',
      'src/index.js': 'export const other = 2;\n',
    });

    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);
    groups.createGroup('g', 'acme', '');
    groups.addRepo('g', 'acme', 'app', '', app);
    groups.addRepo('g', 'acme', 'lib', '', lib);
    await indexer.indexGroup('g');

    // `dist` is a directory the indexer skips, so the file the specifier names has no node to point an edge at.
    expect(workspaceEdges(store)).toEqual([]);
  });
});

describe('impact beyond the first hop', () => {
  /**
   * Three checkouts in a chain: `gateway` imports from `app`, and `app` imports from `lib`.
   *
   * **Only the second repository touches the changed symbol.** The chain is what makes the difference visible: a
   * symbol-filtered answer that reported every repository the walk reached would name `gateway` too, and
   * "everything depends on everything" is the answer that makes impact analysis useless.
   */
  async function chain(): Promise<{ indexer: CrossRepoIndexer; groupId: string }> {
    const store = new InMemoryGraphStore();
    const groups = new RepoGroupManager();
    const indexer = new CrossRepoIndexer(store, groups);

    groups.createGroup('g', 'acme', '');
    groups.addRepo(
      'g',
      'acme',
      'lib',
      '',
      checkout({
        'pyproject.toml': '[project]\nname = "acmelib"\n',
        'src/acmelib/__init__.py': '',
        'src/acmelib/api.py': 'def abort():\n    raise SystemExit(1)\n',
      }),
    );
    groups.addRepo(
      'g',
      'acme',
      'app',
      '',
      checkout({
        'pyproject.toml': '[project]\nname = "acme-app"\n',
        'src/app/__init__.py': '',
        'src/app/consumer.py': 'from acmelib.api import abort\n',
        'src/app/other.py': 'def other():\n    return 1\n',
      }),
    );
    groups.addRepo(
      'g',
      'acme',
      'gateway',
      '',
      checkout({
        'pyproject.toml': '[project]\nname = "acme-gateway"\n',
        'src/gateway/__init__.py': '',
        'src/gateway/use.py': 'from app.other import other\n',
      }),
    );

    await indexer.indexGroup('g');
    return { indexer, groupId: 'g' };
  }

  it('reports the repository that names the changed symbol, and not the one past it', async () => {
    const { indexer, groupId } = await chain();

    const impact = await indexer.analyzeCrossRepoImpact(groupId, 'acme/lib', ['abort']);

    expect(impact.affectedRepos).toEqual(['acme/app']);
    expect(impact.analysis.map((entry) => entry.repo)).toEqual(['acme/app']);
    expect(impact.analysis[0]!.affectedSymbols).toEqual(['abort']);
  });
});
