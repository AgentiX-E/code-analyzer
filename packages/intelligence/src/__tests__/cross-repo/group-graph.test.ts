// The conversion that stands between a pipeline graph and a workspace, tested on shapes the pipeline produces.
//
// **Every case here names a consequence rather than a field.** A test that asserts `filePath` no longer starts with
// `/` would pass for a conversion that produced the wrong relative path; these assert what the graph then *is* — the
// path a citation prints, the identity `getRepoNodes` needs, the edge endpoints that survive.

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergePipelineGraph, toRepoPath } from '../../cross-repo/group-graph.js';

import type { GraphEdge, GraphNode, KnowledgeGraph } from '@code-analyzer/shared';

const ROOT = resolve('/corpora/flask-3.0.3');
const PID = 'pallets/flask';

/** A pipeline node, in the shape the pipeline writes it: absolute path, empty `projectId` on files. */
function node(overrides: Partial<GraphNode> & { id: number }): GraphNode {
  const filePath = overrides.filePath === undefined ? `${ROOT}/src/flask/app.py` : overrides.filePath;
  return {
    projectId: '',
    label: 'File',
    name: 'app.py',
    qualifiedName: `file:${filePath ?? ''}`,
    filePath,
    startLine: 1,
    endLine: 1,
    language: 'python',
    properties: { name: 'app.py', filePath: filePath ?? undefined, language: 'python' },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    ...overrides,
  };
}

