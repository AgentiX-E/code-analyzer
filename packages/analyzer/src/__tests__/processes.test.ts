// @code-analyzer — what a business process is, and which edges make one.
//
// **Every assertion here can fail.** The suite this replaces ran the phase over a TypeScript fixture and asserted
// `processesFound >= 0`, then `if (processNodes.length > 0) expect(stepEdges.length > 0)` — both true of an
// implementation that returns nothing at all. The claims worth testing are the ones a wrong answer contradicts:
// which edge types continue a process, where the walk stops, and what the step count means.

import { describe, expect, it } from 'vitest';

import { ProcessesPhase } from '../pipeline/phases/processes.js';

import type {
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  NodeLabel,
  PipelineContext,
  RelationshipType,
} from '@code-analyzer/shared';

const PROJ = 'processes';

function node(id: number, label: NodeLabel, name: string): GraphNode {
  return {
    id,
    projectId: PROJ,
    label,
    name,
    qualifiedName: name,
    filePath: `/src/${name}.ts`,
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    properties: { name },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}

function edge(id: number, sourceId: number, targetId: number, type: RelationshipType): GraphEdge {
  return {
    id,
    projectId: PROJ,
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
    createdAt: '',
  };
}

function context(nodes: GraphNode[], edges: GraphEdge[]): PipelineContext {
  const graph: KnowledgeGraph = {
    projectId: PROJ,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges: new Map(edges.map((e) => [e.id, e])),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
  return {
    projectId: PROJ,
    rootPath: '/src',
    graph,
    phaseData: new Map(),
    config: {},
    signal: new AbortController().signal,
    metadata: {},
  } as unknown as PipelineContext;
}

/** The steps of the one process the phase found, in the order the walk reached them. */
function stepsOf(ctx: PipelineContext): string[] {
  const graph = ctx.graph!;
  const processes = [...graph.nodes.values()].filter((n) => n.label === 'Process');
  expect(processes).toHaveLength(1);
  const processId = processes[0]!.id;
  const steps: number[] = [];
  for (const [, e] of graph.edges) {
    if (e.type === 'STEP_IN_PROCESS' && e.targetId === processId) steps.push(e.sourceId);
  }
  return steps.map((id) => graph.nodes.get(id)!.name);
}

describe('a process starts at a route and follows the edges that continue it', () => {
  it('walks CALLS, BELONGS_TO and IMPORTS, and counts the route itself as a step', async () => {
    const ctx = context(
      [
        node(1, 'Route', 'GET /owners'),
        node(2, 'Method', 'listOwners'),
        node(3, 'Method', 'findAll'),
        node(4, 'Class', 'OwnerRepository'),
      ],
      [edge(1, 1, 2, 'CALLS'), edge(2, 2, 3, 'BELONGS_TO'), edge(3, 3, 4, 'IMPORTS')],
    );
    const result = await new ProcessesPhase().execute(ctx);

    expect(result.status).toBe('success');
    expect((result.output as { processesFound: number }).processesFound).toBe(1);
    expect(stepsOf(ctx)).toEqual(['GET /owners', 'listOwners', 'findAll', 'OwnerRepository']);
  });

  it('stops at an edge that says nothing about control flow', async () => {
    // `DEFINES` runs from a file to its own contents. Following it would put every declaration in the repository into
    // the first process that touches its file.
    const ctx = context(
      [node(1, 'Route', 'POST /owners'), node(2, 'File', 'owners.ts'), node(3, 'Class', 'Owner')],
      [edge(1, 1, 2, 'CALLS'), edge(2, 2, 3, 'DEFINES')],
    );
    await new ProcessesPhase().execute(ctx);
    expect(stepsOf(ctx)).toEqual(['POST /owners', 'owners.ts']);
  });

  it('creates no process for a route that reaches nothing', async () => {
    // `steps.length > 1` is the whole definition of a process: one node is a route, not a business process.
    const ctx = context([node(1, 'Route', 'GET /health')], []);
    const result = await new ProcessesPhase().execute(ctx);
    expect((result.output as { processesFound: number }).processesFound).toBe(0);
    expect([...ctx.graph!.nodes.values()].filter((n) => n.label === 'Process')).toEqual([]);
  });

  it('gives each route its own process', async () => {
    const ctx = context(
      [
        node(1, 'Route', 'GET /owners'),
        node(2, 'Route', 'GET /vets'),
        node(3, 'Method', 'listOwners'),
        node(4, 'Method', 'listVets'),
      ],
      [edge(1, 1, 3, 'CALLS'), edge(2, 2, 4, 'CALLS')],
    );
    const result = await new ProcessesPhase().execute(ctx);
    expect((result.output as { processesFound: number }).processesFound).toBe(2);
  });

  it('caps the walk at fifty steps, so one long chain cannot become the whole graph', async () => {
    // **The cap is a decision, and a decision with no test is a number nobody knows the meaning of.** Fifty-one nodes
    // in a line: the walk visits the first fifty-one and stops, rather than following the line to its end.
    const nodes: GraphNode[] = [node(1, 'Route', 'GET /deep')];
    const edges: GraphEdge[] = [];
    for (let i = 2; i <= 60; i++) {
      nodes.push(node(i, 'Method', `step${i}`));
      edges.push(edge(i - 1, i - 1, i, 'CALLS'));
    }
    const ctx = context(nodes, edges);
    await new ProcessesPhase().execute(ctx);

    const steps = stepsOf(ctx);
    expect(steps).toHaveLength(51);
    expect(steps[steps.length - 1]).toBe('step51');
  });
});

describe('the phase reports what it did', () => {
  it('records the count in phase data, and returns it', async () => {
    const ctx = context(
      [node(1, 'Route', 'GET /owners'), node(2, 'Method', 'listOwners')],
      [edge(1, 1, 2, 'CALLS')],
    );
    const result = await new ProcessesPhase().execute(ctx);
    expect(ctx.phaseData.get('processes')).toEqual({ processesFound: 1 });
    expect(result.output).toEqual({ processesFound: 1 });
  });

  it('does nothing, successfully, when there is no graph', async () => {
    const ctx = context([], []);
    ctx.graph = undefined;
    const result = await new ProcessesPhase().execute(ctx);
    expect(result).toEqual({
      phaseId: 'processes',
      status: 'success',
      output: { processesFound: 0 },
    });
  });
});
