// One name, one binding — the join that a per-declaration graph made necessary.
//
// **Giving every declaration a node created a new way to report a live symbol as dead.** `Response.status` is a getter
// and a setter, and once each has its own node the setter has no caller of its own: Python syntax never names it.
// `_dt_as_utc` in `werkzeug/_internal.py` is three declarations — two `@t.overload` stubs and the implementation — and
// only the implementation is ever called. So the reachability pass joins declarations that share a name *before* the
// graph made them unique, and liveness crosses the join in both directions.
//
// The three cases below are the ones the rule has to separate:
//
//   1. **A getter and its setter are one binding**, so calling one keeps the other.
//   2. **An overload set is one binding**, so calling the implementation keeps the stubs.
//   3. **Two classes that declare the same name are not one binding**, so a call to `A.get` does not keep `B.get`.

import { describe, expect, it } from 'vitest';

import { computeReachability } from '../impact/reachability.js';

import type { GraphEdge, GraphNode, KnowledgeGraph, NodeLabel } from '@code-analyzer/shared';

const PROJECT = 'p1';
const FILE = 'app.py';

let nextId = 1;

interface NodeSpec {
  qualifiedName: string;
  label?: NodeLabel;
  line?: number;
  enclosingClass?: string;
  exported?: boolean;
}

function node(spec: NodeSpec): GraphNode {
  const id = nextId++;
  const startLine = spec.line ?? id;
  const name = spec.qualifiedName.split(/[.:]/).pop() ?? spec.qualifiedName;
  return {
    id,
    projectId: PROJECT,
    label: spec.label ?? 'Method',
    name,
    qualifiedName: spec.qualifiedName,
    filePath: FILE,
    startLine,
    endLine: startLine + 1,
    language: 'python',
    properties: {
      filePath: FILE,
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

function fileNode(): GraphNode {
  const id = nextId++;
  return {
    ...node({ qualifiedName: `file:${FILE}`, label: 'File', line: 1 }),
    id,
    name: 'app.py',
    startLine: 1,
    endLine: 400,
  };
}

function graph(nodes: GraphNode[], calls: Array<[number, number]>): KnowledgeGraph {
  const edges = new Map<number, GraphEdge>();
  let edgeId = 1;
  for (const [from, to] of calls) {
    edges.set(edgeId, {
      id: edgeId++,
      projectId: PROJECT,
      sourceId: from,
      targetId: to,
      type: 'CALLS',
      properties: {},
    });
  }
  return {
    projectId: PROJECT,
    nodes: new Map(nodes.map((entry) => [entry.id, entry])),
    edges,
    qnameIndex: new Map(nodes.map((entry) => [entry.qualifiedName, entry.id])),
    fileIndex: new Map([[FILE, nodes[0]?.id ?? 0]]),
  };
}

function deadNames(report: { dead: ReadonlyArray<{ qualifiedName: string }> }): string[] {
  return report.dead.map((entry) => entry.qualifiedName).sort();
}

describe('declarations that mean one callable are one binding', () => {
  it('keeps a property setter alive when nothing calls it, because its getter is called', () => {
    const response = node({ qualifiedName: 'file:app.py:Response', label: 'Class', line: 1 });
    const getter = node({
      qualifiedName: 'file:app.py:Response.status',
      line: 2,
      enclosingClass: 'Response',
    });
    const setter = node({
      qualifiedName: 'file:app.py:Response.status@6',
      line: 6,
      enclosingClass: 'Response',
    });
    const caller = node({ qualifiedName: 'file:app.py:render', label: 'Function', line: 10 });

    const report = computeReachability(
      graph([fileNode(), response, getter, setter, caller], [[caller.id, getter.id]]),
      {
        entryPoints: ['file:app.py:render'],
      },
    );

    // The setter has no incoming edge at all — Python spells assignment, not a call — so a per-node rule reports it.
    // The class is a finding of its own here (nothing instantiates it in this graph), which is why the assertion is
    // about the property rather than about the whole list.
    expect(deadNames(report)).not.toContain('file:app.py:Response.status');
    expect(deadNames(report)).not.toContain('file:app.py:Response.status@6');
  });

  it('keeps an overload stub alive when the implementation is called', () => {
    const stub = node({ qualifiedName: 'file:app.py:_dt_as_utc', label: 'Function', line: 2 });
    const stub2 = node({ qualifiedName: 'file:app.py:_dt_as_utc@6', label: 'Function', line: 6 });
    const implementation = node({
      qualifiedName: 'file:app.py:_dt_as_utc@10',
      label: 'Function',
      line: 10,
    });
    const caller = node({ qualifiedName: 'file:app.py:to_header', label: 'Function', line: 20 });

    const report = computeReachability(
      graph([fileNode(), stub, stub2, implementation, caller], [[caller.id, implementation.id]]),
      { entryPoints: ['file:app.py:to_header'] },
    );

    expect(deadNames(report)).not.toContain('file:app.py:_dt_as_utc');
    expect(deadNames(report)).not.toContain('file:app.py:_dt_as_utc@6');
  });
});

describe('declarations in different containers are different bindings', () => {
  it('does not keep a same-named method of another class alive', () => {
    const first = node({ qualifiedName: 'file:app.py:Alpha', label: 'Class', line: 1 });
    const called = node({
      qualifiedName: 'file:app.py:Alpha.get',
      line: 2,
      enclosingClass: 'Alpha',
    });
    const second = node({ qualifiedName: 'file:app.py:Beta', label: 'Class', line: 10 });
    const neverCalled = node({
      qualifiedName: 'file:app.py:Beta.get',
      line: 11,
      enclosingClass: 'Beta',
    });
    const caller = node({ qualifiedName: 'file:app.py:main_entry', label: 'Function', line: 20 });

    const report = computeReachability(
      graph([fileNode(), first, called, second, neverCalled, caller], [[caller.id, called.id]]),
      { entryPoints: ['file:app.py:main_entry'] },
    );

    // **The control, and the reason this test is worth writing.** The join must not degrade into "everything with this
    // name is alive", which is the rule that destroys recall: `Beta.get` is a different method of a different class.
    expect(deadNames(report)).toContain('file:app.py:Beta.get');
    expect(deadNames(report)).not.toContain('file:app.py:Alpha.get');
  });
});
