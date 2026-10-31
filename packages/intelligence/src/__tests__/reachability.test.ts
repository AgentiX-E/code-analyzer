// The reachability question, asked on graphs small enough to check by hand.
//
// **Every case here is a shape the first draft got wrong**, and the first draft is in the repository's history as
// `impact/unreachable-functions.ts`: "a function with no incoming `CALLS` edge is a candidate". On `pallets/flask@3.0.3`
// that reported **979 of 1 109 functions**, which is a report about the question rather than about the code.
//
// So the cases are ordered by what they separate: a callee of dead code is dead (the property an edge count cannot
// express), a published class keeps its public members alive and not its private ones, a decorated function is invoked
// by its decorator, a mention is a dependency, and an importing module runs its top level.

import { describe, expect, it } from 'vitest';

import { computeReachability, publishedRoots } from '../impact/reachability.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeLabel } from '@code-analyzer/shared';

const PROJECT = 'p1';

interface NodeSpec {
  name: string;
  file: string;
  label?: NodeLabel;
  /** `null` is a node whose position the parser did not record — a caller can hand the pass one. */
  line?: number | null;
  enclosingClass?: string;
  decoratorNames?: string;
  exported?: boolean;
  language?: string;
}

let nextId = 1;

function makeNode(spec: NodeSpec): GraphNode {
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
    endLine: startLine === null ? null : startLine + 5,
    language: spec.language ?? 'python',
    properties: {
      filePath: spec.file,
      ...(spec.enclosingClass === undefined ? {} : { enclosingClass: spec.enclosingClass }),
      ...(spec.decoratorNames === undefined ? {} : { decoratorNames: spec.decoratorNames }),
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

function makeFile(file: string): GraphNode {
  return makeNode({ name: file.split('/').pop() ?? file, file, label: 'File', language: 'python' });
}

function makeRoute(name: string, file: string): GraphNode {
  return makeNode({ name, file, label: 'Route', language: 'python' });
}

interface EdgeSpec {
  from: number;
  to: number;
  type: string;
}

function makeGraph(nodes: GraphNode[], edges: EdgeSpec[]): KnowledgeGraph {
  const graph: KnowledgeGraph = {
    projectId: PROJECT,
    nodes: new Map(nodes.map((node) => [node.id, node])),
    edges: new Map(),
    qnameIndex: new Map(nodes.map((node) => [node.qualifiedName, node.id])),
    fileIndex: new Map(
      nodes.filter((node) => node.label === 'File').map((node) => [String(node.filePath), node.id]),
    ),
  };
  edges.forEach((spec, index) => {
    const edgeId = 10_000 + index;
    const edge: GraphEdge = {
      id: edgeId,
      projectId: PROJECT,
      sourceId: spec.from,
      targetId: spec.to,
      type: spec.type as GraphEdge['type'],
      properties: {},
      weight: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    graph.edges.set(edgeId, edge);
  });
  return graph;
}

describe('the graph cannot answer the question', () => {
  it('reports no findings and says why when there is not one call edge', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const helper = makeNode({ name: 'helper', file: 'app.py' });
    const report = computeReachability(makeGraph([main, helper], []));
    // **A graph with no call edges makes every function look dead**, and a report of "all of them" is a missing
    // prerequisite wearing a finding's clothes.
    expect(report.dead).toEqual([]);
    expect(report.callEdges).toBe(0);
    expect(report.considered).toBe(2);
  });

  it('counts the call edges it was given, so the figure can be read against the graph', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const helper = makeNode({ name: 'helper', file: 'app.py' });
    const report = computeReachability(
      makeGraph([main, helper], [{ from: main.id, to: helper.id, type: 'CALLS' }]),
    );
    expect(report.callEdges).toBe(1);
  });
});

describe('a symbol is dead only when neither surface reaches it', () => {
  it('finds a callee of dead code dead, which an edge count cannot', () => {
    const main = makeNode({ name: 'main', file: 'app.py', line: 1 });
    const orphan = makeNode({ name: 'orphan', file: 'app.py', line: 10 });
    const below = makeNode({ name: 'below', file: 'app.py', line: 20 });
    const report = computeReachability(
      makeGraph(
        [main, orphan, below],
        [
          { from: main.id, to: main.id, type: 'CALLS' },
          // `orphan` calls `below`, so `below` has an incoming edge — and is still unreachable, because the only
          // thing that calls it is itself unreachable. **This is the property that makes the pass a reachability
          // pass**, and the one every edge-counting tool in the field lacks.
          { from: orphan.id, to: below.id, type: 'CALLS' },
        ],
      ),
    );
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['orphan', 'below']);
  });

  it('keeps a symbol reached transitively from `main`', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const middle = makeNode({ name: 'middle', file: 'app.py' });
    const leaf = makeNode({ name: 'leaf', file: 'lib/util.py' });
    const report = computeReachability(
      makeGraph(
        [main, middle, leaf],
        [
          { from: main.id, to: middle.id, type: 'CALLS' },
          { from: middle.id, to: leaf.id, type: 'CALLS' },
        ],
      ),
    );
    expect(report.dead).toEqual([]);
    expect(report.reachableFromEntry).toBeGreaterThanOrEqual(3);
  });

  it('treats a mention as a dependency, because a callback is invoked by something else', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const callback = makeNode({ name: '_set_app', file: 'app.py' });
    const report = computeReachability(
      makeGraph(
        [main, callback],
        [
          { from: main.id, to: main.id, type: 'CALLS' },
          // `_app_option = click.Option(callback=_set_app)` — no call, one dependency.
          { from: main.id, to: callback.id, type: 'ACCESSES' },
        ],
      ),
    );
    expect(report.dead).toEqual([]);
  });

  it('reaches a module-level mention from a file that anything reached makes reachable', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const otherFile = makeFile('cli.py');
    const callback = makeNode({ name: '_set_app', file: 'cli.py' });
    const report = computeReachability(
      makeGraph(
        [main, otherFile, callback],
        [
          { from: main.id, to: main.id, type: 'CALLS' },
          // The mention is at module scope, so it belongs to the file — and the file becomes reachable because
          // `main` is defined in it? No: because the graph links every symbol to its own file, and `main` is in
          // `app.py`. So this case states the other half: a file is reachable only through what it defines.
          { from: otherFile.id, to: callback.id, type: 'ACCESSES' },
        ],
      ),
    );
    // `cli.py` defines nothing reachable, so the mention inside it does not travel: a file is not a root.
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['_set_app']);
  });

  it('carries a module-level mention along when the file itself is reached', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const otherFile = makeFile('cli.py');
    const defined = makeNode({ name: 'run_command', file: 'cli.py' });
    const callback = makeNode({ name: '_set_app', file: 'cli.py' });
    const report = computeReachability(
      makeGraph(
        [main, otherFile, defined, callback],
        [
          { from: main.id, to: main.id, type: 'CALLS' },
          { from: main.id, to: defined.id, type: 'CALLS' },
          { from: otherFile.id, to: callback.id, type: 'ACCESSES' },
        ],
      ),
    );
    // `run_command` is reached from `main`, its file becomes reachable with it, and the file's top level — the
    // `callback=_set_app` statement — runs. **This is the chain that made 38 of the first measurement's 39 findings
    // disappear.**
    expect(report.dead).toEqual([]);
  });
});

