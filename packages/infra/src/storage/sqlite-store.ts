// @code-analyzer/infra — SQLite Store
// Typed Map-based in-memory store with full CRUD, FTS, BFS, and integrity checks.

import type {
  NodeQuery,
  EdgeQuery,
  FtsSearchResult,
  BfsResult,
  IntegrityReport,
  IntegrityIssue,
} from './types.js';
import type {
  GraphNode,
  GraphEdge,
  NodeLabel,
  RelationshipType,
  NodeProperties,
  PaginatedResult,
  EdgeProperties,
} from '@code-analyzer/shared';


interface StoredNode {
  id: number;
  projectId: string;
  label: NodeLabel;
  name: string;
  qualifiedName: string;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  language: string | null;
  properties: NodeProperties;
  signature: string | null;
  docstring: string | null;
  complexity: number | null;
  isExported: boolean;
  fingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredEdge {
  id: number;
  projectId: string;
  sourceId: number;
  targetId: number;
  type: RelationshipType;
  properties: EdgeProperties;
  weight: number;
  createdAt: string;
}

export class SqliteStore {
  private nodes: Map<number, StoredNode>;
  private edges: Map<number, StoredEdge>;
  private qnameIndex: Map<string, number>;
  private nextNodeId: number;
  private nextEdgeId: number;
  private closed: boolean;

  // Transaction support
  private transactionStack: Array<{
    nodesSnapshot: Map<number, StoredNode>;
    edgesSnapshot: Map<number, StoredEdge>;
    qnameSnapshot: Map<string, number>;
    nextNodeIdSnapshot: number;
    nextEdgeIdSnapshot: number;
  }>;

  constructor(_dbPath?: string) {
    this.nodes = new Map();
    this.edges = new Map();
    this.qnameIndex = new Map();
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.closed = false;
    this.transactionStack = [];
  }

  // -------------------------------------------------------------------------
  // Node CRUD
  // -------------------------------------------------------------------------

  insertNode(node: GraphNode): number {
    this.ensureOpen();
    const id = this.nextNodeId++;
    const stored: StoredNode = { ...node, id };
    this.nodes.set(id, stored);

    if (node.qualifiedName) {
      if (this.qnameIndex.has(node.qualifiedName)) {
        throw new Error(
          `Node insert failed: node "${node.qualifiedName}" already exists (id: ${this.qnameIndex.get(node.qualifiedName)})`,
        );
      }
      this.qnameIndex.set(node.qualifiedName, id);
    }

    return id;
  }

  insertNodes(nodes: GraphNode[]): number[] {
    return nodes.map((n) => this.insertNode(n));
  }

  updateNode(id: number, props: Partial<NodeProperties>): void {
    this.ensureOpen();
    const existing = this.nodes.get(id);
    if (!existing) {
      throw new Error(`Node update failed: node id=${id} not found`);
    }

    // Create a new node object with updated fields (don't mutate in place - enables rollback)
    const node: StoredNode = {
      ...existing,
      name: props.name ?? existing.name,
      filePath: props.filePath !== undefined ? props.filePath : existing.filePath,
      startLine: props.startLine !== undefined ? props.startLine : existing.startLine,
      endLine: props.endLine !== undefined ? props.endLine : existing.endLine,
      language: props.language !== undefined ? props.language : existing.language,
      isExported: props.isExported !== undefined ? props.isExported : existing.isExported,
      signature: props.signature !== undefined ? props.signature : existing.signature,
      docstring: props.docstring !== undefined ? props.docstring : existing.docstring,
      complexity: props.complexity !== undefined ? props.complexity : existing.complexity,
      properties: { ...existing.properties },
      updatedAt: new Date().toISOString(),
    };

    // Apply property updates into the new properties object
    if (props.returnType !== undefined) node.properties.returnType = props.returnType;
    if (props.cognitiveComplexity !== undefined) node.properties.cognitiveComplexity = props.cognitiveComplexity;
    if (props.parameterCount !== undefined) node.properties.parameterCount = props.parameterCount;
    if (props.isAsync !== undefined) node.properties.isAsync = props.isAsync;
    if (props.visibility !== undefined) node.properties.visibility = props.visibility;
    if (props.isAbstract !== undefined) node.properties.isAbstract = props.isAbstract;
    if (props.isStatic !== undefined) node.properties.isStatic = props.isStatic;
    if (props.isConst !== undefined) node.properties.isConst = props.isConst;
    if (props.routePath !== undefined) node.properties.routePath = props.routePath;
    if (props.routeMethod !== undefined) node.properties.routeMethod = props.routeMethod;
    if (props.decorators !== undefined) node.properties.decorators = props.decorators;
    if (props.baseClasses !== undefined) node.properties.baseClasses = props.baseClasses;
    if (props.implementedInterfaces !== undefined) node.properties.implementedInterfaces = props.implementedInterfaces;

    // Merge any extra properties
    for (const [key, value] of Object.entries(props)) {
      if (!(key in node) || key === 'properties') continue;
      node.properties[key] = value;
    }

    this.nodes.set(id, node);
  }

