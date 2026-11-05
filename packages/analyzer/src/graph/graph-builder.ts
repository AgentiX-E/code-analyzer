// @code-analyzer/analyzer — Knowledge Graph Builder

import { basename } from 'node:path';

import { isDeclarationLabel, EDGE_CONTAINS } from '@code-analyzer/shared';

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

/**
 * The next id worth trying for a graph, kept beside it.
 *
 * **Why not on the graph**: `KnowledgeGraph` is a shared type with constructors in several packages, and a field
 * added for this would be a field every one of them has to know about. **Why not per builder**: the whole defect is
 * that a builder does not know what the other builders wrote.
 */
const ID_CURSORS = new WeakMap<object, { nodes: { value: number }; edges: { value: number } }>();

function cursorsFor(graph: KnowledgeGraph): { nodes: { value: number }; edges: { value: number } } {
  let cursor = ID_CURSORS.get(graph as object);
  if (!cursor) {
    cursor = { nodes: { value: 0 }, edges: { value: 0 } };
    ID_CURSORS.set(graph as object, cursor);
  }
  return cursor;
}

/**
 * An id this table does not hold, taking the cursor past it.
 *
 * **One function because it was one defect twice.** `addNode` and `addEdge` each stepped a builder-local counter
 * until the table stopped saying the id was taken, and both were called from a builder the parse phase creates once
 * per file. **Measured at 12,750 probes for 500 entries through 50 builders, in both tables** - the linear probe is
 * the same bug whether the table holds nodes or edges, and edges outnumber nodes in real code.
 *
 * The cursor is keyed by the graph rather than by the builder, which is the whole difference: a builder that does
 * not know what the other builders wrote cannot know where to start.
 */
function claimId(
  table: Map<number, unknown>,
  cursor: { value: number },
  preferred: number,
): number {
  let candidate = Math.max(preferred, cursor.value, table.size);
  while (table.has(candidate)) candidate += 1;
  cursor.value = candidate + 1;
  return candidate;
}

export class GraphBuilder {
  // **Nullable, because the constructor allows it** - and the type saying so is the point of the change.
  private readonly store: InMemoryGraphStore | null;
  private nextNodeId: number;
  private nextEdgeId: number;

  /**
   * **The store is optional because building a graph does not need one.** `addNode` and `addEdge` write into the
   * `KnowledgeGraph` they are given; only `dumpToStore` touches the store. **Two phases - `parse` and `tools` - build
   * nodes and never dump**, and both used to pass `null as unknown as InMemoryGraphStore` to say so. That cast told
   * the compiler the dependency was satisfied while the field held `null`, and it is the same expression that failed
   * at runtime the first time anything called `dumpToStore` on one - `cannot read properties of null (reading
   * 'insertNode')`. **An optional parameter says the same thing without lying to the compiler**, and `dumpToStore`
   * now fails with a sentence rather than a null dereference.
   */
  constructor(store: InMemoryGraphStore | null = null) {
    this.store = store;
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
  }

  /** Build knowledge graph from pipeline context */
  build(ctx: PipelineContext): KnowledgeGraph {
    const graph: KnowledgeGraph = {
      projectId: ctx.projectId,
      // **The graph records where it was rooted**, so a rule about a repository's layout can subtract the machine's
      // directories before it reads one. `ctx.rootPath` is absolute in every real run, and no rule downstream can tell
      // `/srv/build/benchmarks/corpora/zod/src` from `zod/src` without it.
      rootPath: ctx.rootPath,
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
      undefined,
      ctx.projectId,
    );
    graph.nodes.set(projectNode.id, projectNode);
    graph.qnameIndex.set(`project:${ctx.projectId}`, projectNode.id);

    // Add root path as a Folder node
    // **The node is named after the directory it is, not after the route to it**, for the same reason every other
    // node is: `qualifiedName` carries the location, and `name` is what a reader and a search index read. Two checkouts
    // of one repository at two paths used to produce two different vocabularies because of this line.
    const rootFolder = this.createNode(
      'Folder',
      basename(ctx.rootPath),
      { name: basename(ctx.rootPath), filePath: ctx.rootPath },
      this.nextNodeId++,
      ctx.projectId,
    );
    graph.nodes.set(rootFolder.id, rootFolder);
    graph.fileIndex.set(ctx.rootPath, rootFolder.id);

    // Create CONTAINS edge: Project -> Folder
    const projectEdge = this.createEdge(
      projectNode.id,
      rootFolder.id,
      EDGE_CONTAINS,
      ctx.projectId,
    );
    graph.edges.set(projectEdge.id, projectEdge);

    return graph;
  }

