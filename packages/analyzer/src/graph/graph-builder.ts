// @code-analyzer/analyzer — Knowledge Graph Builder

import type { SqliteStore } from '@code-analyzer/infra';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  PipelineContext,
  NodeLabel,
  RelationshipType,
  NodeProperties,
  EdgeProperties,
} from '@code-analyzer/shared';

export interface IntegrityReport {
  projectId: string;
  valid: boolean;
  nodeCount: number;
  edgeCount: number;
  orphanEdges: number;
  duplicateQnames: number;
  issues: string[];
}

export class GraphBuilder {
  private readonly store: SqliteStore;
  private nextNodeId: number;
  private nextEdgeId: number;

  constructor(store: SqliteStore) {
    this.store = store;
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
  }

  /** Build knowledge graph from pipeline context */
  build(ctx: PipelineContext): KnowledgeGraph {
    const graph: KnowledgeGraph = {
      projectId: ctx.projectId,
      nodes: new Map(),
      edges: new Map(),
      qnameIndex: new Map(),
      fileIndex: new Map(),
    };

    // Create the root Project node
    const projectNode = this.createNode(
      'Project',
      ctx.projectId,
      { name: ctx.projectId },
    );
    graph.nodes.set(projectNode.id, projectNode);
    graph.qnameIndex.set(`project:${ctx.projectId}`, projectNode.id);

    // Add root path as a Folder node
    const rootFolder = this.createNode(
      'Folder',
      ctx.rootPath,
      { name: ctx.rootPath, filePath: ctx.rootPath },
      this.nextNodeId++,
    );
    graph.nodes.set(rootFolder.id, rootFolder);
    graph.fileIndex.set(ctx.rootPath, rootFolder.id);

    // Create CONTAINS edge: Project -> Folder
    const projectEdge = this.createEdge(
      projectNode.id,
      rootFolder.id,
      'CONTAINS',
      ctx.projectId,
    );
    graph.edges.set(projectEdge.id, projectEdge);

    return graph;
  }

  /** Dump in-memory graph to SQLite store */
  dumpToStore(graph: KnowledgeGraph, projectId: string): void {
    for (const [, node] of graph.nodes) {
      this.store.insertNode({ ...node, projectId });
    }

    for (const [, edge] of graph.edges) {
      this.store.insertEdge({ ...edge, projectId });
    }
  }

  /** Validate graph integrity */
  validate(graph: KnowledgeGraph): IntegrityReport {
    const issues: string[] = [];
    let orphanEdges = 0;
    let duplicateQnames = 0;

    // Check for orphan edges
    for (const [, edge] of graph.edges) {
      if (!graph.nodes.has(edge.sourceId)) {
        issues.push(
          `Edge id=${edge.id} references missing source node id=${edge.sourceId}`,
        );
        orphanEdges++;
      }
      if (!graph.nodes.has(edge.targetId)) {
        issues.push(
          `Edge id=${edge.id} references missing target node id=${edge.targetId}`,
        );
        orphanEdges++;
      }
    }

    // Check for duplicate qualified names
    const qnameSet = new Map<string, number[]>();
    for (const [, node] of graph.nodes) {
      if (node.qualifiedName) {
        const ids = qnameSet.get(node.qualifiedName) ?? [];
        ids.push(node.id);
        qnameSet.set(node.qualifiedName, ids);
      }
    }
    for (const [qname, ids] of qnameSet) {
      if (ids.length > 1) {
        issues.push(
          `Duplicate qualified name "${qname}" with ids: ${ids.join(', ')}`,
        );
        duplicateQnames++;
      }
    }

    return {
      projectId: graph.projectId,
      valid: issues.length === 0,
      nodeCount: graph.nodes.size,
      edgeCount: graph.edges.size,
      orphanEdges,
      duplicateQnames,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private createNode(
    label: NodeLabel,
    name: string,
    properties: NodeProperties,
    id?: number,
  ): GraphNode {
    const nodeId = id ?? this.nextNodeId++;
    return {
      id: nodeId,
      projectId: '', // Will be set when dumped
      label,
      name,
      qualifiedName: label === 'Project' ? `project:${name}` : name,
      filePath: (properties.filePath as string) ?? null,
      startLine: (properties.startLine as number) ?? null,
      endLine: (properties.endLine as number) ?? null,
      language: (properties.language as string) ?? null,
      properties,
      signature: (properties.signature as string) ?? null,
      docstring: (properties.docstring as string) ?? null,
      complexity: (properties.complexity as number) ?? null,
      isExported: (properties.isExported as boolean) ?? false,
      fingerprint: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private createEdge(
    sourceId: number,
    targetId: number,
    type: RelationshipType,
    projectId: string,
  ): GraphEdge {
    return {
      id: this.nextEdgeId++,
      projectId,
      sourceId,
      targetId,
      type,
      properties: {},
      weight: 1,
      createdAt: new Date().toISOString(),
    };
  }
}