  deleteNode(id: number): void {
    this.ensureOpen();
    const node = this.nodes.get(id);
    if (node) {
      if (node.qualifiedName) {
        this.qnameIndex.delete(node.qualifiedName);
      }
      this.nodes.delete(id);

      // Also delete all edges connected to this node
      for (const [edgeId, edge] of this.edges) {
        if (edge.sourceId === id || edge.targetId === id) {
          this.edges.delete(edgeId);
        }
      }
    }
  }

  getNode(id: number): GraphNode | null {
    this.ensureOpen();
    const node = this.nodes.get(id);
    if (!node) return null;
    return this.toGraphNode(node);
  }

  getNodeByQualifiedName(qname: string): GraphNode | null {
    this.ensureOpen();
    const id = this.qnameIndex.get(qname);
    if (id === undefined) return null;
    return this.getNode(id);
  }

  queryNodes(query: NodeQuery): PaginatedResult<GraphNode> {
    this.ensureOpen();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const results: StoredNode[] = [];

    for (const node of this.nodes.values()) {
      if (node.projectId !== query.projectId) continue;

      // Label filter
      if (query.label !== undefined) {
        const labels = Array.isArray(query.label) ? query.label : [query.label];
        if (!labels.includes(node.label)) continue;
      }

      // Name pattern filter
      if (query.namePattern) {
        const regex = this.patternToRegex(query.namePattern);
        if (!regex.test(node.name)) continue;
      }

      // Qualified name pattern
      if (query.qualifiedNamePattern) {
        const regex = this.patternToRegex(query.qualifiedNamePattern);
        if (!regex.test(node.qualifiedName)) continue;
      }

      // File pattern
      if (query.filePattern) {
        const regex = this.patternToRegex(query.filePattern);
        if (!node.filePath || !regex.test(node.filePath)) continue;
      }

      // Line range
      if (query.minLine !== undefined) {
        if (node.startLine === null || node.startLine < query.minLine) continue;
      }
      if (query.maxLine !== undefined) {
        if (node.endLine === null || node.endLine > query.maxLine) continue;
      }

      // Export filter
      if (query.isExported !== undefined) {
        if (node.isExported !== query.isExported) continue;
      }

      results.push(node);
    }

    // Sort
    if (query.sortBy) {
      const direction = query.sortDirection === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;

        switch (query.sortBy) {
          case 'name':
            valA = a.name;
            valB = b.name;
            break;
          case 'complexity':
            valA = a.complexity ?? 0;
            valB = b.complexity ?? 0;
            break;
          case 'line_count':
            valA = (a.endLine ?? 0) - (a.startLine ?? 0);
            valB = (b.endLine ?? 0) - (b.startLine ?? 0);
            break;
        }

        if (valA < valB) return -direction;
        if (valA > valB) return direction;
        return 0;
      });
    }

    const total = results.length;
    const paged = results.slice(offset, offset + limit);