function edge(id: number, sourceId: number, targetId: number, type: string): GraphEdge {
  return {
    id,
    projectId: PID,
    sourceId,
    targetId,
    type: type as GraphEdge['type'],
    properties: {},
    weight: 1,
    createdAt: '2026-10-30T00:00:00.000Z',
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph {
  return {
    projectId: PID,
    nodes: new Map(nodes.map((entry) => [entry.id, entry])),
    edges: new Map(edges.map((entry) => [entry.id, entry])),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

const scope = { rootPath: ROOT, projectId: PID };

describe('toRepoPath', () => {
  it('makes an absolute path inside the checkout repository-relative', () => {
    expect(toRepoPath(ROOT, `${ROOT}/src/flask/app.py`)).toBe('src/flask/app.py');
  });

  it('accepts a root that carries a trailing separator', () => {
    expect(toRepoPath(`${ROOT}/`, `${ROOT}/src/flask/app.py`)).toBe('src/flask/app.py');
  });

  it('answers null for a file outside the checkout, rather than a path that walks out', () => {
    // **`../dep/util.py` is what `relative()` says, and it is not a path any checkout contains.** A citation would
    // print it and a resolver would join it; the conversion refuses instead.
    expect(toRepoPath(ROOT, '/corpora/dep-1.0/util.py')).toBeNull();
  });

  it('answers null for the root itself, which is a directory and not a file', () => {
    expect(toRepoPath(ROOT, ROOT)).toBeNull();
  });

  it('resolves a `..` segment before deciding, because a textual prefix test would admit it', () => {
    expect(toRepoPath(ROOT, `${ROOT}/src/flask/../../../dep/util.py`)).toBeNull();
    expect(toRepoPath(ROOT, `${ROOT}/src/../lib/x.py`)).toBe('lib/x.py');
  });

  it('answers in POSIX separators, the form a corpus and a citation both use', () => {
    expect(toRepoPath(ROOT, `${ROOT}/src/flask/app.py`)).not.toContain('\\');
  });
});

describe('mergePipelineGraph — the identity a workspace needs', () => {
  it('files every node under the project, including the files the pipeline leaves empty', () => {
    // **This is the defect that made a workspace hold 127 files and see none of them.** `getRepoNodes(projectId)`
    // is the first line of every walk in this subsystem.
    const merged = mergePipelineGraph(
      graph([
        node({ id: 2 }),
        node({ id: 3, label: 'Function', name: 'dispatch', projectId: PID }),
      ]),
      scope,
    );
    expect(merged.nodes.map((entry) => entry.projectId)).toEqual([PID, PID]);
  });

  it('gives a file the workspace name `ensureFileNode` writes, so one file is one node', () => {
    const merged = mergePipelineGraph(graph([node({ id: 2 })]), scope);
    expect(merged.nodes[0]!.qualifiedName).toBe(`file:${PID}:src/flask/app.py`);
  });

  it('strips the checkout out of a symbol qualified name and keeps the provider shape', () => {
    const merged = mergePipelineGraph(
      graph([
        node({
          id: 3,
          label: 'Function',
          name: 'dispatch',
          projectId: PID,
          qualifiedName: `project:${PID}:file:${ROOT}/src/flask/app.py:dispatch`,
        }),
      ]),
      scope,
    );
    expect(merged.nodes[0]!.qualifiedName).toBe(`project:${PID}:file:src/flask/app.py:dispatch`);
  });

  it('leaves a qualified name that carries no path exactly as it was', () => {
    const merged = mergePipelineGraph(
      graph([
        node({
          id: 4,
          label: 'Community',
          name: 'community-7',
          filePath: null,
          qualifiedName: 'community:7',
        }),
      ]),
      scope,
    );
    expect(merged.nodes[0]!.qualifiedName).toBe(`project:${PID}:community:7`);
    expect(merged.nodes[0]!.filePath).toBeNull();
  });

  it('files a name the pipeline already scoped under nothing else', () => {
    const merged = mergePipelineGraph(
      graph([
        node({
          id: 5,
          label: 'Class',
          name: 'OwnerController',
          projectId: PID,
          qualifiedName: `project:${PID}:file:src/main/java/OwnerController.java:OwnerController`,
        }),
      ]),
      scope,
    );
    expect(merged.nodes[0]!.qualifiedName).toBe(
      `project:${PID}:file:src/main/java/OwnerController.java:OwnerController`,
    );
  });

  it('leaves the project node’s own name alone, which is the one name with no suffix', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 1, label: 'Project', name: 'flask', filePath: null, qualifiedName: `project:${PID}` })]),
      scope,
    );
    expect(merged.nodes[0]!.qualifiedName).toBe(`project:${PID}`);
  });

  it('rewrites the path inside `properties` as well, which is the copy a consumer reads', () => {
    const merged = mergePipelineGraph(graph([node({ id: 2 })]), scope);
    expect(merged.nodes[0]!.properties['filePath']).toBe('src/flask/app.py');
  });

  it('keeps a node with no file at all, because a community is a node of the graph', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 5, label: 'Community', filePath: null, name: 'c1' })]),
      scope,
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.drops.outsideCheckout).toBe(0);
  });

  it('drops a node outside the checkout and counts it', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 2 }), node({ id: 6, filePath: '/elsewhere/other.py' })]),
      scope,
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.drops.outsideCheckout).toBe(1);
  });

  it('carries the node order the graph had, so two runs produce the same store', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 9 }), node({ id: 3 }), node({ id: 7 })]),
      scope,
    );
    expect(merged.nodes.map((entry) => entry.filePath)).toEqual([
      'src/flask/app.py',
      'src/flask/app.py',
      'src/flask/app.py',
    ]);
  });

  it('does not carry the pipeline’s id or timestamps into the store, which owns both', () => {
    const merged = mergePipelineGraph(graph([node({ id: 42 })]), scope);
    expect(merged.nodes[0]).not.toHaveProperty('id');
    expect(merged.nodes[0]).not.toHaveProperty('createdAt');
    expect(merged.nodes[0]).not.toHaveProperty('updatedAt');
  });
});

