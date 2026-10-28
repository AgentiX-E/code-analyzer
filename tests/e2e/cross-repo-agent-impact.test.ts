// The user story an agent asks: *what breaks in my other repositories?* — end to end, through the tools.
//
// **Two checkouts, one graph, and the tools an agent actually calls.** `cross_repo_impact` and `cross_repo_trace`
// answered from `CALLS` edges until now, and an import between two separately released packages does not create one:
// on flask 3.0.3 + werkzeug 3.0.3 the tools reported nothing while the library reported 49 impacted files. This
// suite is the acceptance test for that gap — it builds the checkouts, indexes them, registers the group the way a
// session does, and asks the questions through the registry rather than through the engine.
//
// **The graph is produced by the production indexer from real directories**, not assembled by hand: what is under
// test is the whole path from two `pyproject.toml` files to an answer an agent reads.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { CrossRepoIndexer, RepoGroupManager } from '@code-analyzer/intelligence';
import { ToolContextImpl, createToolRegistry } from '@code-analyzer/mcp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolRegistry } from '@code-analyzer/mcp';

const GROUP = 'acme-group';

/** `shout` is declared in `helpers.py` and re-exported by the package root, which is what the app imports. */
const LIBRARY = {
  'pyproject.toml': '[project]\nname = "acmelib"\n',
  'src/acmelib/__init__.py': 'from .helpers import shout\n\n__all__ = ["shout"]\n',
  'src/acmelib/helpers.py': 'def shout(text):\n    return text.upper()\n',
};

const APP = {
  'pyproject.toml': '[project]\nname = "acme-app"\n',
  'src/app/main.py': 'from acmelib import shout\n\nprint(shout("hi"))\n',
};

let roots: string[] = [];
let store: InMemoryGraphStore;
let context: ToolContextImpl;
let registry: ToolRegistry;

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function checkout(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cross-repo-mcp-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf-8');
  }
  return root;
}

async function indexTwoRepositories(): Promise<void> {
  const groups = new RepoGroupManager();
  groups.createGroup(GROUP, 'acme', '');
  groups.addRepo(GROUP, 'acme', 'lib', '', checkout(LIBRARY));
  groups.addRepo(GROUP, 'acme', 'app', '', checkout(APP));
  await new CrossRepoIndexer(store, groups).indexGroup(GROUP);
}

/** The qualified name of the `shout` declaration, which is how an agent addresses a symbol. */
function shoutQName(): string {
  const node = store
    .getAllNodes()
    .find((candidate) => candidate.name === 'shout' && candidate.projectId === 'acme/lib');
  if (!node) throw new Error('the fixture declares no `shout` in acme/lib');
  return node.qualifiedName;
}

async function ask(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await registry.execute(tool, args, context);
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0]!.text!) as Record<string, unknown>;
}

describe('an agent asking what breaks in the other repository', () => {
  beforeEach(async () => {
    store = new InMemoryGraphStore();
    context = new ToolContextImpl(store);
    registry = createToolRegistry();
    await indexTwoRepositories();
    // **Registered the way a session registers one**: through the tool, which writes to the process-wide manager
    // rather than to the context's. A read that only consulted the context's manager would report "no group".
    await registry.execute(
      'manage_repo_group',
      { action: 'create', groupId: GROUP, name: 'acme', repos: ['acme/lib', 'acme/app'] },
      context,
    );
  });

  it('reports the repository that imports the symbol, from the measured engine', async () => {
    const answer = await ask('cross_repo_impact', { symbol: shoutQName(), groupId: GROUP });

    expect(answer['source']).toBe('cross-repo-indexer');
    expect(answer['changedRepo']).toBe('acme/lib');
    expect(answer['impactedRepos']).toEqual([
      expect.objectContaining({
        repo: 'acme/app',
        affectedSymbols: ['shout'],
        affectedFiles: ['src/app/main.py'],
        impactLevel: 'high',
      }),
    ]);
    expect(answer['riskLevel']).toBe('high');
    expect(answer['affectedFiles']).toEqual(['src/app/main.py']);
  });

  it('traces the symbol into the importing file, at depth one and with the names the statement asked for', async () => {
    const answer = await ask('cross_repo_trace', { sourceSymbol: shoutQName(), groupId: GROUP });

    expect(answer['source']).toBe('cross-repo-indexer');
    const edges = answer['crossRepoEdges'] as Array<Record<string, unknown>>;
    expect(edges).toContainEqual(
      expect.objectContaining({
        fromRepo: 'acme/lib',
        toRepo: 'acme/app',
        toSymbol: 'shout',
        depth: 1,
        confidence: 'high',
      }),
    );
    expect(answer['reposVisited']).toContain('acme/app');
    expect(answer['path']).toContainEqual(
      expect.objectContaining({ repo: 'acme/app', symbol: 'shout', depth: 1 }),
    );
  });

  it('stops the depth filter at the edges the caller asked for', async () => {
    // `depth: 0` keeps only the source itself: the engine's depth-1 hop is excluded rather than clamped.
    const answer = await ask('cross_repo_trace', {
      sourceSymbol: shoutQName(),
      groupId: GROUP,
      depth: 0,
    });

    expect(answer['crossRepoEdges']).toEqual([]);
    expect(answer['reposVisited']).toEqual([]);
  });

  it('falls back to the call graph, and says so, when the group does not hold the symbol', async () => {
    // **The old answer is still an answer**: a graph with `CALLS` edges and no group is the state this tool has
    // always worked in, and a reader can tell the two apart from `source`.
    const answer = await ask('cross_repo_impact', {
      symbol: shoutQName(),
      groupId: 'no-such-group',
    });

    expect(answer['source']).toBe('call-graph');
    expect(answer['impactedRepos']).toEqual([]);
  });
});
