// @code-analyzer/analyzer — writing a pipeline result into a graph store
//
// **Every surface that indexes a checkout needs this, and it used to live in the MCP tool that happened to need it
// first.** The consequence was structural: the CLI could only index a directory by depending on the MCP server package,
// which pulls in the server's own graph and transport layers to write some nodes into a map. The mapping is arithmetic
// over a `PipelineResult` and an `InMemoryGraphStore`; it belongs beside the pipeline that produces the first and the
// package that already declares a dependency on the second.

import type { PipelineResult } from './orchestrator.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';

/**
 * What happened when the analysis graph was written to the store.
 *
 * **`persisted` is `false` only for a caller that never ran a pipeline.** Every way a node or an edge can fail to be
 * stored is counted here rather than reported as a failure, because a graph with one un-storable node is still a graph -
 * but the count is published, so "the store took everything" and "the store took most of it" are two different
 * answers to a reader.
 */
export interface PersistenceReport {
  /** Whether a store was reachable at all. **`false` means the nodes went out of scope with the pipeline result.** */
  readonly persisted: boolean;
  readonly nodes: number;
  readonly edges: number;
  /** Nodes whose qualified name already existed — the graph is stored as far as the store would take it. */
  readonly duplicateNodes: number;
  /** Edges whose endpoints were dropped, so they could not be remapped. */
  readonly orphanEdges: number;
  /** The first defect, in one sentence, or `null` when every node and edge was taken. */
  readonly reason: string | null;
}

/**
 * Write a pipeline result into the graph store, remapping node ids as it goes.
 *
 * **This function exists because the tool that indexed did not index.** `analyze_repository` ran the full pipeline,
 * reported `nodeCount`, and dropped `result.graph` when the handler returned: `currentAnalysis` was assigned on the tool
 * context and read by nothing, so after "indexing" a project the store held zero nodes and every query tool answered
 * about an empty graph. The unit tests did not see it because they insert nodes by hand, and the L4 harness saw it on its
 * first run — a tool that reports 805 nodes and leaves the store empty is the exact defect an end-to-end measurement
 * exists to find.
 *
 * **Ids are remapped, not copied.** The pipeline numbers its own nodes from zero and the store allocates its own ids, so
 * an edge inserted with the pipeline's ids either fails the store's existence check or - worse - attaches to whatever
 * node happened to take that id. The map is built as the nodes go in, and an edge with a missing endpoint is counted
 * rather than silently dropped.
 */
export function persistGraph(
  graphStore: InMemoryGraphStore,
  result: PipelineResult,
  projectId: string,
  force: boolean,
): PersistenceReport {
  // **`force` is the promise that a re-index replaces the old one**, and a promise the store would otherwise keep by
  // throwing on the first node whose qualified name already exists — leaving the project half old and half new.
  if (force) {
    for (const edge of graphStore.getAllEdges()) {
      if (edge.projectId === projectId) graphStore.deleteEdge(edge.id);
    }
    for (const node of graphStore.getAllNodes()) {
      if (node.projectId === projectId) graphStore.deleteNode(node.id);
    }
  }

  const idMap = new Map<number, number>();
  let nodes = 0;
  let duplicateNodes = 0;
  let reason: string | null = null;
  for (const [pipelineId, node] of result.graph.nodes) {
    const { id: _pipelineId, ...rest } = node;
    try {
      idMap.set(pipelineId, graphStore.insertNode(rest));
      nodes += 1;
    } catch (error) {
      duplicateNodes += 1;
      reason ??= `node "${node.qualifiedName}" was not stored: ${String((error as Error).message)}`;
    }
  }

  let edges = 0;
  let orphanEdges = 0;
  for (const edge of result.graph.edges.values()) {
    const sourceId = idMap.get(edge.sourceId);
    const targetId = idMap.get(edge.targetId);
    if (sourceId === undefined || targetId === undefined) {
      orphanEdges += 1;
      continue;
    }
    try {
      graphStore.insertEdge({
        projectId: edge.projectId,
        type: edge.type,
        sourceId,
        targetId,
        properties: edge.properties,
        weight: edge.weight,
      });
      edges += 1;
    } catch (error) {
      orphanEdges += 1;
      reason ??= `edge ${edge.type} was not stored: ${String((error as Error).message)}`;
    }
  }

  return { persisted: true, nodes, edges, duplicateNodes, orphanEdges, reason };
}
