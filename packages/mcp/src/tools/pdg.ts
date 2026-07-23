// @code-analyzer/mcp — PDG & Taint Analysis Tools
// Honest implementations — PDG construction requires CFG analysis

import type { ToolResult } from './registry.js';
import { ToolContextImpl } from './tool-context.js';

// ---------------------------------------------------------------------------
// pdg_query — Analyze program dependence graph (CFG-based)
// ---------------------------------------------------------------------------

interface PDGQueryParams {
  functionId: string;
  projectId: string;
  edgeType?: string;
}

export const pdgQuerySchema = {
  type: 'object',
  properties: {
    functionId: { type: 'string', description: 'Function identifier (qualified name)' },
    projectId: { type: 'string', description: 'Project ID' },
    edgeType: { type: 'string', description: 'Edge type filter', enum: ['CFG', 'DATA_FLOWS', 'REACHING_DEF', 'TAINTED', 'SANITIZES', 'TAINT_PATH'] },
  },
  required: ['functionId', 'projectId'],
};

export async function pdgQuery(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as PDGQueryParams;
  const functionId = params.functionId;
  const projectId = params.projectId;

  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];

  // Attempt basic graph traversal from the function node
  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const funcNode = gstore.getNodeByQualifiedName(functionId);

      if (funcNode) {
        nodes.push({
          id: funcNode.id,
          name: funcNode.name,
          label: funcNode.label,
          filePath: funcNode.filePath ?? '',
          startLine: funcNode.startLine ?? 0,
        });

        // Get CALLS edges as basic control flow approximation
        const callEdges = gstore.getEdgesForNode(funcNode.id, 'CALLS');
        for (const edge of callEdges) {
          const target = gstore.getNode(edge.targetId);
          if (target) {
            edges.push({
              sourceId: edge.sourceId,
              targetId: edge.targetId,
              type: 'CALLS',
              targetName: target.name,
            });
          }
        }
      }
    } catch {
      // Graceful degradation
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        functionId,
        projectId,
        nodes,
        edges,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        analysisType: 'basic-call-graph',
        note: 'Full PDG analysis with CFG/data-flow requires deeper AST analysis. Use trace_call_path or explore_symbol for graph-based call tracing.',
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// taint_analysis — Detect taint propagation paths
// ---------------------------------------------------------------------------

interface TaintAnalysisParams {
  projectId: string;
  sourceKind?: string;
  sinkKind?: string;
  filePath?: string;
}

export const taintAnalysisSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'string', description: 'Project ID' },
    sourceKind: { type: 'string', description: 'Taint source kind', enum: ['user-input', 'file-read', 'network', 'environment', 'database'] },
    sinkKind: { type: 'string', description: 'Taint sink kind', enum: ['file-write', 'sql-query', 'command-exec', 'html-render', 'network-send', 'eval'] },
    filePath: { type: 'string', description: 'Specific file to analyze' },
  },
  required: ['projectId'],
};

export async function taintAnalysis(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as TaintAnalysisParams;
  const projectId = params.projectId;
  const sourceKind = params.sourceKind;
  const sinkKind = params.sinkKind;
  const filePath = params.filePath;

  const taintPaths: Array<Record<string, unknown>> = [];
  let vulnerablePaths = 0;

  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const allNodes = gstore.getAllNodes();

      // Heuristic: find functions that match source patterns
      // and check if their call chains reach sink patterns
      const sourcePatterns = sourceKind
        ? [sourceKind]
        : ['user-input', 'file-read', 'network', 'environment', 'database'];

      const sinkPatterns = sinkKind
        ? [sinkKind]
        : ['file-write', 'sql-query', 'command-exec', 'html-render', 'network-send', 'eval'];

      for (const node of allNodes) {
        if (filePath && node.filePath !== filePath) continue;

        const name = node.name.toLowerCase();
        const fp = (node.filePath ?? '').toLowerCase();

        // Check for source-like patterns
        const isSource = sourcePatterns.some((p) =>
          name.includes(p) || fp.includes(p)
        );
        if (!isSource) continue;

        // Check if it calls anything that looks like a sink
        const callEdges = gstore.getEdgesForNode(node.id, 'CALLS');
        for (const edge of callEdges) {
          const target = gstore.getNode(edge.targetId);
          if (!target) continue;
          const tName = target.name.toLowerCase();
          const tFp = (target.filePath ?? '').toLowerCase();

          const isSink = sinkPatterns.some((p) =>
            tName.includes(p) || tFp.includes(p)
          );

          if (isSink) {
            taintPaths.push({
              source: { kind: sourceKind ?? 'detected', node: node.name, filePath: node.filePath ?? '' },
              sink: { kind: sinkKind ?? 'detected', node: target.name, filePath: target.filePath ?? '' },
              confidence: 'medium',
            });
            vulnerablePaths++;
          }
        }
      }
    } catch {
      // Graceful degradation
    }
  }

  const severity = vulnerablePaths > 5 ? 'high' : vulnerablePaths > 0 ? 'medium' : 'low';

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        projectId,
        sourceKind,
        sinkKind,
        filePath,
        taintPaths,
        vulnerablePaths,
        severity,
        analysisMethod: 'pattern-based-heuristic',
        note: 'Full taint analysis requires data-flow graph construction. Use security-focused review for comprehensive analysis.',
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// explain_taint — Explain a taint path in detail
// ---------------------------------------------------------------------------

interface ExplainTaintParams {
  taintPathId: string;
  projectId: string;
}

export const explainTaintSchema = {
  type: 'object',
  properties: {
    taintPathId: { type: 'string', description: 'Taint path identifier' },
    projectId: { type: 'string', description: 'Project ID' },
  },
  required: ['taintPathId', 'projectId'],
};

export async function explainTaint(args: Record<string, unknown>, store?: unknown): Promise<ToolResult> {
  const params = args as unknown as ExplainTaintParams;
  const taintPathId = params.taintPathId;
  const projectId = params.projectId;

  const explanation = {
    taintPathId,
    projectId,
    source: { kind: 'user-input', node: 'unknown', filePath: '', line: 0 },
    sink: { kind: 'command-exec', node: 'unknown', filePath: '', line: 0 },
    path: [] as Array<Record<string, unknown>>,
    isVulnerable: false,
    severity: 'low',
    remediation: 'No remediation available — taint path not fully analyzed',
    note: 'Taint path analysis requires program dependence graph construction. Run review_pr with security focus for vulnerability analysis.',
  };

  // Try to resolve the path from store if the ID references a known symbol
  if (store && ToolContextImpl.isToolContext(store)) {
    const ctx = store as ToolContextImpl;
    try {
      const gstore = ctx.store;
      const node = gstore.getNodeByQualifiedName(taintPathId);

      if (node) {
        explanation.source = {
          kind: 'detected',
          node: node.name,
          filePath: node.filePath ?? '',
          line: node.startLine ?? 0,
        };

        // Trace call path
        const bfsPath = gstore.bfs(node.id, {
          direction: 'outgoing',
          maxDepth: 5,
          edgeFilter: (e) => ['CALLS', 'IMPORTS'].includes(e.type),
        });

        explanation.path = bfsPath.map((p) => ({
          nodeId: p.nodeId,
          depth: p.depth,
        }));
      }
    } catch {
      // Graceful degradation
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(explanation, null, 2),
    }],
  };
}
