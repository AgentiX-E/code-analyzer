// @code-analyzer/analyzer — Knowledge Graph Builder

import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  PipelineContext,
  NodeLabel,
  RelationshipType,
  NodeProperties,
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
  private readonly store: InMemoryGraphStore;
  private nextNodeId: number;
  private nextEdgeId: number;

  constructor(store: InMemoryGraphStore) {
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

  /** Dump in-memory graph to store */
  dumpToStore(graph: KnowledgeGraph, projectId: string): void {
    // Map old graph node IDs to new store node IDs
    const idMap = new Map<number, number>();

    for (const [, node] of graph.nodes) {
      const newId = this.store.insertNode({ ...node, projectId });
      idMap.set(node.id, newId);
    }

    for (const [, edge] of graph.edges) {
      this.store.insertEdge({
        ...edge,
        projectId,
        sourceId: idMap.get(edge.sourceId) ?? edge.sourceId,
        targetId: idMap.get(edge.targetId) ?? edge.targetId,
      });
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
  // Public Graph Manipulation Methods (for pipeline phases)
  // -------------------------------------------------------------------------

  /**
   * Create a node and add it to the graph.
   * Safe across multiple GraphBuilder instances — resolves ID conflicts.
   * Returns the created GraphNode.
   */
  addNode(
    graph: KnowledgeGraph,
    label: NodeLabel,
    name: string,
    properties: NodeProperties,
    qualifiedName?: string,
  ): GraphNode {
    // If qualified name already exists, return the existing node
    if (qualifiedName && graph.qnameIndex.has(qualifiedName)) {
      const existingId = graph.qnameIndex.get(qualifiedName)!;
      const existingNode = graph.nodes.get(existingId);
      if (existingNode) {
        return existingNode;
      }
    }

    const node = this.createNode(label, name, properties);
    // Ensure no ID conflicts with existing graph nodes (multiple builder instances)
    while (graph.nodes.has(node.id)) {
      node.id = this.nextNodeId++;
    }
    if (qualifiedName) {
      node.qualifiedName = qualifiedName;
    }
    graph.nodes.set(node.id, node);

    // Index by qualified name
    if (node.qualifiedName && !graph.qnameIndex.has(node.qualifiedName)) {
      graph.qnameIndex.set(node.qualifiedName, node.id);
    }

    // Index File/Folder nodes by filePath
    if ((label === 'File' || label === 'Folder') && node.filePath) {
      graph.fileIndex.set(node.filePath, node.id);
    }

    return node;
  }

  /**
   * Create an edge and add it to the graph.
   * Safe across multiple GraphBuilder instances — resolves ID conflicts.
   * Returns the created GraphEdge.
   */
  addEdge(
    graph: KnowledgeGraph,
    sourceId: number,
    targetId: number,
    type: RelationshipType,
    projectId: string,
  ): GraphEdge {
    const edge = this.createEdge(sourceId, targetId, type, projectId);
    // Ensure no ID conflicts with existing graph edges (multiple builder instances)
    while (graph.edges.has(edge.id)) {
      edge.id = this.nextEdgeId++;
    }
    graph.edges.set(edge.id, edge);
    return edge;
  }

  /**
   * Find a folder node ID for a given path, creating intermediate folder nodes
   * as needed. Returns the leaf folder node ID.
   */
  ensureFolderPath(
    graph: KnowledgeGraph,
    rootPath: string,
    relativePath: string,
  ): number {
    const parts = relativePath.split('/').filter((p) => p.length > 0);
    let currentPath = rootPath;
    let parentId = graph.fileIndex.get(rootPath)!;

    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      let folderId = graph.fileIndex.get(currentPath);
      if (!folderId) {
        const folderNode = this.addNode(graph, 'Folder', currentPath, {
          name: part,
          filePath: currentPath,
        }, `folder:${currentPath}`);
        folderId = folderNode.id;
        this.addEdge(graph, parentId, folderId, 'CONTAINS', graph.projectId);
      }
      parentId = folderId;
    }

    return parentId;
  }

  // -------------------------------------------------------------------------
  // Node/Edge Factory Methods (public for external use)
  // -------------------------------------------------------------------------

  createNode(
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

  createEdge(
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