    return {
      items: paged.map((n) => this.toGraphNode(n)),
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  // -------------------------------------------------------------------------
  // Edge CRUD
  // -------------------------------------------------------------------------

  insertEdge(edge: GraphEdge): number {
    this.ensureOpen();

    // Verify source and target exist
    if (!this.nodes.has(edge.sourceId)) {
      throw new Error(`Edge insert failed: source node id=${edge.sourceId} not found`);
    }
    if (!this.nodes.has(edge.targetId)) {
      throw new Error(`Edge insert failed: target node id=${edge.targetId} not found`);
    }

    const id = this.nextEdgeId++;
    const stored: StoredEdge = { ...edge, id };
    this.edges.set(id, stored);
    return id;
  }

  insertEdges(edges: GraphEdge[]): number[] {
    return edges.map((e) => this.insertEdge(e));
  }

  deleteEdge(id: number): void {
    this.ensureOpen();
    this.edges.delete(id);
  }

  queryEdges(query: EdgeQuery): PaginatedResult<GraphEdge> {
    this.ensureOpen();
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const results: StoredEdge[] = [];

    for (const edge of this.edges.values()) {
      if (edge.projectId !== query.projectId) continue;

      if (query.sourceId !== undefined && edge.sourceId !== query.sourceId) continue;
      if (query.targetId !== undefined && edge.targetId !== query.targetId) continue;

      if (query.type !== undefined) {
        const types = Array.isArray(query.type) ? query.type : [query.type];
        if (!types.includes(edge.type)) continue;
      }

      results.push(edge);
    }

    const total = results.length;
    const paged = results.slice(offset, offset + limit);

    return {
      items: paged.map((e) => this.toGraphEdge(e)),
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  getEdgesForNode(
    nodeId: number,
    type?: RelationshipType,
    direction: 'in' | 'out' = 'out',
  ): GraphEdge[] {
    this.ensureOpen();
    const results: GraphEdge[] = [];

    for (const edge of this.edges.values()) {
      const matchesDirection =
        (direction === 'out' && edge.sourceId === nodeId) ||
        (direction === 'in' && edge.targetId === nodeId);

      if (!matchesDirection) continue;
      if (type && edge.type !== type) continue;

      results.push(this.toGraphEdge(edge));
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // FTS5-Compatible Full-Text Search
  // -------------------------------------------------------------------------

  searchFts(
    query: string,
    options?: { limit?: number; offset?: number; labels?: NodeLabel[] },
  ): FtsSearchResult[] {
    this.ensureOpen();
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: FtsSearchResult[] = [];

    for (const node of this.nodes.values()) {
      if (options?.labels && options.labels.length > 0) {
        if (!options.labels.includes(node.label)) continue;
      }

      let bestRank = 0;
      let bestColumn = '';
      let snippet = '';

      for (const term of terms) {
        // Search in name
        if (node.name.toLowerCase().includes(term)) {
          const rank = 10;
          if (rank > bestRank) {
            bestRank = rank;
            bestColumn = 'name';
            snippet = this.highlightTerm(node.name, term);
          }
        }

        // Search in qualifiedName (weighted higher)
        if (node.qualifiedName.toLowerCase().includes(term)) {
          const rank = 8;
          if (rank > bestRank) {
            bestRank = rank;
            bestColumn = 'qualifiedName';
            snippet = this.highlightTerm(node.qualifiedName, term);
          }
        }

        // Search in signature
        if (node.signature && node.signature.toLowerCase().includes(term)) {
          const rank = 5;
          if (rank > bestRank) {
            bestRank = rank;
            bestColumn = 'signature';
            snippet = this.highlightTerm(node.signature, term);
          }
        }

        // Search in docstring
        if (node.docstring && node.docstring.toLowerCase().includes(term)) {
          const rank = 3;
          if (rank > bestRank) {
            bestRank = rank;
            bestColumn = 'docstring';
            snippet = this.highlightTerm(node.docstring, term);
          }
        }

        // Search in filePath
        if (node.filePath && node.filePath.toLowerCase().includes(term)) {
          const rank = 2;
          if (rank > bestRank) {
            bestRank = rank;
            bestColumn = 'filePath';
            snippet = this.highlightTerm(node.filePath, term);
          }
        }

        // Search in decorators/properties
        const decorators = node.properties.decorators;
        if (decorators) {
          for (const d of decorators) {
            if (d.toLowerCase().includes(term)) {
              const rank = 1;
              if (rank > bestRank) {
                bestRank = rank;
                bestColumn = 'decorators';
                snippet = this.highlightTerm(d, term);
              }
            }
          }
        }
      }

      // Penalize the rank based on the number of terms matched
      // More terms matched = higher rank
      const matchedTerms = terms.filter((t) => {
        const text = [
          node.name,
          node.qualifiedName,
          node.signature,
          node.docstring,
          node.filePath,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return text.includes(t);
      }).length;

      if (bestRank > 0) {
        bestRank += matchedTerms * 3;
      }

      if (bestRank > 0) {
        results.push({
          nodeId: node.id,
          node: this.toGraphNode(node),
          rank: bestRank,
          matchedColumn: bestColumn,
          snippet,
        });
      }
    }

    // Sort by rank descending
    results.sort((a, b) => b.rank - a.rank);

    return results.slice(offset, offset + limit);
  }

  // -------------------------------------------------------------------------
  // Graph Traversal — BFS
  // -------------------------------------------------------------------------

  bfs(
    sourceId: number,
    maxDepth: number,
    edgeTypes?: RelationshipType[],
  ): BfsResult {
    this.ensureOpen();

    const sourceNode = this.nodes.get(sourceId);
    if (!sourceNode) {
      return {
        nodes: [],
        edges: [],
        pathLengths: new Map(),
        visitedCount: 0,
        maxDepthReached: 0,
      };
    }

    const visited = new Set<number>();
    const visitedEdges = new Map<number, StoredEdge>();
    const pathLengths = new Map<number, number>();
    const queue: Array<{ nodeId: number; depth: number }> = [];

    queue.push({ nodeId: sourceId, depth: 0 });
    visited.add(sourceId);
    pathLengths.set(sourceId, 0);

    let maxDepthReached = 0;

    while (queue.length > 0) {
       
      const current = queue.shift()!;
      if (current.depth > maxDepthReached) {
        maxDepthReached = current.depth;
      }

      if (current.depth >= maxDepth) continue;

      // Find outgoing edges from current node
      for (const edge of this.edges.values()) {
        if (edge.sourceId !== current.nodeId) continue;
        if (edgeTypes && edgeTypes.length > 0 && !edgeTypes.includes(edge.type)) continue;

        const neighborId = edge.targetId;
        if (visited.has(neighborId)) continue;

        visited.add(neighborId);
        visitedEdges.set(edge.id, edge);
        pathLengths.set(neighborId, current.depth + 1);
        queue.push({ nodeId: neighborId, depth: current.depth + 1 });
      }
    }

    const resultNodes: GraphNode[] = [];
    for (const nodeId of visited) {
      const node = this.nodes.get(nodeId);
      if (node) {
        resultNodes.push(this.toGraphNode(node));
      }
    }

    const resultEdges: GraphEdge[] = [];
    for (const edge of visitedEdges.values()) {
      resultEdges.push(this.toGraphEdge(edge));
    }

    return {
      nodes: resultNodes,
      edges: resultEdges,
      pathLengths,
      visitedCount: visited.size,
      maxDepthReached,
    };
  }

  getDegree(nodeId: number): number {
    this.ensureOpen();
    let count = 0;
    for (const edge of this.edges.values()) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        count++;
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Graph Integrity
  // -------------------------------------------------------------------------

  validateIntegrity(projectId: string): IntegrityReport {
    this.ensureOpen();
    const issues: IntegrityIssue[] = [];
    let orphanEdges = 0;
    let duplicateQnames = 0;

    // Check for orphan edges (edges referencing non-existent nodes)
    for (const edge of this.edges.values()) {
      if (edge.projectId !== projectId) continue;
      if (!this.nodes.has(edge.sourceId)) {
        issues.push({
          type: 'orphan_edge',
          description: `Edge id=${edge.id} references missing source node id=${edge.sourceId}`,
          edgeId: edge.id,
          nodeId: edge.sourceId,
        });
        orphanEdges++;
      }
      if (!this.nodes.has(edge.targetId)) {
        issues.push({
          type: 'orphan_edge',
          description: `Edge id=${edge.id} references missing target node id=${edge.targetId}`,
          edgeId: edge.id,
          nodeId: edge.targetId,
        });
        orphanEdges++;
      }
    }

    // Check for duplicate qualified names
    const qnameCounts = new Map<string, number[]>();
    for (const node of this.nodes.values()) {
      if (node.projectId !== projectId) continue;
      if (node.qualifiedName) {
        const ids = qnameCounts.get(node.qualifiedName) ?? [];
        ids.push(node.id);
        qnameCounts.set(node.qualifiedName, ids);
      }
    }
    for (const [qname, ids] of qnameCounts) {
      if (ids.length > 1) {
        issues.push({
          type: 'duplicate_qname',
          description: `Qualified name "${qname}" has ${ids.length} nodes: ${ids.join(', ')}`,
          qname,
        });
        duplicateQnames++;
      }
    }

    // Check for nodes with empty qualified names
    for (const node of this.nodes.values()) {
      if (node.projectId !== projectId) continue;
      if (!node.qualifiedName) {
        issues.push({
          type: 'missing_qname',
          description: `Node id=${node.id} name="${node.name}" has empty qualifiedName`,
          nodeId: node.id,
        });
      }
    }

    // Count project nodes and edges
    let nodeCount = 0;
    let edgeCount = 0;
    for (const node of this.nodes.values()) {
      if (node.projectId === projectId) nodeCount++;
    }
    for (const edge of this.edges.values()) {
      if (edge.projectId === projectId) edgeCount++;
    }

    return {
      projectId,
      valid: issues.length === 0,
      nodeCount,
      edgeCount,
      orphanEdges,
      duplicateQnames,
      issues,
      checkedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  transaction<T>(fn: () => T): T {
    this.ensureOpen();

    // If we're already in a transaction, just execute
    if (this.transactionStack.length > 0) {
      return fn();
    }

    // Begin transaction: snapshot current state
    const snapshot = {
      nodesSnapshot: new Map(this.nodes),
      edgesSnapshot: new Map(this.edges),
      qnameSnapshot: new Map(this.qnameIndex),
      nextNodeIdSnapshot: this.nextNodeId,
      nextEdgeIdSnapshot: this.nextEdgeId,
    };

    this.transactionStack.push(snapshot);

    try {
      const result = fn();
      // Commit: pop the stack (keep the current state)
      this.transactionStack.pop();
      return result;
    } catch (err) {
      // Rollback: restore snapshot
      this.nodes = snapshot.nodesSnapshot;
      this.edges = snapshot.edgesSnapshot;
      this.qnameIndex = snapshot.qnameSnapshot;
      this.nextNodeId = snapshot.nextNodeIdSnapshot;
      this.nextEdgeId = snapshot.nextEdgeIdSnapshot;
      this.transactionStack.pop();
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------

  optimize(): void {
    this.ensureOpen();
    // In-memory store: rebuild indexes for efficiency
    // Rebuild qname index
    this.qnameIndex.clear();
    for (const node of this.nodes.values()) {
      if (node.qualifiedName) {
        this.qnameIndex.set(node.qualifiedName, node.id);
      }
    }
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getEdgeCount(): number {
    return this.edges.size;
  }

  getAllNodes(): GraphNode[] {
    this.ensureOpen();
    return Array.from(this.nodes.values()).map((n) => this.toGraphNode(n));
  }

  getAllEdges(): GraphEdge[] {
    this.ensureOpen();
    return Array.from(this.edges.values()).map((e) => this.toGraphEdge(e));
  }

  close(): void {
    this.nodes.clear();
    this.edges.clear();
    this.qnameIndex.clear();
    this.closed = true;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('SqliteStore is closed');
    }
  }

  private toGraphNode(node: StoredNode): GraphNode {
    return {
      id: node.id,
      projectId: node.projectId,
      label: node.label,
      name: node.name,
      qualifiedName: node.qualifiedName,
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      language: node.language,
      properties: { ...node.properties },
      signature: node.signature,
      docstring: node.docstring,
      complexity: node.complexity,
      isExported: node.isExported,
      fingerprint: node.fingerprint,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }

  private toGraphEdge(edge: StoredEdge): GraphEdge {
    return {
      id: edge.id,
      projectId: edge.projectId,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      type: edge.type,
      properties: { ...edge.properties },
      weight: edge.weight,
      createdAt: edge.createdAt,
    };
  }

  private patternToRegex(pattern: string): RegExp {
    // Support * wildcard (converted to regex .*)
    // Step 1: escape all regex special characters (including *)
    const escaped = pattern.replace(/[.*+^${}()|[\]\\]/g, '\\$&');
    // Step 2: convert escaped * back to regex wildcard
    const regexStr = escaped.replace(/\\\*/g, '.*');
    return new RegExp(`^${regexStr}$`, 'i');
  }

  private highlightTerm(text: string, term: string): string {
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return text.slice(0, 100);

    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + term.length + 40);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    const body = text.slice(start, end);
    const termStart = idx - start;
    const termEnd = termStart + term.length;

    return (
      prefix +
      body.slice(0, termStart) +
      '<<' +
      text.slice(idx, idx + term.length) +
      '>>' +
      body.slice(termEnd) +
      suffix
    );
  }
}
