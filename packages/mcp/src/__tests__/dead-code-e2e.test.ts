// Story 10 as a user meets it: "what in here can never run?"
//
// **A unit test proves the pass computes; this proves the answer arrives.** The tool is the product surface — a user
// does not call `computeReachability`, they ask an agent, which calls `find_dead_code` with a project id and prints the
// text. So the case below builds a small repository's graph in the store the way the pipeline would, asks through the
// tool, and asserts on the text a user would read: the function nothing reaches is named, the function only a dead
// function reaches is named with it, and the library's front door is *not* named.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import { computeReachability } from '@code-analyzer/intelligence';
import { describe, expect, it } from 'vitest';

import deadCodeDetectionTool, {
  formatDeadCodeReport,
  graphOf,
} from '../tools/dead-code-detection.js';

import type { NewGraphEdge } from '@code-analyzer/infra';
import type { GraphEdge, GraphNode, NodeLabel } from '@code-analyzer/shared';

const PROJECT = 'story-10';

let nextId = 1;

function node(spec: {
  name: string;
  file: string;
  label?: NodeLabel;
  /** `null` is a symbol whose position the parser did not record, which the report has to print as a place. */
  line?: number | null;
  enclosingClass?: string;
  exported?: boolean;
}): GraphNode {
  const id = nextId++;
  const startLine = spec.line === undefined ? id : spec.line;
  return {
    id,
    projectId: PROJECT,
    label: spec.label ?? 'Function',
    name: spec.name,
    qualifiedName: `project:${PROJECT}:file:${spec.file}:${spec.name}`,
    filePath: spec.file,
    startLine,
    endLine: startLine === null ? null : startLine + 4,
    language: 'python',
    properties: {
      filePath: spec.file,
      ...(spec.enclosingClass === undefined ? {} : { enclosingClass: spec.enclosingClass }),
      ...(spec.exported === undefined ? {} : { exported: String(spec.exported) }),
    },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: spec.exported === true,
    fingerprint: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function edge(from: GraphNode, to: GraphNode, type: string): GraphEdge {
  return {
    id: nextId++,
    projectId: PROJECT,
    sourceId: from.id,
    targetId: to.id,
    type: type as GraphEdge['type'],
    properties: {},
    weight: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * **A real store, filled through its own API.**
 *
 * The tool asks `ToolContextImpl.getStore`, which answers only for an actual `InMemoryGraphStore` — an object shaped
 * like one is a fixture that passes a test the product would fail, so the fixture is the product's own store and the
 * ids come back from `insertNode` rather than from this file.
 */
function storeOf(
  nodes: GraphNode[],
  edges: GraphEdge[],
): { store: InMemoryGraphStore; ids: Map<GraphNode, number> } {
  const store = new InMemoryGraphStore();
  const ids = new Map<GraphNode, number>();
  for (const item of nodes) {
    const { id: _dropped, ...rest } = item;
    ids.set(item, store.insertNode(rest));
  }
  for (const item of edges) {
    const { id: _dropped, ...rest } = item;
    store.insertEdge({
      ...(rest as NewGraphEdge),
      sourceId: ids.get(
        nodes.find((candidate) => candidate.id === item.sourceId) as GraphNode,
      ) as number,
      targetId: ids.get(
        nodes.find((candidate) => candidate.id === item.targetId) as GraphNode,
      ) as number,
    });
  }
  return { store, ids };
}

/**
 * A repository with one live path and one dead subtree.
 *
 * ```
 * src/shop/__init__.py     Order                      <- the published surface
 * src/shop/app.py          main -> checkout          <- the executed surface
 * src/shop/app.py          checkout -> apply_discount
 * src/shop/legacy.py       _migrate_order -> _rewrite_row <- reachable from nothing
 * src/shop/app.py          Order.total  (public)     <- kept alive by being published
 * ```
 */
function repository(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const init = node({ name: '__init__.py', file: 'src/shop/__init__.py', label: 'File' });
  const appFile = node({ name: 'app.py', file: 'src/shop/app.py', label: 'File' });
  const main = node({ name: 'main', file: 'src/shop/app.py', line: 3 });
  const checkout = node({ name: 'checkout', file: 'src/shop/app.py', line: 10 });
  const discount = node({ name: 'apply_discount', file: 'src/shop/app.py', line: 20 });
  const order = node({
    name: 'Order',
    file: 'src/shop/__init__.py',
    label: 'Class',
    line: 1,
    exported: true,
  });
  const total = node({
    name: 'total',
    file: 'src/shop/__init__.py',
    line: 4,
    enclosingClass: 'Order',
  });
  const oldImport = node({ name: '_migrate_order', file: 'src/shop/legacy.py', line: 5 });
  const rewrite = node({ name: '_rewrite_row', file: 'src/shop/legacy.py', line: 30 });

  return {
    nodes: [init, appFile, main, checkout, discount, order, total, oldImport, rewrite],
    edges: [
      edge(main, checkout, 'CALLS'),
      edge(checkout, discount, 'CALLS'),
      // **`_rewrite_row` has an incoming call and is still dead**, because the only thing that calls it is dead too.
      edge(oldImport, rewrite, 'CALLS'),
    ],
  };
}

describe('the answer a user gets to "what can never run"', () => {
  it('names both the dead function and the one only it calls', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
    });
    expect(text).toContain('`_migrate_order`');
    expect(text).toContain('`_rewrite_row`');
    expect(text).toContain('2 symbols unreachable');
  });

  it('does not name the code a run reaches', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
    });
    expect(text).not.toContain('`main`');
    expect(text).not.toContain('`checkout`');
    expect(text).not.toContain('`apply_discount`');
  });

  it('puts the library front door in its own section rather than in the findings', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
    });
    expect(text).toContain('Not called here, but published');
    expect(text).toContain('`total`');
    // **The distinction the whole tool exists for**: vulture reports `Order.total` as unused, and it is the API.
    expect(text.indexOf('Not called here, but published')).toBeLessThan(text.indexOf('`total`'));
  });

  it('says which surface keeps each survivor alive, so a reader can disagree with the rule', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
    });
    // **The finding carries the name of the thing that keeps it alive**, not merely the category: a reader who
    // disagrees can go and check `Order` rather than argue with the word "published".
    // **A published symbol says so in its own words**, and a member of a published class names the class: the second
    // is the one that answers "why is `Order.total` not on the list" without the reader having to guess.
    expect(text).toContain('exported from a published package');
    const member = computeReachability(graphOf(storeOf(nodes, edges).store, PROJECT));
    expect(member.published.map((symbol) => symbol.because).join(' ')).toContain('public member');
  });

  it('narrows the answer by path when the user asks about one directory', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      filePattern: 'app.py',
    });
    expect(text).toContain('0 symbols unreachable');
    expect(text).not.toContain('`_migrate_order`');
  });

  it('lets the user name a handler the analysis cannot see being invoked', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      entryPoints: ['_migrate_order'],
    });
    expect(text).toContain('0 symbols unreachable');
  });

  it('truncates to the asked-for count and says how many are left', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      maxResults: 1,
    });
    expect(text).toContain('… and 1 more');
  });
});