describe('mergePipelineGraph — the edges, as index pairs', () => {
  it('re-expresses every edge as two indices into the node list', () => {
    // **The caller cannot know the store's ids in advance**, so an edge that named a pipeline id would be a
    // dangling reference the store rejects - `insertEdge` throws for an unknown endpoint.
    const merged = mergePipelineGraph(
      graph(
        [node({ id: 2 }), node({ id: 3, label: 'Function', name: 'dispatch' })],
        [edge(1, 3, 2, 'DEFINES')],
      ),
      scope,
    );
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]!.source).toBe(1);
    expect(merged.edges[0]!.target).toBe(0);
    expect(merged.edges[0]!.type).toBe('DEFINES');
  });

  it('keeps `CALLS`, which is the relation the workspace has never had', () => {
    const merged = mergePipelineGraph(
      graph(
        [node({ id: 3 }), node({ id: 4 })],
        [edge(1, 3, 4, 'CALLS'), edge(2, 4, 3, 'TESTS')],
      ),
      scope,
    );
    expect(merged.edges.map((entry) => entry.type)).toEqual(['CALLS', 'TESTS']);
  });

  it('drops an edge whose endpoint was dropped, and counts it', () => {
    const merged = mergePipelineGraph(
      graph(
        [node({ id: 2 }), node({ id: 6, filePath: '/elsewhere/other.py' })],
        [edge(1, 2, 6, 'CALLS')],
      ),
      scope,
    );
    expect(merged.edges).toHaveLength(0);
    expect(merged.drops.unmapped).toBe(1);
  });

  it('holds the pipeline’s `IMPORTS` edges back, because they carry no names', () => {
    // **Every consumer of a workspace import reads `importedSymbols`.** `filesExposing` follows re-exports by name,
    // `traceSymbolDependencies` asks whether the importer named the symbol, and a symbol-filtered impact answer
    // matches names. An `IMPORTS` edge without them is evidence that an import exists and nothing else, so it is
    // reported as a deferred pair rather than merged as an edge.
    const merged = mergePipelineGraph(
      graph(
        [node({ id: 2 }), node({ id: 3 })],
        [edge(1, 2, 3, 'IMPORTS'), edge(2, 3, 2, 'CALLS')],
      ),
      scope,
    );
    expect(merged.edges.map((entry) => entry.type)).toEqual(['CALLS']);
    expect(merged.deferredImports).toEqual([{ source: 0, target: 1 }]);
    expect(merged.drops.deferredImports).toBe(1);
  });

  it('holds back a self-import too, and counts it rather than deferring it', () => {
    // **The pipeline emits `IMPORTS` from a file to itself** for `from . import x` - measured on flask, where it is
    // how `flask/__init__.py` re-exports. Deferring it would put an edge in the workspace whose only possible
    // traversal answer is "the file depends on itself", so the count is reported and the pair is not.
    const merged = mergePipelineGraph(
      graph([node({ id: 2 })], [edge(1, 2, 2, 'IMPORTS')]),
      scope,
    );
    expect(merged.deferredImports).toEqual([]);
    expect(merged.drops.selfImports).toBe(1);
    expect(merged.edges).toHaveLength(0);
  });

  it('copies edge properties rather than sharing them with the pipeline’s graph', () => {
    const original = edge(1, 2, 3, 'CALLS');
    original.properties = { confidence: 1 };
    const merged = mergePipelineGraph(
      graph([node({ id: 2 }), node({ id: 3 })], [original]),
      scope,
    );
    expect(merged.edges[0]!.properties).toEqual({ confidence: 1 });
    expect(merged.edges[0]!.properties).not.toBe(original.properties);
  });
});