describe('the executed surface', () => {
  it('roots a function the runtime calls by name', () => {
    const main = makeNode({ name: 'main', file: 'app.py' });
    const called = makeNode({ name: 'work', file: 'app.py' });
    const report = computeReachability(
      makeGraph([main, called], [{ from: main.id, to: called.id, type: 'CALLS' }]),
    );
    expect(report.roots.map((root) => root.kind)).toContain('entry');
    expect(report.roots.find((root) => root.nodeId === main.id)?.because).toContain('runtime');
  });

  it('roots a test, because a runner collects it and nothing calls it', () => {
    const test = makeNode({ name: 'test_it_works', file: 'tests/test_app.py' });
    const helper = makeNode({ name: 'build', file: 'tests/test_app.py' });
    const report = computeReachability(
      makeGraph([test, helper], [{ from: test.id, to: helper.id, type: 'CALLS' }]),
    );
    expect(report.dead).toEqual([]);
    expect(report.roots.find((root) => root.nodeId === test.id)?.kind).toBe('test');
  });

  it('roots a route, because a framework dispatches it', () => {
    const handler = makeNode({ name: 'index', file: 'app.py' });
    const route = makeRoute('GET /', 'app.py');
    const report = computeReachability(
      makeGraph([handler, route], [{ from: route.id, to: handler.id, type: 'HANDLES_ROUTE' }]),
    );
    expect(report.dead).toEqual([]);
    expect(report.roots.some((root) => root.kind === 'route')).toBe(true);
  });

  it('roots a dunder, because the interpreter invokes it by syntax', () => {
    const init = makeNode({ name: '__init__', file: 'app.py' });
    const report = computeReachability(
      makeGraph([init], [{ from: 999, to: init.id, type: 'CALLS' }]),
    );
    expect(report.dead).toEqual([]);
    expect(report.roots[0]?.because).toContain('interpreter');
  });

  it('roots a decorated definition, because the decorator is the invocation', () => {
    const fixture = makeNode({
      name: 'client',
      file: 'conftest.py',
      decoratorNames: 'pytest.fixture',
    });
    const report = computeReachability(
      makeGraph([fixture], [{ from: 999, to: fixture.id, type: 'CALLS' }]),
    );
    expect(report.dead).toEqual([]);
    expect(report.roots[0]?.because).toContain('pytest.fixture');
  });

  it('lets a caller declare an entry point by name', () => {
    const handler = makeNode({ name: 'on_message', file: 'worker.py' });
    const report = computeReachability(
      makeGraph([handler], [{ from: handler.id, to: handler.id, type: 'CALLS' }]),
      {
        entryPoints: ['on_message'],
      },
    );
    expect(report.dead).toEqual([]);
    expect(report.roots[0]?.kind).toBe('declared');
  });

  it('ignores a name the caller says this analysis cannot model', () => {
    const orphan = makeNode({ name: '_dispatched_by_name', file: 'app.py' });
    const report = computeReachability(
      makeGraph([orphan], [{ from: 999, to: orphan.id, type: 'CALLS' }]),
      {
        ignoreNames: ['_dispatched_by_name'],
      },
    );
    expect(report.dead).toEqual([]);
    expect(report.ignored).toBe(1);
  });

  it('reports a helper in a test file as dead when nothing in it calls the helper', () => {
    const test = makeNode({ name: 'test_it_works', file: 'tests/test_app.py' });
    const stale = makeNode({ name: 'unused_helper', file: 'tests/test_app.py' });
    const report = computeReachability(
      makeGraph([test, stale], [{ from: test.id, to: test.id, type: 'CALLS' }]),
    );
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['unused_helper']);
  });
});

