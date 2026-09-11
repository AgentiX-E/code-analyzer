// @code-analyzer/vscode — Seeded graph fixture
//
// A populated graph behind the real EngineBridge facade, shared by the bridge,
// graph-explorer and tree-view suites.
//
// The bridge is a read-only facade: it never inserts a node, so without a graph
// to query every one of its features degrades to "no results" and every assertion
// about them would be vacuous. Handing it a store that the fixtures below have
// already built is the same relationship the analyzer indexer has with it in
// production, which is why EngineBridge takes the store as a seam.
//
// Nodes carry the workspace root as their project id because indexWorkspace()
// publishes that root as the active project, and every project-scoped query
// filters on it.

import { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphEdge, GraphNode } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_TESTS } from '@code-analyzer/shared';
import { EngineBridge } from '../../services/engine-bridge.js';

/** Project id the seeded graph and the bridged queries agree on. */
export const PROJECT = '/repo';

/** A second project in the same store, for cross-project edge cases. */
export const OTHER_PROJECT = '/other-repo';

export function makeNode(
  name: string,
  qualifiedName: string,
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const now = new Date().toISOString();
  return {
    id: 0,
    projectId: PROJECT,
    label: 'Class',
    name,
    qualifiedName,
    filePath: 'src/a.ts',
    startLine: 1,
    endLine: 10,
    language: 'typescript',
    properties: {},
    signature: `function ${name}()`,
    docstring: `Documentation for ${name}`,
    complexity: 5,
    isExported: true,
    fingerprint: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function insertEdge(
  store: InMemoryGraphStore,
  sourceId: number,
  targetId: number,
  type: GraphEdge['type'],
  projectId: string = PROJECT,
): void {
  store.insertEdge({
    id: 0,
    projectId,
    sourceId,
    targetId,
    type,
    properties: {},
    weight: 1,
    createdAt: new Date().toISOString(),
  });
}

export interface SeededGraph {
  store: InMemoryGraphStore;
  bridge: EngineBridge;
}

/**
 * Six symbols and four edges, covering the identity and nullability shapes the
 * bridge has to map: a fully-populated symbol, a symbol the graph recorded no
 * file for, and symbols that only exist as the two ends of an edge.
 *
 *   AlphaService    --CALLS-->  BetaService
 *   AlphaServiceTest --TESTS--> AlphaService
 *   UnfiledCaller   --CALLS-->  BareSymbol
 *   UnfiledTest     --TESTS-->  BareSymbol
 */
export async function seedGraph(): Promise<SeededGraph> {
  const store = new InMemoryGraphStore();

  const alpha = store.insertNode(makeNode('AlphaService', `${PROJECT}.AlphaService`));
  const beta = store.insertNode(
    makeNode('BetaService', `${PROJECT}.BetaService`, { filePath: 'src/b.ts' }),
  );
  const alphaTest = store.insertNode(
    makeNode('AlphaServiceTest', `${PROJECT}.AlphaServiceTest`, {
      label: 'Function',
      filePath: 'src/a.test.ts',
    }),
  );
  const bare = store.insertNode(
    makeNode('BareSymbol', `${PROJECT}.BareSymbol`, {
      filePath: null,
      startLine: null,
      endLine: null,
      signature: null,
      docstring: null,
      complexity: null,
    }),
  );
  const unfiledCaller = store.insertNode(
    makeNode('UnfiledCaller', `${PROJECT}.UnfiledCaller`, {
      label: 'Function',
      filePath: null,
    }),
  );
  const unfiledTest = store.insertNode(
    makeNode('UnfiledTest', `${PROJECT}.UnfiledTest`, {
      label: 'Function',
      filePath: null,
    }),
  );

  insertEdge(store, alpha, beta, EDGE_CALLS);
  insertEdge(store, alphaTest, alpha, EDGE_TESTS);
  insertEdge(store, unfiledCaller, bare, EDGE_CALLS);
  insertEdge(store, unfiledTest, bare, EDGE_TESTS);

  const bridge = new EngineBridge({ store });
  await bridge.initialize();
  await bridge.indexWorkspace(PROJECT);

  return { store, bridge };
}
