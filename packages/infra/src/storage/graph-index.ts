// @code-analyzer/infra — Graph Store Index
// In-memory secondary indexes for O(1) lookups by name, label, and project.
// Plugs into InMemoryGraphStore for sub-millisecond query performance.

import type { GraphNode } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// NodeIndex
// ---------------------------------------------------------------------------

/** Multi-key index for graph nodes enabling O(1) lookups. */
export class NodeIndex {
  private readonly byName: Map<string, GraphNode[]> = new Map();
  private readonly byLabel: Map<string, GraphNode[]> = new Map();
  private readonly byProject: Map<string, GraphNode[]> = new Map();
  private readonly byId: Map<number, GraphNode> = new Map();
  private _size = 0;

  /** Insert a node into all indexes. O(1). */
  add(node: GraphNode): void {
    this.byId.set(node.id, node);

    const nameKey = node.name.toLowerCase();
    const existing = this.byName.get(nameKey);
    if (existing) {
      existing.push(node);
    } else {
      this.byName.set(nameKey, [node]);
    }

    const labelList = this.byLabel.get(node.label);
    if (labelList) {
      labelList.push(node);
    } else {
      this.byLabel.set(node.label, [node]);
    }

    const projectList = this.byProject.get(node.projectId);
    if (projectList) {
      projectList.push(node);
    } else {
      this.byProject.set(node.projectId, [node]);
    }

    this._size++;
  }

  /** Find nodes by name (case-insensitive). O(1). */
  findByName(name: string): GraphNode[] {
    return this.byName.get(name.toLowerCase()) ?? [];
  }

  /** Find nodes by label type. O(1). */
  findByLabel(label: string): GraphNode[] {
    return this.byLabel.get(label) ?? [];
  }

  /** Find nodes by project ID. O(1). */
  findByProject(projectId: string): GraphNode[] {
    return this.byProject.get(projectId) ?? [];
  }

  /** Get a single node by ID. O(1). */
  getById(id: number): GraphNode | undefined {
    return this.byId.get(id);
  }

  /** Remove a node from all indexes. O(n) worst-case due to array removal. */
  remove(nodeId: number): boolean {
    const node = this.byId.get(nodeId);
    if (!node) return false;

    this.byId.delete(nodeId);
    this.removeFromList(this.byName.get(node.name.toLowerCase()), nodeId);
    this.removeFromList(this.byLabel.get(node.label), nodeId);
    this.removeFromList(this.byProject.get(node.projectId), nodeId);

    this._size--;
    return true;
  }

  /** Clear all indexes. */
  clear(): void {
    this.byName.clear();
    this.byLabel.clear();
    this.byProject.clear();
    this.byId.clear();
    this._size = 0;
  }

  /** Total indexed nodes. */
  get size(): number {
    return this._size;
  }

  /** All node IDs known to this index. */
  get allIds(): number[] {
    return Array.from(this.byId.keys());
  }

  /** Statistics about the index. */
  getStats(): {
    totalNodes: number;
    uniqueNames: number;
    uniqueLabels: number;
    uniqueProjects: number;
  } {
    return {
      totalNodes: this._size,
      uniqueNames: this.byName.size,
      uniqueLabels: this.byLabel.size,
      uniqueProjects: this.byProject.size,
    };
  }

  /** Bulk insert for batch operations. */
  bulkAdd(nodes: GraphNode[]): void {
    for (const node of nodes) {
      this.add(node);
    }
  }

  /** Alias for bulkAdd — adds a batch of nodes. */
  addBatch(nodes: GraphNode[]): void {
    this.bulkAdd(nodes);
  }

  /** Check if a node exists in the index by ID. */
  has(nodeId: number): boolean {
    return this.byId.has(nodeId);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private removeFromList(list: GraphNode[] | undefined, nodeId: number): void {
    if (!list) return;
    const idx = list.findIndex((n) => n.id === nodeId);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// EdgeIndex
// ---------------------------------------------------------------------------

import type { GraphEdge, RelationshipType } from '@code-analyzer/shared';

/** Index for graph edges enabling O(1) lookups by source, target, and type. */
export class EdgeIndex {
  private readonly bySource: Map<number, GraphEdge[]> = new Map();
  private readonly byTarget: Map<number, GraphEdge[]> = new Map();
  private readonly byType: Map<string, GraphEdge[]> = new Map();
  private readonly byId: Map<number, GraphEdge> = new Map();
  private _size = 0;

  /** Insert an edge into all indexes. O(1). */
  add(edge: GraphEdge): void {
    this.byId.set(edge.id, edge);

    const srcList = this.bySource.get(edge.sourceId);
    if (srcList) srcList.push(edge);
    else this.bySource.set(edge.sourceId, [edge]);

    const tgtList = this.byTarget.get(edge.targetId);
    if (tgtList) tgtList.push(edge);
    else this.byTarget.set(edge.targetId, [edge]);

    const typeList = this.byType.get(edge.type);
    if (typeList) typeList.push(edge);
    else this.byType.set(edge.type, [edge]);

    this._size++;
  }

  /** Find edges by source node ID. O(1). */
  findBySource(sourceId: number): GraphEdge[] {
    return this.bySource.get(sourceId) ?? [];
  }

  /** Find edges by target node ID. O(1). */
  findByTarget(targetId: number): GraphEdge[] {
    return this.byTarget.get(targetId) ?? [];
  }

  /** Find edges by relationship type. O(1). */
  findByType(type: RelationshipType | string): GraphEdge[] {
    return this.byType.get(type) ?? [];
  }

  /** Find edges from a source node with specific type. */
  findBySourceAndType(sourceId: number, type: RelationshipType | string): GraphEdge[] {
    const srcEdges = this.bySource.get(sourceId) ?? [];
    return srcEdges.filter((e) => e.type === type);
  }

  /** Get an edge by ID. O(1). */
  getById(id: number): GraphEdge | undefined {
    return this.byId.get(id);
  }

  /** Remove an edge from all indexes. */
  remove(edgeId: number): boolean {
    const edge = this.byId.get(edgeId);
    if (!edge) return false;

    this.byId.delete(edgeId);
    this.removeFromList(this.bySource.get(edge.sourceId), edgeId);
    this.removeFromList(this.byTarget.get(edge.targetId), edgeId);
    this.removeFromList(this.byType.get(edge.type), edgeId);

    this._size--;
    return true;
  }

  /** Clear all indexes. */
  clear(): void {
    this.bySource.clear();
    this.byTarget.clear();
    this.byType.clear();
    this.byId.clear();
    this._size = 0;
  }

  /** Total indexed edges. */
  get size(): number {
    return this._size;
  }

  /** Bulk insert. */
  bulkAdd(edges: GraphEdge[]): void {
    for (const edge of edges) {
      this.add(edge);
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private removeFromList(list: GraphEdge[] | undefined, edgeId: number): void {
    if (!list) return;
    const idx = list.findIndex((e) => e.id === edgeId);
    if (idx !== -1) {
      list.splice(idx, 1);
    }
  }
}