  /** Dump in-memory graph to store */
  dumpToStore(graph: KnowledgeGraph, projectId: string): void {
    // **A builder without a store cannot dump into one, and says so.** The alternative was `this.store.insertNode`
    // throwing `cannot read properties of null`, which names the line but not the mistake.
    if (!this.store) {
      throw new Error(
        'GraphBuilder.dumpToStore was called on a builder constructed without a store. ' +
          'Pass one when the graph is to be dumped; a builder that only calls addNode or addEdge does not need one.',
      );
    }
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
        // Re-map the graph-local ids into the store's own id space. An orphan
        // edge (an endpoint with no node entry) keeps its original id and is
        // then rejected by the store; validate() reports the same condition as
        // an integrity issue for callers that want to check before dumping.
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
        issues.push(`Edge id=${edge.id} references missing source node id=${edge.sourceId}`);
        orphanEdges++;
      }
      if (!graph.nodes.has(edge.targetId)) {
        issues.push(`Edge id=${edge.id} references missing target node id=${edge.targetId}`);
        orphanEdges++;
      }
    }

    // Check for duplicate qualified names. A node created without a name has an
    // empty qualifiedName (createNode falls back to the name) and cannot collide
    // with anything, so it is skipped here.
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
        issues.push(`Duplicate qualified name "${qname}" with ids: ${ids.join(', ')}`);
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
   *
   * **A name is one fact; a declaration is one node.** The first version of this method returned the existing node for
   * *any* repeated qualified name, which is the right rule for a name that occurs twice — three YAML keys called `with`
   * are one statement about the file — and the wrong rule for a declaration, because two declarations with one name are
   * two things a reader can open, a call can reach and a report can delete. Measured on `pallets/flask@3.0.3`: **317
   * callable declarations were silently merged into another**, `pallets/werkzeug@3.0.3` lost **372**, and the one that
   * mattered was `Response.status`: the `@status.setter` method was merged into the *parameter* `status` of
   * `Response.__init__`, so every call written in the setter was recorded as a call made by that parameter.
   *
   * **`(qualifiedName, startLine)` is the identity**, and it is enough: a declaration is added once per phase, and the
   * only way the same declaration arrives twice is a second phase reading the same file — the case this method must
   * still collapse. `qnameIndex` stays first-wins, so a name still answers with one node; what changed is that the
   * others exist.
   */
  addNode(
    graph: KnowledgeGraph,
    label: NodeLabel,
    name: string,
    properties: NodeProperties,
    qualifiedName?: string,
  ): GraphNode {
    const existingId =
      qualifiedName === undefined ? undefined : graph.qnameIndex.get(qualifiedName);
    const existingNode = existingId === undefined ? undefined : graph.nodes.get(existingId);
    const sameName = existingNode !== undefined;
    const sameDeclaration = sameName && existingNode.startLine === (properties.startLine ?? null);
    if (sameName && (!isDeclarationLabel(label) || sameDeclaration)) {
      return existingNode;
    }

    const node = this.createNode(label, name, properties, undefined, graph.projectId);
    // **The graph's own high-water mark, not this builder's counter.** The check has to handle several builders
    // writing into one graph, and the first version did it by stepping this builder's counter until it found a free
    // id. A builder created per file starts that counter from the same low value every time, so the first node of
    // the thousandth file probed a thousand ids: **O(files x nodes), which is the quadratic the parse phase was
    // paying** - its provider parses a 1,238-line file in about 20 ms while the phase reported 770 ms per file.
    //
    // The cursor is kept beside the graph rather than on it, in a WeakMap keyed by the graph: O(1), shared by every
    // builder writing into that graph, and no change to `KnowledgeGraph` or to anything that constructs one.
    const preferred = node.id;
    if (graph.nodes.has(preferred)) {
      node.id = claimId(graph.nodes, cursorsFor(graph).nodes, preferred);
    } else {
      const cursor = cursorsFor(graph).nodes;
      cursor.value = Math.max(cursor.value, preferred + 1);
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
    // **The same allocation the node table had**, on a table with more rows. Measured at 12,750 probes for the same
    // 500 entries through 50 builders - the number that made this a defect worth a shared function.
    if (graph.edges.has(edge.id)) {
      edge.id = claimId(graph.edges, cursorsFor(graph).edges, edge.id);
    } else {
      const cursor = cursorsFor(graph).edges;
      cursor.value = Math.max(cursor.value, edge.id + 1);
    }
    graph.edges.set(edge.id, edge);
    return edge;
  }

  /**
   * Find a folder node ID for a given path, creating intermediate folder nodes
   * as needed. Returns the leaf folder node ID.
   */
  ensureFolderPath(graph: KnowledgeGraph, rootPath: string, relativePath: string): number {
    const parts = relativePath.split('/').filter((p) => p.length > 0);
    let currentPath = rootPath;
    let parentId = graph.fileIndex.get(rootPath)!;

    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      let folderId = graph.fileIndex.get(currentPath);
      if (!folderId) {
        const folderNode = this.addNode(
          graph,
          'Folder',
          part,
          {
            name: part,
            filePath: currentPath,
          },
          `folder:${currentPath}`,
        );
        folderId = folderNode.id;
        this.addEdge(graph, parentId, folderId, EDGE_CONTAINS, graph.projectId);
      }
      parentId = folderId;
    }

    return parentId;
  }

  // -------------------------------------------------------------------------
  // Node/Edge Factory Methods (public for external use)
  // -------------------------------------------------------------------------

  /**
   * Build a node.
   *
   * **`projectId` is an argument because leaving it out made the field a promise two consumers never collected.** The
   * node was created with `projectId: ''` and a comment saying it would be set when dumped - and `dumpToStore` is the
   * only place that does. A phase that dumps is fine; a consumer that reads the graph the phases write into is not, and
   * the consumers that read it are the ones that ask questions: `retrieveContext` narrows a question to a project by
   * filtering candidates on `node.projectId`, so **every candidate of a pipeline-built graph was filtered away and
   * `ask_codebase` answered `no-blocks-retrieved` on a repository where the tool beside it ranked the file first.**
   * Measured on the end-to-end fixture: 12 candidates retrieved, 12 of them with an empty project, none with a file to
   * cite. Every internal caller now passes the graph's own project, so no node in an analysed graph is unscoped.
   */
  createNode(
    label: NodeLabel,
    name: string,
    properties: NodeProperties,
    id?: number,
    projectId = '',
  ): GraphNode {
    const nodeId = id ?? this.nextNodeId++;
    return {
      id: nodeId,
      projectId,
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
