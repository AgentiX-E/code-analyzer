// @code-analyzer/mcp — Trend Analysis Tool
// Tracks code quality metrics from the knowledge graph: complexity distribution,
// dependency density, and structural health indicators.
//
// Honest limitation: trend analysis over time requires multiple snapshots.
// This tool analyzes the current graph state and provides structural metrics.

import type { McpToolDefinition, ToolResult } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';
import { EDGE_CALLS, EDGE_EXTENDS, EDGE_IMPLEMENTS, EDGE_IMPORTS } from '@code-analyzer/shared';
import { ToolContextImpl } from './tool-context.js';

export const trendAnalysisTool: McpToolDefinition = {
  name: 'trend_analysis',
  description:
    'Analyze code quality metrics from the knowledge graph — complexity distribution, dependency density, and structural health indicators.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      metric: {
        type: 'string',
        description: 'The metric to analyze: complexity, dependencies, structure, or health.',
        enum: ['complexity', 'dependencies', 'structure', 'health'],
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown): Promise<ToolResult> => {
    const { projectId, metric } = args;
    const metricKey = (metric as string) ?? 'health';
    const store = ToolContextImpl.getStore(storeOrContext);

    if (!store) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
      };
    }

    const projectIdStr = projectId as string;
    const nodes = store.getAllNodes().filter((n) => n.projectId === projectIdStr);

    if (nodes.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No data found for project "${projectIdStr}". Index the project first.`,
          },
        ],
        metadata: { projectId: projectIdStr, metric: metricKey },
      };
    }

    const report = generateMetricReport(store, projectIdStr, metricKey, nodes);

    return {
      content: [{ type: 'text', text: report }],
      metadata: { projectId: projectIdStr, metric: metricKey, nodeCount: nodes.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComplexityBucket {
  range: string;
  count: number;
  percentage: number;
}

interface DependencyMetric {
  label: string;
  inbound: number;
  outbound: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Metric dispatch
// ---------------------------------------------------------------------------

function generateMetricReport(
  store: InMemoryGraphStore,
  projectId: string,
  metric: string,
  nodes: GraphNode[],
): string {
  switch (metric) {
    case 'complexity':
      return complexityReport(store, projectId, nodes);
    case 'dependencies':
      return dependencyReport(store, projectId, nodes);
    case 'structure':
      return structureReport(projectId, nodes);
    case 'health':
      return healthReport(store, projectId, nodes);
    default:
      return `Unknown metric: ${metric}`;
  }
}

// ---------------------------------------------------------------------------
// Complexity report
// ---------------------------------------------------------------------------

function complexityReport(
  store: InMemoryGraphStore,
  projectId: string,
  nodes: GraphNode[],
): string {
  const complexityScores: Array<{ name: string; filePath: string; score: number }> = [];

  for (const node of nodes) {
    const outgoing = store.getEdgesForNode(node.id, EDGE_CALLS, 'out').length;
    const incoming = store.getEdgesForNode(node.id, EDGE_CALLS, 'in').length;
    const extendsEdges = store.getEdgesForNode(node.id, EDGE_EXTENDS, 'out').length;
    const implementsEdges = store.getEdgesForNode(node.id, EDGE_IMPLEMENTS, 'out').length;
    const score = outgoing + incoming + extendsEdges * 3 + implementsEdges * 2;

    if (score > 0) {
      complexityScores.push({ name: node.name, filePath: node.filePath ?? '<unknown>', score });
    }
  }

  complexityScores.sort((a, b) => b.score - a.score);

  // Distribution buckets
  const buckets: ComplexityBucket[] = [
    { range: '1–5', count: 0, percentage: 0 },
    { range: '6–10', count: 0, percentage: 0 },
    { range: '11–20', count: 0, percentage: 0 },
    { range: '21–50', count: 0, percentage: 0 },
    { range: '50+', count: 0, percentage: 0 },
  ];

  for (const item of complexityScores) {
    if (item.score <= 5) buckets[0]!.count++;
    else if (item.score <= 10) buckets[1]!.count++;
    else if (item.score <= 20) buckets[2]!.count++;
    else if (item.score <= 50) buckets[3]!.count++;
    else buckets[4]!.count++;
  }

  const total = complexityScores.length || 1;
  for (const b of buckets) {
    b.percentage = Math.round((b.count / total) * 100);
  }

  const scores = complexityScores.map((c) => c.score);
  const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const maxVal = scores.length > 0 ? Math.max(...scores) : 0;
  const minVal = scores.length > 0 ? Math.min(...scores) : 0;

  let report = `## Complexity Analysis — ${projectId}\n\n`;
  report += `**Statistics**: ${complexityScores.length} structural nodes | Avg: ${avg} | Min: ${minVal} | Max: ${maxVal}\n\n`;

  report += '### Distribution\n\n';
  report += '| Range | Count | % |\n';
  report += '|-------|-------|----|\n';
  for (const b of buckets) {
    const bar = '█'.repeat(Math.min(Math.round(b.percentage / 5), 20));
    report += `| ${b.range} | ${b.count} | ${b.percentage}% ${bar} |\n`;
  }

  report += '\n### Top 10 Most Complex Symbols\n\n';
  report += '| Score | File | Symbol |\n';
  report += '|-------|------|--------|\n';
  for (const item of complexityScores.slice(0, 10)) {
    report += `| ${item.score} | \`${item.filePath}\` | ${item.name} |\n`;
  }

  if (avg > 15) {
    report += '\n### Recommendations\n';
    report +=
      '- Average complexity is high (>15). Consider refactoring the most complex symbols.\n';
  }

  report += '\n> Complexity = outgoing CALLS + incoming CALLS + 3× EXTENDS + 2× IMPLEMENTS.\n';
  report += '> For time-series trend analysis, re-run this tool after subsequent code changes.\n';

  return report;
}

