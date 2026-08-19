import { describe, it, expect } from 'vitest';
import { TestsPhase } from '../pipeline/phases/tests.js';
import type {
  PipelineContext,
  CodeAnalyzerConfig,
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  NodeLabel,
  RelationshipType,
} from '@code-analyzer/shared';

const PROJ = 'test-proj';
const ROOT = '/proj';

function makeConfig(): CodeAnalyzerConfig {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    excludePatterns: [],
    includePatterns: [],
    maxFileSize: 0,
    maxFiles: 0,
    parseWorkers: 1,
    ignorePaths: [],
  };
}

function makeNode(id: number, label: NodeLabel, filePath: string | null): GraphNode {
  return {
    id,
    projectId: PROJ,
    label,
    name: filePath ?? `node-${id}`,
    qualifiedName: filePath ?? `node-${id}`,
    filePath,
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    properties: filePath ? { name: filePath, filePath } : { name: `node-${id}` },
    signature: null,
    docstring: null,
    complexity: null,
    isExported: true,
    fingerprint: null,
    createdAt: '',
    updatedAt: '',
  };
}

function makeEdge(
  id: number,
  sourceId: number,
  targetId: number,
  type: RelationshipType,
): GraphEdge {
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

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph {
  return {
    projectId: PROJ,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges: new Map(edges.map((e) => [e.id, e])),
    qnameIndex: new Map(),
    fileIndex: new Map(),
  };
}

function makeCtx(graph: KnowledgeGraph): PipelineContext {
  return {
    projectId: PROJ,
    rootPath: ROOT,
    phaseData: new Map(),
    config: makeConfig(),
    graph,
  };
}

describe('TestsPhase — defensive branches', () => {
  it('ignores an IMPORTS edge whose target node is missing', async () => {
    // The test file has an IMPORTS edge to a non-existent node, so the
    // target-node lookup is falsy and importedFiles stays empty.
    const graph = makeGraph(
      [makeNode(1, 'File', '/proj/a.test.ts')],
      [makeEdge(10, 1, 999, 'IMPORTS')],
    );
    const result = await new TestsPhase().execute(makeCtx(graph));
    expect(result.status).toBe('success');
    expect((result.output as { testsFound: number }).testsFound).toBe(0);
  });

  it('ignores an imported file whose node is not File/Function/Class', async () => {
    // The IMPORTS target exists and has a filePath, but its label ('Module')
    // excludes it from filePathToNodeId, so targetNodeId is undefined.
    const graph = makeGraph(
      [makeNode(1, 'File', '/proj/a.test.ts'), makeNode(2, 'Module', '/proj/mod.ts')],
      [makeEdge(10, 1, 2, 'IMPORTS')],
    );
    const result = await new TestsPhase().execute(makeCtx(graph));
    expect(result.status).toBe('success');
    expect((result.output as { testsFound: number }).testsFound).toBe(0);
  });

  it('matches by filename convention when the source name contains the test name', async () => {
    // Test file "util.test.ts" (fileName "util") and source "myutil.ts"
    // (srcFileName "myutil"): fileName.includes(srcFileName) is false but
    // srcFileName.includes(fileName) is true, so the TESTS edge is created.
    const graph = makeGraph(
      [makeNode(1, 'File', '/proj/util.test.ts'), makeNode(2, 'File', '/proj/myutil.ts')],
      [],
    );
    const result = await new TestsPhase().execute(makeCtx(graph));
    expect(result.status).toBe('success');
    expect((result.output as { testsFound: number }).testsFound).toBe(1);
  });

  it('skips the filename fallback when neither name direction matches', async () => {
    // Test file "foo.test.ts" (fileName "foo") and source "/proj/foo/bar.ts"
    // (srcFileName "bar"): the source path contains "foo" (its directory), but
    // neither name contains the other, so no edge is created.
    const graph = makeGraph(
      [makeNode(1, 'File', '/proj/foo.test.ts'), makeNode(2, 'File', '/proj/foo/bar.ts')],
      [],
    );
    const result = await new TestsPhase().execute(makeCtx(graph));
    expect(result.status).toBe('success');
    expect((result.output as { testsFound: number }).testsFound).toBe(0);
  });

  it('reports an Error exception from graph iteration', async () => {
    const throwingGraph = {
      projectId: PROJ,
      get nodes(): Map<number, GraphNode> {
        throw new Error('kaboom');
      },
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    } as unknown as KnowledgeGraph;
    const result = await new TestsPhase().execute(makeCtx(throwingGraph));
    expect(result.status).toBe('failed');
    expect(result.error).toBe('kaboom');
  });

  it('reports a non-Error exception from graph iteration', async () => {
    const throwingGraph = {
      projectId: PROJ,
      get nodes(): Map<number, GraphNode> {
        throw 'boom';
      },
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    } as unknown as KnowledgeGraph;
    const result = await new TestsPhase().execute(makeCtx(throwingGraph));
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
  });
});
