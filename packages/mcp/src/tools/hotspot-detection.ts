// @code-analyzer/mcp — Hotspot Detection Tool
// Identifies files and functions with high structural complexity —
// the combination most correlated with defect density.
// Complexity is measured by edge degree in the knowledge graph.

import type { McpToolDefinition } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from './tool-context.js';
import { EDGE_CALLS, EDGE_EXTENDS, EDGE_IMPLEMENTS } from '@code-analyzer/shared';

export const hotspotDetectionTool: McpToolDefinition = {
  name: 'hotspot_detection',
  description:
    'Identify code hotspots — files/functions with high structural complexity (edge degree) that are most likely to contain bugs.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      threshold: {
        type: 'number',
        description: 'Complexity threshold for hotspot classification (default: 10).',
        default: 10,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of hotspots to return (default: 20).',
        default: 20,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown) => {
    const { projectId, threshold, maxResults } = args;
    const thresh = (threshold as number) ?? 10;
    const max = (maxResults as number) ?? 20;
    const store = ToolContextImpl.getStore(storeOrContext);

    if (!store) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
        metadata: { projectId },
      };
    }

    const hotspots = generateHotspots(store, projectId as string, thresh, max);

    return {
      content: [
        {
          type: 'text',
          text: hotspotReport(hotspots, projectId as string),
        },
      ],
      metadata: { projectId, hotspotCount: hotspots.length, threshold: thresh },
    };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hotspot {
  filePath: string;
  symbolName: string;
  complexity: number;
  incomingCalls: number;
  outgoingCalls: number;
  riskLevel: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Hotspot generation from real graph data
// ---------------------------------------------------------------------------

function generateHotspots(
  store: InMemoryGraphStore,
  projectId: string,
  threshold: number,
  maxResults: number,
): Hotspot[] {
  const nodes = store.getAllNodes().filter((n) => n.projectId === projectId);

  if (nodes.length === 0) {
    return [];
  }

  const hotspots: Hotspot[] = [];

  for (const node of nodes) {
    // Only analyze function/method/class nodes — structural types carry complexity
    if (!isStructuralNode(node.label)) continue;

    const incoming = store.getEdgesForNode(node.id, EDGE_CALLS, 'in').length;
    const outgoing = store.getEdgesForNode(node.id, EDGE_CALLS, 'out').length;
    const extendsEdges = store.getEdgesForNode(node.id, EDGE_EXTENDS, 'out').length;
    const implementsEdges = store.getEdgesForNode(node.id, EDGE_IMPLEMENTS, 'out').length;

    // Complexity = weighted edge count (outgoing IMPLEMENTS/EXTENDS count more)
    const complexity = outgoing + incoming + extendsEdges * 3 + implementsEdges * 2;

    if (complexity >= threshold) {
      const riskLevel: Hotspot['riskLevel'] =
        complexity >= 30 ? 'high' : complexity >= 15 ? 'medium' : 'low';

      hotspots.push({
        filePath: node.filePath ?? '<unknown>',
        symbolName: node.name,
        complexity,
        incomingCalls: incoming,
        outgoingCalls: outgoing,
        riskLevel,
      });
    }
  }

  // Sort by complexity descending
  hotspots.sort((a, b) => b.complexity - a.complexity);

  return hotspots.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function isStructuralNode(label: string): boolean {
  const structuralLabels = new Set([
    'Function', 'Method', 'Class', 'Interface', 'Module',
    'Component', 'Service', 'Controller', 'Handler',
    'Route', 'Endpoint', 'Resolver',
  ]);
  return structuralLabels.has(label);
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function hotspotReport(hotspots: Hotspot[], projectId: string): string {
  if (hotspots.length === 0) {
    return `## Hotspot Analysis — ${projectId}\n\n` +
      'No hotspots detected. The codebase appears to have low structural complexity.\n\n' +
      '> Note: This analysis is based on the knowledge graph edge degree.\n' +
      '> Run a full analysis pipeline to populate the graph with more data.\n';
  }

  const highCount = hotspots.filter((h) => h.riskLevel === 'high').length;
  const mediumCount = hotspots.filter((h) => h.riskLevel === 'medium').length;
  const lowCount = hotspots.filter((h) => h.riskLevel === 'low').length;

  let report = `## Hotspot Analysis — ${projectId}\n\n`;
  report += `**Summary**: ${hotspots.length} hotspots detected `;
  report += `(${highCount} high, ${mediumCount} medium, ${lowCount} low risk)\n\n`;

  report += '| Risk | Complexity | In Calls | Out Calls | File | Symbol |\n';
  report += '|------|-----------|----------|-----------|------|--------|\n';

  for (const h of hotspots) {
    const riskIcon = h.riskLevel === 'high' ? '🔴' : h.riskLevel === 'medium' ? '🟡' : '🟢';
    report += `| ${riskIcon} ${h.riskLevel} | ${h.complexity} | ${h.incomingCalls} | ${h.outgoingCalls} | \`${h.filePath}\` | ${h.symbolName} |\n`;
  }

  report += '\n### Recommendations\n';
  if (highCount > 0) {
    report += `- **${highCount} high-risk hotspots**: Add comprehensive unit and integration tests. Consider splitting into smaller modules.\n`;
  }
  if (mediumCount > 0) {
    report += `- **${mediumCount} medium-risk areas**: Review for potential refactoring opportunities.\n`;
  }
  if (lowCount > 0) {
    report += `- **${lowCount} low-risk symbols**: Monitor for increasing complexity trends.\n`;
  }
  report += '\n> Complexity is measured as weighted edge degree in the knowledge graph (outgoing CALLS + incoming CALLS + 3× EXTENDS + 2× IMPLEMENTS).\n';

  return report;
}

export default hotspotDetectionTool;