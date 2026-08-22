// @code-analyzer/infra — Auto Indexer
// Handles automatic indexing on MCP connection.
// Detects project type, runs FileDiscoverer, and indexes files into the graph store.

import type { FileDiscoverer } from '../filesystem/discoverer.js';
import type { InMemoryGraphStore } from '../storage/in-memory-graph-store.js';
import type { GraphNode } from '@code-analyzer/shared';
import { detectProject, type ProjectInfo } from './project-detector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoIndexerOptions {
  /** Whether to auto-index when a project is opened (default: true). */
  indexOnConnect?: boolean;
  /** Default project ID prefix (default: 'project'). */
  projectIdPrefix?: string;
}

export interface IndexResult {
  projectId: string;
  rootPath: string;
  filesDiscovered: number;
  nodesIndexed: number;
  durationMs: number;
  projectInfo: ProjectInfo;
}

export interface IndexingStatus {
  rootPath: string;
  projectId: string;
  projectInfo: ProjectInfo | null;
  nodeCount: number;
  indexedAt: string | null;
}

// ---------------------------------------------------------------------------
// AutoIndexer
// ---------------------------------------------------------------------------

export class AutoIndexer {
  private discoverer: FileDiscoverer;
  private store: InMemoryGraphStore;
  private options: Required<AutoIndexerOptions>;
  /** Map of rootPath → projectId for tracking indexed projects. */
  private indexedProjects: Map<string, string>;

  constructor(
    discoverer: FileDiscoverer,
    store: InMemoryGraphStore,
    options: AutoIndexerOptions = {},
  ) {
    this.discoverer = discoverer;
    this.store = store;
    this.options = {
      indexOnConnect: options.indexOnConnect ?? true,
      projectIdPrefix: options.projectIdPrefix ?? 'project',
    };
    this.indexedProjects = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Called when an MCP client connects or a project is opened.
   * Detects project type, discovers files, and indexes them into the graph store.
   *
   * @param rootPath - Absolute path to the project root.
   * @returns IndexResult with statistics about the indexing run.
   */
  async onProjectOpen(rootPath: string): Promise<IndexResult> {
    const startTime = Date.now();
    const projectInfo = detectProject(rootPath);

    // Generate a unique projectId
    const sanitized = rootPath.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);
    const projectId = `${this.options.projectIdPrefix}_${sanitized}_${startTime}`;

    let filesDiscovered = 0;
    let nodesIndexed = 0;

    if (this.options.indexOnConnect) {
      const files = await this.discoverer.discover(rootPath);

      filesDiscovered = files.length;

      // Index each file as a graph node under this projectId
      const now = new Date().toISOString();
      const graphNodes: GraphNode[] = [];

      for (const file of files) {
        const node: GraphNode = {
          id: 0, // InMemoryGraphStore assigns real IDs on insert
          projectId,
          label: 'File',
          name: file.filePath,
          qualifiedName: `${projectId}:${file.filePath}`,
          filePath: file.filePath,
          startLine: null,
          endLine: null,
          language: file.language,
          properties: {
            name: file.filePath,
            contentHash: file.hash,
            fileSize: file.size,
            content: file.content,
          },
          signature: null,
          docstring: null,
          complexity: null,
          isExported: false,
          fingerprint: file.hash,
          createdAt: now,
          updatedAt: now,
        };
        graphNodes.push(node);
      }

      try {
        const ids = this.store.insertNodes(graphNodes);
        nodesIndexed = ids.length;
        /* v8 ignore start -- @preserve */
      } catch {
        // Some nodes may already exist; insert one by one for resilience
        for (const node of graphNodes) {
          try {
            this.store.insertNode(node);
            nodesIndexed++;
          } catch {
            // Node already exists — skip
          }
        }
      }
      /* v8 ignore stop */
    }

    // Track this project
    this.indexedProjects.set(rootPath, projectId);

    const durationMs = Date.now() - startTime;

    return {
      projectId,
      rootPath,
      filesDiscovered,
      nodesIndexed,
      durationMs,
      projectInfo,
    };
  }

  /**
   * Check whether a project at the given root path has been indexed.
   */
  isIndexed(rootPath: string): boolean {
    const projectId = this.indexedProjects.get(rootPath);
    if (!projectId) return false;

    // Verify there are actually nodes for this project
    const allNodes = this.store.getAllNodes();
    const hasNodes = allNodes.some((n) => n.projectId === projectId);
    return hasNodes;
  }

  /**
   * Get a list of all indexed project root paths.
   */
  getIndexedProjects(): string[] {
    return Array.from(this.indexedProjects.keys());
  }

  /**
   * Get the indexing status for a project.
   */
  getStatus(rootPath: string): IndexingStatus {
    const projectId = this.indexedProjects.get(rootPath);
    if (!projectId) {
      return {
        rootPath,
        projectId: '',
        projectInfo: null,
        nodeCount: 0,
        indexedAt: null,
      };
    }

    const allNodes = this.store.getAllNodes();
    const projectNodes = allNodes.filter((n) => n.projectId === projectId);
    const nodeCount = projectNodes.length;

    // Get the most recent updatedAt from project nodes
    let indexedAt: string | null = null;
    /* v8 ignore next 4 -- @preserve */
    if (projectNodes.length > 0) {
      indexedAt = projectNodes.reduce(
        (latest, n) => (n.updatedAt > latest ? n.updatedAt : latest),
        projectNodes[0]!.updatedAt,
      );
    }

    return {
      rootPath,
      projectId,
      projectInfo: detectProject(rootPath),
      nodeCount,
      indexedAt,
    };
  }

  /**
   * Remove a project and all its indexed nodes from the store.
   */
  removeProject(rootPath: string): void {
    const projectId = this.indexedProjects.get(rootPath);
    if (!projectId) return;

    // Delete all nodes belonging to this project
    const allNodes = this.store.getAllNodes();
    /* v8 ignore next 3 -- @preserve */
    for (const node of allNodes) {
      if (node.projectId === projectId) {
        // Delete edges first
        const outgoingEdges = this.store.getEdgesForNode(node.id, undefined, 'out');
        const incomingEdges = this.store.getEdgesForNode(node.id, undefined, 'in');
        /* v8 ignore start -- @preserve */
        for (const edge of [...outgoingEdges, ...incomingEdges]) {
          try {
            this.store.deleteEdge(edge.id);
          } catch {
            // Edge may have been already deleted
          }
        }
        /* v8 ignore stop */
        try {
          this.store.deleteNode(node.id);
        } catch {
          // Node may have been already deleted
        }
      }
    }

    this.indexedProjects.delete(rootPath);
  }

  /**
   * Get the projectId for a given root path.
   */
  getProjectId(rootPath: string): string | null {
    return this.indexedProjects.get(rootPath) ?? null;
  }

  /**
   * Get the InMemoryGraphStore instance.
   */
  getStore(): InMemoryGraphStore {
    return this.store;
  }

  /**
   * Get the FileDiscoverer instance.
   */
  getDiscoverer(): FileDiscoverer {
    return this.discoverer;
  }
}