describe('the published surface', () => {
  it('finds the packages a layout publishes', () => {
    const files = [
      makeFile('src/flask/__init__.py'),
      makeFile('src/flask/app.py'),
      makeFile('examples/tutorial/tutorial/__init__.py'),
      makeFile('tests/__init__.py'),
    ];
    const published = publishedRoots(makeGraph(files, []));
    // `flask` is a package under `src/`; `tutorial` sits two levels down inside an example; `tests` is not published.
    expect([...published]).toEqual(['flask']);
  });

  it('keeps a public member of a published class alive and not a private one', () => {
    const init = makeNode({
      name: 'Flask',
      file: 'src/flask/__init__.py',
      label: 'Class',
      exported: true,
    });
    const cls = makeNode({
      name: 'Flask',
      file: 'src/flask/app.py',
      label: 'Class',
      exported: true,
      language: 'python',
    });
    const run = makeNode({ name: 'run', file: 'src/flask/app.py', enclosingClass: 'Flask' });
    const internal = makeNode({
      name: '_prune',
      file: 'src/flask/app.py',
      enclosingClass: 'Flask',
    });
    const report = computeReachability(
      makeGraph(
        [init, cls, run, internal],
        // A call edge somewhere, because without one the pass refuses to answer at all.
        [{ from: run.id, to: internal.id, type: 'CALLS' }],
      ),
    );
    // `run` is published, `_prune` is reached only through it — which is a path, so neither is a finding.
    expect(report.dead).toEqual([]);
    const names = report.roots.map((root) => root.because);
    expect(names.some((because) => because.includes('public member'))).toBe(true);
  });

  it('reports a private member nothing reaches as dead, and names the rule', () => {
    const cls = makeNode({
      name: 'Flask',
      file: 'src/flask/app.py',
      label: 'Class',
      exported: true,
    });
    const public_ = makeNode({ name: 'run', file: 'src/flask/app.py', enclosingClass: 'Flask' });
    const internal = makeNode({
      name: '_prune',
      file: 'src/flask/app.py',
      enclosingClass: 'Flask',
    });
    const report = computeReachability(
      makeGraph([cls, public_, internal], [{ from: public_.id, to: public_.id, type: 'CALLS' }]),
    );
    const dead = report.dead.find((symbol) => symbol.name === '_prune');
    expect(dead?.because).toContain('not a public member');
  });

  it('keeps the members of a published class published, so the API is not called dead', () => {
    const file = makeNode({ name: '__init__.py', file: 'src/flask/__init__.py', label: 'File' });
    const cls = makeNode({
      name: 'Flask',
      file: 'src/flask/app.py',
      label: 'Class',
      exported: true,
    });
    const method = makeNode({
      name: 'test_client',
      file: 'src/flask/app.py',
      enclosingClass: 'Flask',
    });
    const report = computeReachability(
      makeGraph([file, cls, method], [{ from: method.id, to: method.id, type: 'CALLS' }]),
    );
    expect(report.dead).toEqual([]);
    // **The class is in this list too**, and that is the report being right: nothing inside the repository calls
    // `Flask`, the published surface is what keeps it alive, and a reader who wants to know what the front door is
    // gets the two names rather than one.
    expect(report.published.map((symbol) => symbol.name)).toEqual(['Flask', 'test_client']);
  });

  it('does not publish a symbol outside a package the repository ships', () => {
    const example = makeNode({
      name: 'create_app',
      file: 'examples/tutorial/flaskr/__init__.py',
      exported: true,
    });
    const report = computeReachability(
      makeGraph([example], [{ from: example.id, to: example.id, type: 'CALLS' }]),
    );
    // **`examples/` is not published**: the module is imported by the example's own entry point, which is a root only
    // if the caller says so — so this function is a finding, and the caller's answer is `entryPoints`.
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['create_app']);
  });

  it('publishes an exported TypeScript symbol and not an unexported one', () => {
    const exported = makeNode({
      name: 'z',
      file: 'src/index.ts',
      language: 'typescript',
      exported: true,
    });
    const internal = makeNode({
      name: 'makeZodArray',
      file: 'src/types.ts',
      language: 'typescript',
      exported: false,
    });
    const report = computeReachability(
      makeGraph([exported, internal], [{ from: exported.id, to: exported.id, type: 'CALLS' }]),
    );
    expect(report.published.map((symbol) => symbol.name)).toEqual(['z']);
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['makeZodArray']);
  });
});