describe('mergePipelineGraph — one namespace, four repositories', () => {
  /** Two repositories, each with a `.github` folder and community number one. */
  function twoRepos(): string[] {
    const names: string[] = [];
    for (const [root, projectId] of [
      [resolve('/corpora/flask-3.0.3'), 'pallets/flask'],
      [resolve('/corpora/werkzeug-3.0.3'), 'pallets/werkzeug'],
    ] as const) {
      const merged = mergePipelineGraph(
        graph([
          node({
            id: 1,
            label: 'Folder',
            name: '.github',
            filePath: `${root}/.github`,
            qualifiedName: `folder:${root}/.github`,
          }),
          node({ id: 2, label: 'Community', name: 'c1', filePath: null, qualifiedName: 'community:1' }),
        ]),
        { rootPath: root, projectId },
      );
      for (const entry of merged.nodes) names.push(entry.qualifiedName);
    }
    return names;
  }

  it('gives two repositories’ equal paths different names', () => {
    // **Measured on four released checkouts: every one of them has `.github` and `.devcontainer`.** Without a project
    // in the name, the store holds one folder and both repositories' edges point at it - and the upgrade pass reads
    // "an edge whose target is in another project" as a **cross-repository dependency**. It reported 375 of them,
    // none of which any import, call or contract supports.
    const names = twoRepos();
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives two repositories’ community number one different names, which is the same collision', () => {
    // **The community detector numbers from one in every graph**, so `community:1` exists in all four checkouts.
    const names = twoRepos();
    expect(names).toContain('project:pallets/flask:community:1');
    expect(names).toContain('project:pallets/werkzeug:community:1');
  });
});

describe('mergePipelineGraph — the languages a workspace holds', () => {
  const code = new Set(['python', 'javascript']);

  it('drops a node in a language the workspace does not index, and counts it', () => {
    // **Measured, not assumed.** With documentation merged in, the workspace answered "where does express mount
    // middleware" with `Charter.md:22` and `History.md:1502`, and the file the question is about fell out of the nine
    // slots the context has. A workspace indexes the languages its own discovery reads.
    const merged = mergePipelineGraph(
      graph([
        node({ id: 2, language: 'markdown', filePath: `${ROOT}/README.md` }),
        node({ id: 3, language: 'python' }),
      ]),
      { ...scope, languages: code },
    );
    expect(merged.nodes.map((entry) => entry.language)).toEqual(['python']);
    expect(merged.drops.outsideLanguages).toBe(1);
  });

  it('keeps a node with no language, which is the shape a community has', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 4, label: 'Community', language: null, filePath: null, name: 'c1' })]),
      { ...scope, languages: code },
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.drops.outsideLanguages).toBe(0);
  });

  it('keeps everything when no set is given, which is what a single-repository merge wants', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 2, language: 'markdown', filePath: `${ROOT}/README.md` })]),
      scope,
    );
    expect(merged.nodes).toHaveLength(1);
    expect(merged.drops.outsideLanguages).toBe(0);
  });
});

describe('mergePipelineGraph — a relative checkout, which is the shape that produced a zero', () => {
  const relativeRoot = 'benchmarks/corpora/qa/flask-3.0.3';

  it('converts a path the pipeline wrote by joining the relative root', () => {
    const merged = mergePipelineGraph(
      graph([node({ id: 2, filePath: `${relativeRoot}/src/flask/app.py` })]),
      { rootPath: relativeRoot, projectId: PID },
    );
    expect(merged.nodes[0]!.filePath).toBe('src/flask/app.py');
  });

  it('strips a relative root that the absolute form also contains, without leaving a prefix behind', () => {
    // **The absolute form ends with the relative one.** Stripping the shorter first leaves `/workspace/repos/.../`
    // glued to the front of the qualified name - the defect, one layer down.
    const absolute = resolve(relativeRoot);
    const merged = mergePipelineGraph(
      graph([
        node({
          id: 3,
          label: 'Function',
          projectId: PID,
          filePath: `${absolute}/src/flask/app.py`,
          qualifiedName: `project:${PID}:file:${absolute}/src/flask/app.py:dispatch`,
        }),
      ]),
      { rootPath: relativeRoot, projectId: PID },
    );
    expect(merged.nodes[0]!.qualifiedName).toBe(`project:${PID}:file:src/flask/app.py:dispatch`);
  });
});