// ---------------------------------------------------------------------------
// The sentences the report has to get right once, and the ones it must not say
// ---------------------------------------------------------------------------
//
// A report is read as prose, so the cases below are about the prose: a count of one is not "1 symbols", a symbol the
// caller asked to be silent about is not silently dropped without a line saying it was, and a section the caller turned
// off is absent rather than empty-looking.

describe('the report as prose', () => {
  it('says "1 symbol", and prints a place for a symbol whose line was never recorded', () => {
    const main = node({ name: 'main', file: 'src/shop/app.py', line: 3 });
    const orphan = node({ name: '_orphan', file: 'src/shop/legacy.py', line: null });
    const text = formatDeadCodeReport(
      graphOf(storeOf([main, orphan], [edge(main, main, 'CALLS')]).store, PROJECT),
      {
        projectId: PROJECT,
      },
    );
    expect(text).toContain('1 symbol unreachable');
    // **`src/shop/legacy.py:0`** is a worse place than a line number and a better one than nothing: a finding a reader
    // cannot open is a finding they cannot act on.
    expect(text).toContain('src/shop/legacy.py:0');
  });

  it('counts the symbols the caller asked it to stay quiet about', () => {
    const { nodes, edges } = repository();
    const single = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      ignoreNames: ['_migrate_order'],
    });
    expect(single).toContain('1 symbol ignored by name');
    const both = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      ignoreNames: ['_migrate_order', '_rewrite_row'],
    });
    expect(both).toContain('2 symbols ignored by name');
    // **Silence is reported, not applied**: a reader who named a symbol needs to know it was heard, otherwise the
    // absence of a finding reads as a finding of absence.
    expect(both).not.toContain('`_migrate_order`');
  });

  it('leaves the published section out when the caller turned it off', () => {
    const { nodes, edges } = repository();
    const text = formatDeadCodeReport(graphOf(storeOf(nodes, edges).store, PROJECT), {
      projectId: PROJECT,
      includePublished: false,
    });
    expect(text).not.toContain('Not called here, but published');
    expect(text).not.toContain('`total`');
  });

  it('truncates the published section too, and counts it the same way', () => {
    const main = node({ name: 'main', file: 'src/shop/app.py', line: 3 });
    const door = node({ name: '__init__.py', file: 'src/shop/__init__.py', label: 'File' });
    const first = node({ name: 'alpha', file: 'src/shop/__init__.py', line: null });
    const second = node({ name: 'beta', file: 'src/shop/__init__.py', line: 9 });
    const text = formatDeadCodeReport(
      graphOf(storeOf([door, main, first, second], [edge(main, main, 'CALLS')]).store, PROJECT),
      { projectId: PROJECT, maxResults: 1 },
    );
    expect(text).toContain('Not called here, but published');
    expect(text).toContain('… and 1 more');
    // The published section prints a place too, and a symbol whose line was never recorded still gets one.
    expect(text).toContain('src/shop/__init__.py:0');
  });

  it('refuses the question instead of answering it wrongly when the graph has no use edges', () => {
    const main = node({ name: 'main', file: 'src/shop/app.py', line: 3 });
    const alone = node({ name: '_alone', file: 'src/shop/app.py', line: 9 });
    const text = formatDeadCodeReport(graphOf(storeOf([main, alone], []).store, PROJECT), {
      projectId: PROJECT,
    });
    // **Every symbol would be a finding here**, which is a statement about the index and not about the code.
    expect(text).toContain('No use edges in this graph');
    expect(text).not.toContain('unreachable');
  });

  it('recovers the checkout root, so a machine directory named benchmarks owns no layout', () => {
    // **The failure the workflow found.** On a runner the checkout is unpacked under `.../benchmarks/corpora/`, and a
    // rule that reads an absolute path as a repository path then refuses to publish anything: the local run reported 0
    // findings on this corpus and the runner reported 164. The store carries the root as a `Folder` node, and that is
    // what `graphOf` hands to the pass.
    const checkout = '/home/runner/work/benchmarks/corpora/zod-3.23.8';
    const folder = node({ name: 'zod-3.23.8', file: checkout, label: 'Folder' });
    const door = node({ name: 'index.ts', file: `${checkout}/src/index.ts`, label: 'File' });
    const api = node({
      name: 'ZodType',
      file: `${checkout}/src/index.ts`,
      label: 'Class',
      exported: true,
    });
    const graph = graphOf(storeOf([folder, door, api], [edge(api, api, 'CALLS')]).store, PROJECT);
    expect(graph.rootPath).toBe(checkout);
    expect(computeReachability(graph).dead).toEqual([]);
    // **Without the root the same graph answers wrongly**, which is the defect stated as an assertion rather than as a
    // memory: the published surface is empty and the library's front door is a finding.
    expect(
      computeReachability({ ...graph, rootPath: '' }).dead.map((symbol) => symbol.name),
    ).toEqual(['ZodType']);
  });

  it('recovers the root from the files when the store has no folder node for it', () => {
    // **A store written by something other than the pipeline has no `Folder` node**, and the root is then the deepest
    // directory that contains every file — exact for one checkout, which is what a store holds.
    const checkout = '/opt/checkouts/shop';
    const api = node({
      name: 'Order',
      file: `${checkout}/src/index.ts`,
      label: 'Class',
      exported: true,
    });
    const spec = node({ name: 'helper', file: `${checkout}/tests/test_order.py`, line: 4 });
    const graph = graphOf(storeOf([api, spec], [edge(api, api, 'CALLS')]).store, PROJECT);
    expect(graph.rootPath).toBe(checkout);
    // **`tests/` is still the repository's own directory**, so the helper beside a test is not published.
    expect(computeReachability(graph).dead.map((symbol) => symbol.name)).toEqual(['helper']);
  });

  it('recovers no root at all when the files span two checkouts', () => {
    // **Inventing a root for a cross-repo graph would hide a package's own entry module**, so the answer is "none" and
    // the rules read the paths as they are.
    const api = node({ name: 'Order', file: '/one/src/index.ts', label: 'Class', exported: true });
    const other = node({ name: 'helper', file: '/two/src/util.py', line: 9 });
    const graph = graphOf(storeOf([api, other], [edge(api, api, 'CALLS')]).store, PROJECT);
    expect(graph.rootPath).toBe('');
  });

  it('strips a root written with the other separator', () => {
    // **The same rule on a machine that spells paths differently.** `C:\repo` is the root and `C:\repo\src\index.ts`
    // is the entry module, so the name is published rather than reported.
    const checkout = 'C:\\repo';
    const folder = node({ name: 'repo', file: checkout, label: 'Folder' });
    const api = node({
      name: 'Order',
      file: 'C:\\repo\\src\\index.ts',
      label: 'Class',
      exported: true,
    });
    const graph = graphOf(storeOf([folder, api], [edge(api, api, 'CALLS')]).store, PROJECT);
    expect(graph.rootPath).toBe(checkout);
    expect(computeReachability(graph).dead).toEqual([]);
  });

  it('recovers a drive-letter root from the files alone', () => {
    // **No `Folder` node, and a root that carries its drive**: the recovered prefix must not grow a leading separator,
    // because `C:/repo` is already absolute and `/C:/repo` is not a path any machine has.
    const api = node({
      name: 'Order',
      file: 'C:\\repo\\src\\index.ts',
      label: 'Class',
      exported: true,
    });
    const spec = node({ name: 'helper', file: 'C:\\repo\\tests\\test_order.py', line: 4 });
    const graph = graphOf(storeOf([api, spec], [edge(api, api, 'CALLS')]).store, PROJECT);
    expect(graph.rootPath).toBe('C:/repo');
    // The entry module is still found in `src`, so the class is published and only the test helper is a finding.
    expect(computeReachability(graph).dead.map((symbol) => symbol.name)).toEqual(['helper']);
  });

  it('refuses to answer for a store whose nodes carry no path at all', async () => {
    const { id: _dropped, ...floating } = node({ name: 'detached', file: 'src/shop/app.py' });
    const store = new InMemoryGraphStore();
    store.insertNode({ ...floating, filePath: null });
    const graph = graphOf(store, PROJECT);
    // **A project with no paths has no root**, and the report says the question cannot be answered rather than
    // answering it about nothing.
    expect(graph.rootPath).toBe('');
    const result = await deadCodeDetectionTool.handler({ projectId: PROJECT }, store);
    expect(String((result.content[0] as { text: string }).text)).toContain('No use edges');
  });

  it('takes the shortest folder node that holds every file, whatever order they arrive in', () => {
    // **A store is not obliged to hand its folders in any order**, and both orders have to agree: the deepest folder that
    // covers every file is the root, and a folder that covers only a subtree is not a candidate.
    const files = [
      node({ name: 'index.ts', file: 'C:/repo/src/index.ts', label: 'File' }),
      node({ name: 'Order', file: 'C:/repo/src/index.ts', label: 'Class', exported: true }),
    ];
    const deepest = node({ name: 'src', file: 'C:/repo/src', label: 'Folder' });
    const outer = node({ name: 'repo', file: 'C:/repo', label: 'Folder' });
    const wrong = node({ name: 'tools', file: 'C:/repo/tools', label: 'Folder' });
    const edges = [edge(files[1] as GraphNode, files[1] as GraphNode, 'CALLS')];
    const deepestFirst = graphOf(storeOf([wrong, deepest, outer, ...files], edges).store, PROJECT);
    const outerFirst = graphOf(storeOf([wrong, outer, deepest, ...files], edges).store, PROJECT);
    expect(deepestFirst.rootPath).toBe('C:/repo');
    expect(outerFirst.rootPath).toBe('C:/repo');
  });

  it('ignores the nodes and the edges of another project in the same store', () => {
    const { nodes, edges } = repository();
    const { store } = storeOf(nodes, edges);
    const { id: _foreignId, ...foreign } = node({ name: '_foreign', file: 'other/x.py' });
    const inserted = store.insertNode({ ...foreign, projectId: 'another-project' });
    const { id: _localId, ...local } = node({ name: '_local', file: 'other/y.py' });
    const localId = store.insertNode(local);
    store.insertEdge({
      projectId: 'another-project',
      sourceId: inserted,
      targetId: localId,
      type: 'CALLS',
    });
    const graph = graphOf(store, PROJECT);
    expect([...graph.nodes.values()].some((item) => item.name === '_foreign')).toBe(false);
    expect([...graph.edges.values()].some((item) => item.projectId !== PROJECT)).toBe(false);
    expect([...graph.nodes.values()].some((item) => item.name === '_local')).toBe(true);
  });
});