describe('what the pass deliberately does not look at', () => {
  it('skips a stub, a document and a file it cannot read', () => {
    const stub = makeNode({ name: '_declared_elsewhere', file: 'src/pkg/types.pyi' });
    const heading = makeNode({ name: 'Sansio', file: 'src/pkg/README.md', language: 'markdown' });
    const code = makeNode({ name: 'real', file: 'src/pkg/app.py' });
    const report = computeReachability(
      makeGraph([stub, heading, code], [{ from: code.id, to: code.id, type: 'CALLS' }]),
    );
    // **A `.pyi` declares the shape of code that lives elsewhere and a heading in a README is not a symbol**: both
    // would be findings in every repository, which is a report about the file filter.
    expect(report.considered).toBe(1);
    expect(report.dead.map((symbol) => symbol.name)).toEqual(['real']);
  });

  it('orders findings by file and line, so two runs read the same', () => {
    const first = makeNode({ name: 'zeta', file: 'a.py', line: 40 });
    const second = makeNode({ name: 'alpha', file: 'a.py', line: 10 });
    const third = makeNode({ name: 'beta', file: 'b.py', line: 5 });
    const report = computeReachability(
      makeGraph([first, second, third], [{ from: 999, to: first.id, type: 'CALLS' }]),
    );
    expect(report.dead.map((symbol) => `${symbol.filePath}:${String(symbol.startLine)}`)).toEqual([
      'a.py:10',
      'a.py:40',
      'b.py:5',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The rules the measurement forced out
// ---------------------------------------------------------------------------
//
// Every case below was a wrong finding on a real checkout before the rule existed, and the rule is written here so that
// removing it fails a test rather than quietly re-opening the class of false positive it closed.
//
// **The graphs carry a root and at least one use edge on purpose**: with neither, every symbol is unreachable and the
// pass answers "the prerequisite is missing" rather than reporting a repository as empty.

describe('virtual dispatch, and the edges that are not in the graph', () => {
  it('keeps an override alive when its base method is called', () => {
    const base = makeNode({ name: 'Scaffold', file: 'src/pkg/scaffold.py', label: 'Class' });
    const app = makeNode({ name: 'App', file: 'src/pkg/app.py', label: 'Class' });
    const entry = makeNode({ name: 'main', file: 'src/pkg/scaffold.py', line: 45 });
    const declared = makeNode({
      name: '_check_setup_finished',
      file: 'src/pkg/scaffold.py',
      line: 220,
      enclosingClass: 'Scaffold',
    });
    const override = makeNode({
      name: '_check_setup_finished',
      file: 'src/pkg/app.py',
      line: 413,
      enclosingClass: 'App',
    });
    const report = computeReachability(
      makeGraph(
        [base, app, entry, declared, override],
        [
          { from: app.id, to: base.id, type: 'EXTENDS' },
          { from: entry.id, to: app.id, type: 'CALLS' },
          { from: entry.id, to: declared.id, type: 'CALLS' },
        ],
      ),
    );
    // **`self.m()` in the base reaches the override.** The graph carries `EXTENDS` and no `METHOD_OVERRIDES` at all —
    // measured on `pallets/flask@3.0.3`, where both overrides of `_check_setup_finished` were reported as dead.
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
  });

  it('does not join two classes that merely declare the same method name', () => {
    const left = makeNode({ name: 'Left', file: 'src/pkg/a.py', label: 'Class' });
    const right = makeNode({ name: 'RightGlobals', file: 'src/pkg/b.py', label: 'Class' });
    const entry = makeNode({ name: 'main', file: 'src/pkg/a.py', line: 90 });
    const live = makeNode({ name: 'get', file: 'src/pkg/a.py', line: 12, enclosingClass: 'Left' });
    const dead = makeNode({
      name: 'get',
      file: 'src/pkg/b.py',
      line: 12,
      enclosingClass: 'RightGlobals',
    });
    const report = computeReachability(
      makeGraph(
        [left, right, entry, live, dead],
        [
          { from: entry.id, to: left.id, type: 'CALLS' },
          { from: entry.id, to: right.id, type: 'CALLS' },
          { from: entry.id, to: live.id, type: 'CALLS' },
        ],
      ),
    );
    // **Two unrelated hierarchies are two slots.** Joining by name alone is the "anything called `get` is alive" rule:
    // conservative, useless, and it would have kept every finding in the corpus out of the report.
    expect(report.dead.map((symbol) => `${symbol.filePath}:${String(symbol.startLine)}`)).toEqual([
      'src/pkg/b.py:12',
    ]);
  });

  it('lists a method as its class declares it through HAS_METHOD', () => {
    const entry = makeNode({
      name: 'Redis',
      file: 'lib/index.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const owner = makeNode({
      name: 'Cluster',
      file: 'lib/cluster/index.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const method = makeNode({
      name: 'quit',
      file: 'lib/cluster/index.ts',
      label: 'Method',
      language: 'typescript',
    });
    const report = computeReachability(
      makeGraph(
        [entry, owner, method],
        [
          { from: owner.id, to: method.id, type: 'HAS_METHOD' },
          { from: owner.id, to: owner.id, type: 'CALLS' },
        ],
      ),
    );
    // **The TypeScript provider records containment as an edge, not as `enclosingClass`.** Reading only the property
    // left every TypeScript method parentless: 51 of 51 findings on `redis/ioredis@5.4.2` were methods of the four
    // classes the package exports by name.
    // The published surface keeps the class alive, the class keeps the member alive, and the report names both: a
    // finding's evidence has to be a symbol a reader can find, not a category.
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
    expect(report.published.map((symbol) => symbol.name).sort()).toEqual([
      'Cluster',
      'Redis',
      'quit',
    ]);
  });
});

describe('what counts as published, and what counts as a program', () => {
  it('publishes a package whose entry module is the source directory itself', () => {
    const entry = makeNode({
      name: 'z',
      file: '/tmp/zod/src/index.ts',
      language: 'typescript',
      exported: true,
    });
    const sibling = makeNode({
      name: 'ZodError',
      file: '/tmp/zod/src/ZodError.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const graph = makeGraph([entry, sibling], []);
    // **`src/index.ts` publishes `src`.** The first rule asked whether the entry's *grandparent* was `src`, which holds
    // for `src/flask/__init__.py` and not for a package that is `src`: on `colinhacks/zod@3.23.8` the published surface
    // came back empty and all 191 exported symbols were reported dead.
    expect([...publishedRoots(graph)]).toEqual(['src']);
  });

  it('does not publish a package that lives under a directory a repository ships beside it', () => {
    const fixture = makeNode({ name: 'helper', file: 'tests/fixtures/pkg/__init__.py' });
    expect([...publishedRoots(makeGraph([fixture], []))]).toEqual([]);
  });

  it('treats an exported interface in a published package as a public name', () => {
    const entry = makeNode({
      name: 'z',
      file: '/tmp/zod/src/index.ts',
      language: 'typescript',
      exported: true,
    });
    const contract = makeNode({
      name: 'ZodTypeDef',
      file: '/tmp/zod/src/types.ts',
      label: 'Interface',
      language: 'typescript',
      exported: true,
    });
    const report = computeReachability(
      makeGraph([entry, contract], [{ from: entry.id, to: entry.id, type: 'CALLS' }]),
    );
    // **TypeScript erases it, and a consumer still writes it.** `ZodTypeDef` and `RefinementCtx` are what an application
    // imports; 54 of zod's 80 findings were interface names.
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
  });

  it('treats every symbol in an anonymously-tested file as collected', () => {
    const helper = makeNode({
      name: 'checkErrors',
      file: 'src/__tests__/nullable.test.ts',
      language: 'typescript',
    });
    const report = computeReachability(
      makeGraph([helper], [{ from: helper.id, to: helper.id, type: 'CALLS' }]),
    );
    // **Jasmine collects a callback, not a name.** There is no symbol to root, so the file is the test.
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
    expect(report.roots.map((root) => root.kind)).toEqual(['test']);
  });

  it('keeps a helper in a Python test file answerable', () => {
    const test = makeNode({ name: 'test_create', file: 'tests/test_app.py' });
    const helper = makeNode({ name: 'build_client', file: 'tests/test_app.py' });
    const report = computeReachability(
      makeGraph(
        [test, helper],
        [
          { from: test.id, to: helper.id, type: 'ACCESSES' },
          { from: helper.id, to: helper.id, type: 'CALLS' },
        ],
      ),
    );
    // **`pytest` collects `test_create` and not `build_client`**: rooting the test keeps the helper alive through the
    // mention edge, and dropping the mention makes the helper a finding again. Which is the point — a mention is what
    // keeps the helper out of the report, not the directory it sits in.
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
    const orphans = makeGraph([test, helper], [{ from: test.id, to: test.id, type: 'CALLS' }]);
    expect(computeReachability(orphans).dead.map((symbol) => symbol.name)).toEqual([
      'build_client',
    ]);
  });

  it('treats a benchmark script as a program', () => {
    const script = makeNode({
      name: 'num',
      file: 'src/benchmarks/realworld.ts',
      language: 'typescript',
    });
    const report = computeReachability(
      makeGraph([script], [{ from: script.id, to: script.id, type: 'CALLS' }]),
    );
    expect(report.dead.map((symbol) => symbol.name)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The edges of the input space, not of the graph
// ---------------------------------------------------------------------------
//
// A graph the pipeline builds never has a node without a file, a class named by two files at once, or an `EXTENDS` edge
// between classes that are already connected. **A pass that only works on the graphs one producer emits is a pass with
// an unstated precondition**, and these cases state it: each is a shape a caller — a test, another project's graph, a
// future provider — can hand it.
//
// The assertions name the symbol under test rather than the whole list, because a fixture's classes are findings in
// their own right and saying so on every line would bury the one sentence each case exists to state.

describe('input shapes the pipeline does not produce but a caller can', () => {
  const names = (report: ReturnType<typeof computeReachability>): string[] =>
    report.dead.map((symbol) => symbol.name);

  it('ignores a node that belongs to no file', () => {
    const anchored = makeNode({ name: 'run', file: 'src/pkg/app.py' });
    const floating = { ...makeNode({ name: 'detached', file: 'src/pkg/app.py' }), filePath: null };
    // **A class with no path is in no package**, so the rule that publishes a class's public members has to refuse it
    // rather than coerce its path to a string.
    const homelessClass = {
      ...makeNode({ name: 'Orphan', file: 'src/pkg/app.py', label: 'Class', exported: true }),
      filePath: null,
    };
    const report = computeReachability(
      makeGraph(
        [anchored, floating, homelessClass],
        [{ from: anchored.id, to: anchored.id, type: 'CALLS' }],
      ),
    );
    // A node with no path cannot be published, cannot be a member and cannot be sorted into a finding a reader can open.
    expect(report.considered).toBe(1);
    expect(names(report)).toEqual(['run']);
  });

  it('does not crash on an entry file at the root of the filesystem', () => {
    const entry = makeNode({
      name: 'z',
      file: '/index.ts',
      language: 'typescript',
      exported: true,
    });
    const other = makeNode({ name: 'used', file: 'src/pkg/app.py' });
    const report = computeReachability(
      makeGraph([entry, other], [{ from: other.id, to: other.id, type: 'CALLS' }]),
    );
    // `segments('/index.ts')` is one part, so popping it leaves nothing to name a package: no published surface, and
    // nothing crashes on the way to saying so.
    expect(report.published).toEqual([]);
    expect(names(report)).toEqual(['z', 'used']);
  });

  it('leaves a member alone when the class it names is not in the graph', () => {
    const member = makeNode({ name: 'helper', file: 'src/pkg/app.py', enclosingClass: 'Missing' });
    const caller = makeNode({ name: 'main', file: 'src/pkg/app.py', line: 90 });
    const report = computeReachability(
      makeGraph([member, caller], [{ from: caller.id, to: caller.id, type: 'CALLS' }]),
    );
    expect(names(report)).toEqual(['helper']);
  });

  it('files a member under the class beside it when two files declare the same name', () => {
    const door = makeFile('src/pkg/__init__.py');
    const here = makeNode({
      name: 'Builder',
      file: 'src/pkg/builder.py',
      label: 'Class',
      exported: true,
    });
    const there = makeNode({ name: 'Builder', file: 'examples/plugin/builder.py', label: 'Class' });
    const member = makeNode({
      name: 'build',
      file: 'src/pkg/builder.py',
      enclosingClass: 'Builder',
    });
    const report = computeReachability(
      makeGraph([door, here, there, member], [{ from: here.id, to: here.id, type: 'CALLS' }]),
    );
    // The class in the member's **own file** answers, so publishing it publishes the member. The other `Builder` is a
    // different class — in a directory the repository does not publish — and its silence says nothing about this one.
    expect(report.published.map((symbol) => symbol.name).sort()).toEqual(['Builder', 'build']);
  });

  it('refuses to file a member when the only class of that name is in another file and there are two', () => {
    const door = makeFile('src/pkg/__init__.py');
    const first = makeNode({
      name: 'Builder',
      file: 'src/pkg/builder.py',
      label: 'Class',
      exported: true,
    });
    const second = makeNode({
      name: 'Builder',
      file: 'examples/plugin/builder.py',
      label: 'Class',
    });
    const member = makeNode({
      name: 'build',
      file: 'examples/plugin/other.py',
      enclosingClass: 'Builder',
    });
    const report = computeReachability(
      makeGraph([door, first, second, member], [{ from: first.id, to: first.id, type: 'CALLS' }]),
    );
    // Two candidates and no import to break the tie: the member belongs to no class in this graph, so it is not
    // published by either — guessing would publish it on a coin toss.
    expect(report.published.map((symbol) => symbol.name)).toEqual(['Builder']);
    expect(names(report)).toContain('build');
  });

  it('takes containment from HAS_METHOD only when the source is a class and the member is unclaimed', () => {
    const owner = makeNode({
      name: 'Cluster',
      file: 'lib/index.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const member = makeNode({
      name: 'quit',
      file: 'lib/cluster.ts',
      label: 'Method',
      language: 'typescript',
    });
    const notAClass = makeNode({
      name: 'bundle',
      file: 'lib/cluster.ts',
      label: 'Module',
      language: 'typescript',
    });
    const report = computeReachability(
      makeGraph(
        [owner, member, notAClass],
        [
          // **A `Module --HAS_METHOD--> quit` edge comes first and is refused.** Reading it as containment would file
          // the member under whatever the graph happened to link it to.
          { from: notAClass.id, to: member.id, type: 'HAS_METHOD' },
          { from: owner.id, to: member.id, type: 'HAS_METHOD' },
          // A second claim on the same member is ignored rather than re-filing it.
          { from: owner.id, to: member.id, type: 'HAS_METHOD' },
          { from: owner.id, to: owner.id, type: 'CALLS' },
        ],
      ),
    );
    expect(report.published.map((symbol) => symbol.name).sort()).toEqual(['Cluster', 'quit']);
  });

  it('joins a hierarchy that is already connected without looping', () => {
    const a = makeNode({ name: 'A', file: 'src/pkg/a.py', label: 'Class' });
    const b = makeNode({ name: 'B', file: 'src/pkg/b.py', label: 'Class' });
    const c = makeNode({ name: 'C', file: 'src/pkg/c.py', label: 'Class' });
    const inA = makeNode({ name: 'run', file: 'src/pkg/a.py', enclosingClass: 'A' });
    const inC = makeNode({ name: 'run', file: 'src/pkg/c.py', enclosingClass: 'C' });
    const caller = makeNode({ name: 'main', file: 'src/pkg/a.py', line: 90 });
    const report = computeReachability(
      makeGraph(
        [a, b, c, inA, inC, caller],
        [
          { from: a.id, to: b.id, type: 'EXTENDS' },
          { from: c.id, to: b.id, type: 'EXTENDS' },
          // **A cycle through the base**: the third union finds the two sides already joined, and the slot must still
          // be one slot rather than a loop.
          { from: c.id, to: a.id, type: 'IMPLEMENTS' },
          { from: caller.id, to: inA.id, type: 'CALLS' },
        ],
      ),
    );
    expect(names(report)).not.toContain('run');
  });

  it('follows METHOD_OVERRIDES in both directions and ignores a type that carries no use', () => {
    const base = makeNode({ name: 'Base', file: 'src/pkg/a.py', label: 'Class' });
    const child = makeNode({ name: 'Child', file: 'src/pkg/b.py', label: 'Class' });
    const declared = makeNode({ name: 'handle', file: 'src/pkg/a.py', enclosingClass: 'Base' });
    const override = makeNode({ name: 'handle', file: 'src/pkg/b.py', enclosingClass: 'Child' });
    const caller = makeNode({ name: 'main', file: 'src/pkg/a.py', line: 90 });
    const unrelated = makeNode({ name: 'spec', file: 'tests/test_a.py', label: 'Test' });
    const report = computeReachability(
      makeGraph(
        [base, child, declared, override, caller, unrelated],
        [
          { from: override.id, to: declared.id, type: 'METHOD_OVERRIDES' },
          { from: caller.id, to: declared.id, type: 'CALLS' },
          // A `TESTS` edge is not a use edge: a test keeps a symbol alive by being collected, which the root rules say,
          // not by naming it in the graph.
          { from: unrelated.id, to: declared.id, type: 'TESTS' },
        ],
      ),
    );
    // The call reaches the base, and the override is reachable **backwards** along `METHOD_OVERRIDES`. Neither `handle`
    // is a finding, and the test file is not what keeps either alive.
    expect(names(report)).not.toContain('handle');
    expect(names(report)).toEqual(expect.arrayContaining(['Base', 'Child']));
    // **A `Test` node is not one of the symbols the question is asked about** — the report is about code, and a fact
    // about the runner belongs in a different dataset. So the `TESTS` edge is not a use edge and `spec` is not a
    // survivor of anything: five symbols were considered and `spec` is not one of them.
    expect(report.considered).toBe(5);
    expect(report.roots.map((root) => root.kind)).toEqual(['entry']);
  });

  it('drops the tests, and what only the tests reach, when the caller says so', () => {
    const test = makeNode({ name: 'test_create', file: 'tests/test_app.py', line: 4 });
    const helper = makeNode({ name: 'build_client', file: 'tests/test_app.py', line: 12 });
    const code = makeNode({ name: 'main', file: 'src/pkg/app.py' });
    const graph = makeGraph(
      [test, helper, code],
      [
        { from: test.id, to: helper.id, type: 'CALLS' },
        { from: code.id, to: code.id, type: 'CALLS' },
      ],
    );
    expect(names(computeReachability(graph))).toEqual([]);
    // **`includeTests: false`** is the switch a caller uses to ask what is dead *outside* the suite, and it has to take
    // the helper the suite reaches with it — otherwise it answers a question about a program nobody runs.
    // **A finding is ordered by where a reader would open the file**, not by name: the two symbols are in one file, so
    // the line decides, and `test_create` is above the helper it was written next to.
    expect(names(computeReachability(graph, { includeTests: false }))).toEqual([
      'test_create',
      'build_client',
    ]);
  });

  it('skips a file whose extension is not code', () => {
    const doc = makeNode({ name: 'diagram', file: 'docs/notes.txt' });
    const code = makeNode({ name: 'main', file: 'src/pkg/app.py' });
    const report = computeReachability(
      makeGraph([doc, code], [{ from: code.id, to: code.id, type: 'CALLS' }]),
    );
    expect(report.considered).toBe(1);
    expect(names(report)).toEqual([]);
  });

  it('files a member under the one class of that name when there is only one', () => {
    const door = makeFile('src/pkg/__init__.py');
    const owner = makeNode({
      name: 'Builder',
      file: 'src/pkg/builder.py',
      label: 'Class',
      exported: true,
    });
    const member = makeNode({ name: 'build', file: 'src/pkg/other.py', enclosingClass: 'Builder' });
    const report = computeReachability(
      makeGraph([door, owner, member], [{ from: owner.id, to: owner.id, type: 'CALLS' }]),
    );
    // One candidate and nothing to argue with: the class answers for a member declared in another file, which is how a
    // mixin that names the class it is mixed into reads.
    expect(report.published.map((symbol) => symbol.name).sort()).toEqual(['Builder', 'build']);
  });

  it('names reachability rather than publication when the two disagree', () => {
    const api = makeNode({
      name: 'Api',
      file: 'lib/index.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const impl = makeNode({ name: 'encode', file: 'src/impl.ts', language: 'typescript' });
    const report = computeReachability(
      makeGraph([api, impl], [{ from: api.id, to: impl.id, type: 'CALLS' }]),
    );
    // `lib` is the published directory and `src/impl.ts` is outside it, so `encode` is not a finding — but the evidence
    // is that a published name reaches it, not that it is published, and the two sentences are kept apart.
    expect(report.dead).toEqual([]);
    const encode = report.published.find((symbol) => symbol.name === 'encode');
    expect(encode?.because).toBe('reachable from a published name');
  });

  it('orders a finding whose position is unknown by its file, not by the absence', () => {
    const alpha = makeNode({ name: 'alpha', file: 'src/pkg/a.py', line: 10 });
    const unplaced = makeNode({ name: 'unplaced', file: 'src/pkg/a.py', line: null });
    const omega = makeNode({ name: 'omega', file: 'src/pkg/a.py', line: 30 });
    const report = computeReachability(
      makeGraph(
        [alpha, unplaced, omega],
        [
          { from: alpha.id, to: unplaced.id, type: 'CALLS' },
          { from: unplaced.id, to: omega.id, type: 'CALLS' },
        ],
      ),
    );
    // **A finding with no recorded position sorts as line zero, inside its own file**: there is no line to compare, and
    // reading the absence that way is the only reading that keeps one file's findings together on the page a reader
    // scrolls — rather than dropping the unknowns at the end of the report, away from the code they belong to.
    expect(names(report)).toEqual(['unplaced', 'alpha', 'omega']);
  });

  it('reads a layout rule in the repository coordinates, not the machine ones', () => {
    // **The bug this case exists for, measured on a CI runner.** The checkout was unpacked under
    // `.../benchmarks/corpora/zod-3.23.8/`, so every path had `benchmarks` as an ancestor — a directory the published
    // rule refuses — and the library's whole public API came back as dead code: 164 findings where the local run had 0.
    const checkout = '/home/runner/work/benchmarks/corpora/zod-3.23.8';
    const door = makeNode({
      name: 'index.ts',
      file: `${checkout}/src/index.ts`,
      label: 'File',
      language: 'typescript',
    });
    const api = makeNode({
      name: 'ZodType',
      file: `${checkout}/src/index.ts`,
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const graph = makeGraph([door, api], [{ from: api.id, to: api.id, type: 'CALLS' }]);
    // Without a root the machine decides, and the answer is the wrong one.
    expect(names(computeReachability(graph))).toEqual(['ZodType']);
    // **With the root the rule reads `src/index.ts`**, which is the repository's own path, and the name is published.
    const rooted = { ...graph, rootPath: checkout };
    expect(names(computeReachability(rooted))).toEqual([]);
    expect(computeReachability(rooted).published.map((symbol) => symbol.name)).toEqual(['ZodType']);
    // A caller may say it instead of the graph, which is what a harness holding an absolute checkout does — with or
    // without the trailing separator every build tool writes.
    expect(names(computeReachability(graph, { rootPath: checkout }))).toEqual([]);
    expect(names(computeReachability(graph, { rootPath: `${checkout}/` }))).toEqual([]);
  });

  it('strips a root whose separator the paths do not share', () => {
    // **A normalised root and paths the shell spelled with backslashes** — the same checkout on the same machine, and a
    // rule that only tried one separator would read the machine's directories as ancestors of every file.
    const door = makeNode({
      name: 'index.ts',
      file: 'C:\\repo\\src\\index.ts',
      label: 'File',
      language: 'typescript',
    });
    const api = makeNode({
      name: 'ZodType',
      file: 'C:\\repo\\src\\index.ts',
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const report = computeReachability(
      makeGraph([door, api], [{ from: api.id, to: api.id, type: 'CALLS' }]),
      { rootPath: 'C:/repo' },
    );
    expect(report.published.map((symbol) => symbol.name)).toEqual(['ZodType']);
    expect(report.dead).toEqual([]);
  });

  it('refuses a benchmarks directory the repository keeps for itself, with the root known', () => {
    const checkout = '/srv/build/zod';
    const door = makeNode({
      name: 'index.ts',
      file: `${checkout}/src/index.ts`,
      label: 'File',
      language: 'typescript',
    });
    const api = makeNode({
      name: 'ZodType',
      file: `${checkout}/src/index.ts`,
      label: 'Class',
      language: 'typescript',
      exported: true,
    });
    const script = makeNode({
      name: 'timing',
      file: `${checkout}/benchmarks/timing.ts`,
      language: 'typescript',
      exported: true,
    });
    const report = computeReachability({
      ...makeGraph([door, api, script], [{ from: api.id, to: api.id, type: 'CALLS' }]),
      rootPath: checkout,
    });
    // **`benchmarks/` is still not a package** — removing the machine's directories does not remove the repository's,
    // and the difference is exactly which side of the root the directory sits on. `timing.ts` is a program rather than a
    // library, so it is an entry point and not a finding; it is simply not published.
    expect(report.published.map((symbol) => symbol.name)).toEqual(['ZodType']);
    expect(report.dead).toEqual([]);
  });

  it('keeps the first reason a symbol is a root', () => {
    const door = makeFile('src/pkg/__init__.py');
    const owner = makeNode({
      name: 'Server',
      file: 'src/pkg/server.py',
      label: 'Class',
      exported: true,
    });
    const method = makeNode({
      name: 'run',
      file: 'src/pkg/server.py',
      label: 'Method',
      enclosingClass: 'Server',
    });
    const report = computeReachability(
      makeGraph([door, owner, method], [{ from: owner.id, to: owner.id, type: 'CALLS' }]),
      { entryPoints: ['run'] },
    );
    // **Two rules name one symbol and the report prints one sentence.** The caller's declaration is first, so the
    // reason shown is the one a reader can act on rather than the one the graph happened to generate.
    const kinds = report.roots.filter((root) => root.nodeId === method.id).map((root) => root.kind);
    expect(kinds).toEqual(['declared', 'published']);
  });
});