// ---------------------------------------------------------------------------
// Dependency report
// ---------------------------------------------------------------------------

function dependencyReport(
  store: InMemoryGraphStore,
  projectId: string,
  nodes: GraphNode[],
): string {
  const fileMap = new Map<string, DependencyMetric>();

  for (const node of nodes) {
    if (!node.filePath) continue;
    const filePath = node.filePath;

    let metric = fileMap.get(filePath);
    if (!metric) {
      metric = { label: filePath, inbound: 0, outbound: 0, total: 0 };
      fileMap.set(filePath, metric);
    }

    metric.outbound += store.getEdgesForNode(node.id, EDGE_IMPORTS, 'out').length;
    metric.outbound += store.getEdgesForNode(node.id, EDGE_CALLS, 'out').length;
    metric.inbound += store.getEdgesForNode(node.id, EDGE_IMPORTS, 'in').length;
    metric.inbound += store.getEdgesForNode(node.id, EDGE_CALLS, 'in').length;
    metric.total = metric.inbound + metric.outbound;
  }

  const sorted = Array.from(fileMap.values())
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total);

  let report = `## Dependency Analysis — ${projectId}\n\n`;
  report += `**Files with dependencies**: ${sorted.length}\n\n`;

  report += '| Total | Inbound | Outbound | File |\n';
  report += '|-------|---------|----------|------|\n';
  for (const m of sorted.slice(0, 20)) {
    report += `| ${m.total} | ${m.inbound} | ${m.outbound} | \`${m.label}\` |\n`;
  }

  return report;
}

// ---------------------------------------------------------------------------
// Structure report
// ---------------------------------------------------------------------------

function structureReport(projectId: string, nodes: GraphNode[]): string {
  const labelCounts = new Map<string, number>();
  for (const node of nodes) {
    labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1);
  }

  const sorted = Array.from(labelCounts.entries()).sort((a, b) => b[1] - a[1]);

  const total = nodes.length;

  let report = `## Structure Analysis — ${projectId}\n\n`;
  report += `**Total nodes**: ${total} | **Node types**: ${sorted.length}\n\n`;

  report += '| Type | Count | % |\n';
  report += '|------|-------|----|\n';
  for (const [label, count] of sorted.slice(0, 15)) {
    report += `| ${label} | ${count} | ${Math.round((count / total) * 100)}% |\n`;
  }

  if (sorted.length > 15) {
    const remaining = sorted.slice(15).reduce((s, [, c]) => s + c, 0);
    report += `| ... (${sorted.length - 15} more types) | ${remaining} | — |\n`;
  }

  return report;
}

// ---------------------------------------------------------------------------
// Health report
// ---------------------------------------------------------------------------

function healthReport(store: InMemoryGraphStore, projectId: string, nodes: GraphNode[]): string {
  const edges = store.getAllEdges().filter((e) => e.projectId === projectId);
  const fileNodes = nodes.filter((n) => n.label === 'File');
  const funcNodes = nodes.filter((n) => n.label === 'Function' || n.label === 'Method');
  const isolatedNodes = nodes.filter(
    (n) =>
      store.getEdgesForNode(n.id).length === 0 &&
      n.label !== 'File' &&
      n.label !== 'Folder' &&
      n.label !== 'Project',
  );

  const density =
    nodes.length > 1
      ? Math.round((edges.length / (nodes.length * (nodes.length - 1))) * 10000) / 100
      : 0;

  let report = `## Health Report — ${projectId}\n\n`;

  report += '### Key Metrics\n\n';
  report += '| Metric | Value | Assessment |\n';
  report += '|--------|-------|------------|\n';
  report += `| Total Nodes | ${nodes.length} | — |\n`;
  report += `| Total Edges | ${edges.length} | — |\n`;
  report += `| Graph Density | ${density}% | ${density < 1 ? '🟢 Healthy' : density < 5 ? '🟡 Moderate' : '🔴 Dense'} |\n`;
  report += `| Files | ${fileNodes.length} | — |\n`;
  report += `| Functions/Methods | ${funcNodes.length} | — |\n`;
  const isolatedPct =
    nodes.length > 0 ? Math.round((isolatedNodes.length / nodes.length) * 100) : 0;
  report += `| Isolated Nodes | ${isolatedNodes.length} (${isolatedPct}%) | ${isolatedPct < 5 ? '🟢 Healthy' : isolatedPct < 20 ? '🟡 Moderate' : '🔴 High'} |\n`;

  const edgeTypes = new Map<string, number>();
  for (const e of edges) {
    edgeTypes.set(e.type, (edgeTypes.get(e.type) ?? 0) + 1);
  }

  report += '\n### Edge Type Distribution\n\n';
  report += '| Type | Count |\n';
  report += '|------|-------|\n';
  for (const [type, count] of Array.from(edgeTypes.entries()).sort((a, b) => b[1] - a[1])) {
    report += `| ${type} | ${count} |\n`;
  }

  if (isolatedNodes.length > 0) {
    report += `\n### Orphaned Symbols (${isolatedNodes.length})\n\n`;
    for (const node of isolatedNodes.slice(0, 10)) {
      report += `- \`${node.filePath ?? '?'}\` — ${node.name} (${node.label})\n`;
    }
    if (isolatedNodes.length > 10) {
      report += `- ... and ${isolatedNodes.length - 10} more\n`;
    }
  }

  return report;
}

export default trendAnalysisTool;
