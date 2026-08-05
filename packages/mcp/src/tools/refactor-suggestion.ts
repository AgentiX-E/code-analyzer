// @code-analyzer/mcp — Refactor Suggestion Tool
// Analyzes the knowledge graph to identify refactoring opportunities:
// high-complexity functions, god classes, long parameter lists,
// and symbols with excessive dependencies.

import type { McpToolDefinition, ToolResult } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphNode } from '@code-analyzer/shared';
import { ToolContextImpl } from './tool-context.js';

export const refactorSuggestionTool: McpToolDefinition = {
  name: 'refactor_suggestion',
  description:
    'Analyze the codebase and suggest refactoring opportunities — extract method, split class, reduce parameters, reduce coupling.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      filePath: {
        type: 'string',
        description: 'Optional: limit suggestions to a specific file.',
      },
      symbolName: {
        type: 'string',
        description: 'Optional: limit suggestions to a specific symbol.',
      },
      maxSuggestions: {
        type: 'number',
        description: 'Maximum number of suggestions to return (default: 10).',
        default: 10,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown): Promise<ToolResult> => {
    const { projectId, filePath, symbolName, maxSuggestions } = args;
    const max = (maxSuggestions as number) ?? 10;
    const store = ToolContextImpl.getStore(storeOrContext);

    if (!store) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
      };
    }

    const projectIdStr = projectId as string;
    let nodes = store.getAllNodes().filter((n) => n.projectId === projectIdStr);

    if (filePath) {
      nodes = nodes.filter((n) => n.filePath === (filePath as string));
    }
    if (symbolName) {
      nodes = nodes.filter((n) => n.name === (symbolName as string));
    }

    if (nodes.length === 0) {
      return {
        content: [{ type: 'text', text: `No symbols found for project "${projectIdStr}". Index the project first.` }],
        metadata: { projectId: projectIdStr },
      };
    }

    const suggestions = generateSuggestions(store, nodes, max);

    return {
      content: [{ type: 'text', text: formatSuggestions(suggestions, projectIdStr) }],
      metadata: { projectId: projectIdStr, suggestionCount: suggestions.length },
    };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefactorSuggestion {
  type: 'extract-method' | 'split-class' | 'reduce-params' | 'reduce-coupling' | 'inline-symbol';
  title: string;
  description: string;
  filePath: string;
  symbolName: string;
  severity: 'high' | 'medium' | 'low';
  metrics: {
    callCount: number;
    dependencyCount: number;
    paramCount?: number;
  };
}

// ---------------------------------------------------------------------------
// Suggestion generation from real graph data
// ---------------------------------------------------------------------------

function generateSuggestions(
  store: InMemoryGraphStore,
  nodes: GraphNode[],
  maxResults: number,
): RefactorSuggestion[] {
  const suggestions: RefactorSuggestion[] = [];

  for (const node of nodes) {
    const outgoingCalls = store.getEdgesForNode(node.id, 'CALLS', 'out').length;
    const incomingCalls = store.getEdgesForNode(node.id, 'CALLS', 'in').length;
    const extendsEdges = store.getEdgesForNode(node.id, 'EXTENDS', 'out').length;
    const implementsEdges = store.getEdgesForNode(node.id, 'IMPLEMENTS', 'out').length;
    const dependencyEdges = outgoingCalls + extendsEdges + implementsEdges;

    // Extract method: function/method with high outgoing call count
    if (isFunctionNode(node.label) && outgoingCalls > 10) {
      suggestions.push({
        type: 'extract-method',
        title: `Extract Method from "${node.name}"`,
        description: `This ${node.label.toLowerCase()} has ${outgoingCalls} outgoing calls and may be doing too much. Consider extracting cohesive sub-operations into separate functions.`,
        filePath: node.filePath ?? '<unknown>',
        symbolName: node.name,
        severity: outgoingCalls > 20 ? 'high' : 'medium',
        metrics: { callCount: outgoingCalls, dependencyCount: dependencyEdges },
      });
    }

    // Split class: class with too many outgoing edges
    if ((node.label === 'Class' || node.label === 'Component') && dependencyEdges > 15) {
      suggestions.push({
        type: 'split-class',
        title: `Split Class "${node.name}"`,
        description: `This ${node.label.toLowerCase()} has ${dependencyEdges} dependencies across ${outgoingCalls} calls, ${extendsEdges} extensions, and ${implementsEdges} implementations. Consider splitting into smaller, focused classes.`,
        filePath: node.filePath ?? '<unknown>',
        symbolName: node.name,
        severity: dependencyEdges > 25 ? 'high' : 'medium',
        metrics: { callCount: outgoingCalls, dependencyCount: dependencyEdges },
      });
    }

    // Reduce coupling: function/method with high incoming call count
    const isMethodOrFunc = node.label === 'Method' || node.label === 'Function';
    if (isMethodOrFunc && incomingCalls > 15) {
      suggestions.push({
        type: 'reduce-coupling',
        title: `Reduce Coupling for "${node.name}"`,
        description: `This ${node.label.toLowerCase()} is called by ${incomingCalls} other symbols. High fan-in may indicate tight coupling. Consider introducing an interface or abstraction layer.`,
        filePath: node.filePath ?? '<unknown>',
        symbolName: node.name,
        severity: incomingCalls > 30 ? 'high' : 'medium',
        metrics: { callCount: incomingCalls, dependencyCount: dependencyEdges },
      });
    }
  }

  // Sort by severity (high first), then by dependency count
  suggestions.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const sevDiff = (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;
    return b.metrics.dependencyCount - a.metrics.dependencyCount;
  });

  return suggestions.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFunctionNode(label: string): boolean {
  return label === 'Function' || label === 'Method';
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatSuggestions(suggestions: RefactorSuggestion[], projectId: string): string {
  if (suggestions.length === 0) {
    return `## Refactor Suggestions — ${projectId}\n\n` +
      'No refactoring opportunities detected. The codebase appears to be well-structured based on graph metrics.\n\n' +
      '> Note: Suggestions are based on knowledge graph edge analysis. Run a full analysis pipeline for more data.\n';
  }

  const highCount = suggestions.filter((s) => s.severity === 'high').length;
  const mediumCount = suggestions.filter((s) => s.severity === 'medium').length;

  let report = `## Refactor Suggestions — ${projectId}\n\n`;
  report += `**Summary**: ${suggestions.length} suggestions (${highCount} high priority, ${mediumCount} medium priority)\n\n`;

  for (const s of suggestions) {
    const icon = s.severity === 'high' ? '🔴' : s.severity === 'medium' ? '🟡' : '🟢';
    report += `### ${icon} ${s.title}\n\n`;
    report += `- **Type**: ${s.type}\n`;
    report += `- **File**: \`${s.filePath}\`\n`;
    report += `- **Severity**: ${s.severity}\n`;
    report += `- **Calls**: ${s.metrics.callCount} | **Dependencies**: ${s.metrics.dependencyCount}\n`;
    report += `- **Rationale**: ${s.description}\n\n`;
  }

  report += '\n> Suggestions are derived from knowledge graph structural metrics.\n';
  report += '> Review each suggestion against actual code before applying.\n';

  return report;
}

export default refactorSuggestionTool;
