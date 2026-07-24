// @code-analyzer/vscode — Graph Explorer Provider
// Pure logic class for knowledge graph exploration in the sidebar.
// No VS Code dependency — all VS Code integration lives in extension.ts.

import type { EngineBridge, SymbolDetailItem } from '../services/engine-bridge.js';

// ---------------------------------------------------------------------------
// Graph Data Types
// ---------------------------------------------------------------------------

export interface GraphNodeData {
  id: number;
  name: string;
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
    // The nodeId here corresponds to store node IDs
    // We need a name to look up — use trace-based approach
    const projectId = this.engine.getProjectId();
    if (!projectId) return undefined;

    // Query all related symbols and find the one matching nodeId
    const allData = await this.getGraphData();
    const node = allData.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;

    return this.engine.getSymbolDetail(node.name);
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
      label: 'Function',
      filePath: t.filePath,
    }));

    const edges: GraphEdgeData[] = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      edges.push({
        sourceId: nodes[i].id,
        targetId: nodes[i + 1].id,
        type: 'CALLS',
      });
    }

    return { nodes, edges };
  }

  private async buildSummaryGraph(): Promise<GraphData> {
    const projectId = this.engine.getProjectId();
    if (!projectId) return { nodes: [], edges: [] };

    try {
      const results = await this.engine.search('');
      if (results.length === 0) return { nodes: [], edges: [] };

      const nodes: GraphNodeData[] = results.map((r, i) => ({
        id: i,
        name: r.name,
        label: r.label ?? r.name,
        filePath: r.filePath,
      }));

      // Build edges by resolving callers/callees
      const edges: GraphEdgeData[] = [];
      const nodeIndex = new Map(results.map((r, i) => [r.name, i]));
      const maxSymbols = Math.min(results.length, 5);

      for (let i = 0; i < maxSymbols; i++) {
        const sym = results[i];
        if (!sym) continue;
        try {
          const callees = await this.engine.findCallees(sym.name);
          for (const callee of callees) {
            const targetId = nodeIndex.get(callee.name);
            if (targetId != null) {
              edges.push({
                sourceId: i,
                targetId,
                type: 'call',
              });
            }
          }
        } catch {
          // Skip symbols that fail edge resolution
        }
      }

      return { nodes, edges };
    } catch {
      return { nodes: [], edges: [] };
    }
  }
}
