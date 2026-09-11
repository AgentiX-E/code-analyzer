// @code-analyzer/vscode — Graph Explorer Provider
// Pure logic class for knowledge graph exploration in the sidebar.
// No VS Code dependency — all VS Code integration lives in extension.ts.

import type { EngineBridge, SymbolDetailItem } from '../services/engine-bridge.js';
import { EDGE_CALLS } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Graph Data Types
// ---------------------------------------------------------------------------

export interface GraphNodeData {
  id: number;
  name: string;
  /**
   * Graph-qualified name. The webview addresses a node by its numeric id, but the
   * graph does not — every lookup below goes back through the qualified name.
   */
  qualifiedName: string;
  label: string;
  filePath: string;
  signature?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

export interface GraphEdgeData {
  sourceId: number;
  targetId: number;
  type: string;
}

export interface GraphData {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

// ---------------------------------------------------------------------------
// Node Color Mapping — consistent across all visualizations
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<string, string> = {
  // Structural
  Project: '#c586c0',
  Package: '#c586c0',
  Folder: '#c586c0',
  File: '#c586c0',
  Module: '#c586c0',
  // Type definitions
  Class: '#4ec9b0',
  Interface: '#9cdcfe',
  Enum: '#ce9178',
  TypeAlias: '#ce9178',
  Struct: '#ce9178',
  Trait: '#ce9178',
  // Callables
  Function: '#569cd6',
  Method: '#dcdcaa',
  Constructor: '#dcdcaa',
  // Members
  Property: '#dcdcaa',
  Variable: '#6a9955',
  // Application
  Route: '#d16969',
  Tool: '#d16969',
  Component: '#d16969',
  // Analysis
  Test: '#4fc1ff',
  Community: '#b5cea8',
  Process: '#b5cea8',
  // Infrastructure
  Config: '#808080',
  ADR: '#808080',
  BasicBlock: '#e0e0e0',
  InfraResource: '#e0e0e0',
  // Cross-repo
  CrossRepoFunction: '#c586c0',
  CrossRepoInterface: '#c586c0',
  CrossRepoModule: '#c586c0',
  // Security
  Contract: '#e2a23b',
  Event: '#e2a23b',
  DataSource: '#f44747',
  Sink: '#f44747',
};

// ---------------------------------------------------------------------------
// GraphExplorerLogic
// ---------------------------------------------------------------------------

export class GraphExplorerLogic {
  constructor(private engine: EngineBridge) {}

  /**
   * Get graph data (nodes and edges) for visualization.
   * If a rootSymbol is provided, traces call paths from that symbol.
   * Otherwise returns related symbols from the project.
   */
  async getGraphData(rootSymbol?: string): Promise<GraphData> {
    const projectId = this.engine.getProjectId();
    if (!projectId) {
      return { nodes: [], edges: [] };
    }

    if (rootSymbol) {
      return this.buildCallGraph(rootSymbol);
    }

    // Return a summary graph from related symbols
    return this.buildSummaryGraph();
  }

  /**
   * Get detailed information for a specific node.
   */
  async getNodeDetail(nodeId: number): Promise<SymbolDetailItem | undefined> {
    // The nodeId here corresponds to the position of the symbol in the summary
    // graph, which is the only graph getGraphData() returns without a root symbol.
    const projectId = this.engine.getProjectId();
    if (!projectId) return undefined;

    // Query all related symbols and find the one matching nodeId
    const allData = await this.getGraphData();
    const node = allData.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;

    // Through the qualified name: the graph does not resolve bare identifiers, so
    // passing `node.name` made every detail lookup report "symbol not found".
    return this.engine.getSymbolDetail(node.qualifiedName);
  }

  /**
   * Get the color for a node label.
   * Used by both the Canvas renderer and any other visualization.
   */
  getNodeColor(label: string): string {
    return NODE_COLORS[label] ?? '#808080';
  }

  /**
   * Get the complete node color mapping for all known labels.
   */
  getNodeColorMap(): Record<string, string> {
    return { ...NODE_COLORS };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async buildCallGraph(rootSymbol: string): Promise<GraphData> {
    const trace = await this.engine.traceCallPath(rootSymbol);
    const nodes: GraphNodeData[] = trace.map((t, i) => ({
      id: i + 1,
      name: t.name,
      qualifiedName: t.qualifiedName,
      label: 'Function',
      filePath: t.filePath,
    }));

    const edges: GraphEdgeData[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        sourceId: nodes[i]!.id,
        targetId: nodes[i + 1]!.id,
        type: EDGE_CALLS,
      });
    }

    return { nodes, edges };
  }

  private async buildSummaryGraph(): Promise<GraphData> {
    // Invariant: getGraphData() is the only caller and it already returns an empty
    // graph when the project id is unset, so there is nothing to re-validate here.
    //
    // The whole body reads from one source — the graph — so a single failure
    // boundary is enough. A per-symbol catch used to sit inside the edge loop, but
    // it could only ever fire when the graph itself had become unusable, which is
    // this handler's job; it degraded that case into a node list with silently
    // missing edges, which misstates the graph more than an empty one does.
    try {
      const results = await this.engine.listProjectSymbols();
      if (results.length === 0) return { nodes: [], edges: [] };

      const nodes: GraphNodeData[] = results.map((r, i) => ({
        id: i,
        name: r.name,
        qualifiedName: r.qualifiedName,
        // `label` is a required field of SymbolRefItem, so there is no
        // unlabelled-symbol case to fall back to.
        label: r.label,
        filePath: r.filePath,
      }));

      // Build edges by resolving callees
      const edges: GraphEdgeData[] = [];
      // Edges are indexed by the displayed bare name, because that is what
      // `findCallees` reports for the nodes it returns.
      const nodeIndex = new Map(results.map((r, i) => [r.name, i]));
      const maxSymbols = Math.min(results.length, 5);

      for (let i = 0; i < maxSymbols; i++) {
        // Invariant: the loop bound is the length of the array being read and
        // nothing in the body mutates it, so the slot is always populated.
        const sym = results[i]!;
        // `findCallees` resolves the symbol through the graph's qualified name.
        // This used to pass the bare identifier, which never resolves, so the
        // explorer's edge list was empty for every project.
        const callees = await this.engine.findCallees(sym.qualifiedName);
        for (const callee of callees) {
          const targetId = nodeIndex.get(callee.name);
          // A callee can live outside this project — a store handed to the bridge
          // may hold several indexed projects — and a node this view does not
          // draw cannot be an edge endpoint.
          if (targetId != null) {
            edges.push({
              sourceId: i,
              targetId,
              type: 'call',
            });
          }
        }
      }

      return { nodes, edges };
    } catch {
      return { nodes: [], edges: [] };
    }
  }
}