describe('the tool a client invokes', () => {
  it('is registered under a name, a description and a schema that requires a project', () => {
    expect(deadCodeDetectionTool.name).toBe('find_dead_code');
    expect(deadCodeDetectionTool.description.length).toBeGreaterThan(0);
    expect(deadCodeDetectionTool.inputSchema['required']).toContain('projectId');
  });

  it('answers through the handler with the report and a metadata census', async () => {
    const { nodes, edges } = repository();
    const result = await deadCodeDetectionTool.handler(
      { projectId: PROJECT },
      storeOf(nodes, edges).store,
    );
    expect(result.isError).toBeUndefined();
    const text = String((result.content[0] as { text: string }).text);
    expect(text).toContain('`_migrate_order`');
    expect(result.metadata?.['unreachable']).toBe(2);
    // **Three call edges**: the live pair and the dead pair's internal one, which is the point of the case.
    expect(result.metadata?.['callEdges']).toBe(3);
  });

  it('refuses rather than guesses when the project was never indexed', async () => {
    const result = await deadCodeDetectionTool.handler(
      { projectId: 'missing' },
      storeOf([], []).store,
    );
    expect(result.isError).toBe(true);
    expect(String((result.content[0] as { text: string }).text)).toContain('Index it first');
  });

  it('refuses when there is no store at all', async () => {
    const result = await deadCodeDetectionTool.handler({ projectId: PROJECT });
    expect(result.isError).toBe(true);
  });

  it('counts test roots only when the caller asks for them', async () => {
    const test = node({ name: 'test_checkout', file: 'tests/test_shop.py', line: 4 });
    const helper = node({ name: 'build_order', file: 'tests/test_shop.py', line: 9 });
    const { store } = storeOf([test, helper], [edge(test, helper, 'CALLS')]);
    // **The default answers "what is dead in the program"**, and a test helper nothing calls is outside that question.
    const silent = await deadCodeDetectionTool.handler({ projectId: PROJECT }, store);
    expect(silent.metadata?.['unreachable']).toBe(2);
    // **`includeTests: true` asks the other question** — what in the suite is dead — and the runner then roots the
    // test, which roots the helper it calls.
    const asked = await deadCodeDetectionTool.handler(
      { projectId: PROJECT, includeTests: true },
      store,
    );
    expect(asked.metadata?.['unreachable']).toBe(0);
  });

  it('treats a missing project id as an empty one and refuses', async () => {
    const result = await deadCodeDetectionTool.handler({}, storeOf([], []).store);
    expect(result.isError).toBe(true);
    expect(String((result.content[0] as { text: string }).text)).toContain(
      'No graph found for project ""',
    );
  });
});
