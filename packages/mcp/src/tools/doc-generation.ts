// @code-analyzer/mcp — Documentation Generation Tool
// Analyzes symbols in the knowledge graph and generates documentation
// skeletons (JSDoc, docstring, Go doc) based on symbol metadata and
// usage patterns detected through graph edges.

import type { McpToolDefinition, ToolResult } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import { ToolContextImpl } from './tool-context.js';

export const docGenerationTool: McpToolDefinition = {
  name: 'doc_generation',
  description:
    'Generate documentation skeletons for symbols based on knowledge graph analysis — includes parameter placeholders and usage-based descriptions.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'The project ID to analyze.',
      },
      filePath: {
        type: 'string',
        description: 'Optional: generate docs for symbols in a specific file.',
      },
      symbolName: {
        type: 'string',
        description: 'Optional: generate docs for a specific symbol (by name).',
      },
      style: {
        type: 'string',
        description: 'Documentation style: jsdoc, docstring, or godoc.',
        enum: ['jsdoc', 'docstring', 'godoc'],
        default: 'jsdoc',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of doc skeletons to generate (default: 10).',
        default: 10,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown): Promise<ToolResult> => {
    const { projectId, filePath, symbolName, style, maxResults } = args;
    const max = (maxResults as number) ?? 10;
    const styleStr = (style as string) ?? 'jsdoc';
    const store = ToolContextImpl.getStore(storeOrContext);

    if (!store) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
      };
    }

    const projectIdStr = projectId as string;
    let nodes = store.getAllNodes().filter(
      (n) => n.projectId === projectIdStr && isDocumentableNode(n.label),
    );

    if (symbolName) {
      nodes = nodes.filter((n) => n.name === (symbolName as string));
    }
    if (filePath) {
      nodes = nodes.filter((n) => n.filePath === (filePath as string));
    }

    if (nodes.length === 0) {
      return {
        content: [{ type: 'text', text: `No documentable symbols found for project "${projectIdStr}". Index the project first.` }],
        metadata: { projectId: projectIdStr },
      };
    }

    const docs = generateDocSkeletons(store, nodes.slice(0, max), styleStr);

    return {
      content: [{ type: 'text', text: formatDocs(docs, projectIdStr, styleStr) }],
      metadata: { projectId: projectIdStr, docCount: docs.length, style: styleStr },
    };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocSkeleton {
  symbolName: string;
  filePath: string;
  label: string;
  language: string;
  outgoingCalls: number;
  incomingCalls: number;
  dependencies: string[];
  docBlock: string;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

function isDocumentableNode(label: string): boolean {
  const docLabels = new Set([
    'Function', 'Method', 'Class', 'Interface', 'Component',
    'Service', 'Module', 'Type', 'Enum',
  ]);
  return docLabels.has(label);
}

// ---------------------------------------------------------------------------
// Doc skeleton generation from real graph data
// ---------------------------------------------------------------------------

function generateDocSkeletons(
  store: InMemoryGraphStore,
  nodes: import('@code-analyzer/shared').GraphNode[],
  style: string,
): DocSkeleton[] {
  const docs: DocSkeleton[] = [];

  for (const node of nodes) {
    const ext = node.filePath ? node.filePath.split('.').pop()?.toLowerCase() : '';
    const language = ext === 'ts' || ext === 'tsx' ? 'typescript'
      : ext === 'js' || ext === 'jsx' ? 'javascript'
      : ext === 'py' ? 'python'
      : ext === 'go' ? 'go'
      : ext === 'java' || ext === 'kt' ? 'java'
      : 'typescript';

    const outgoingCalls = store.getEdgesForNode(node.id, 'CALLS', 'out').length;
    const incomingCalls = store.getEdgesForNode(node.id, 'CALLS', 'in').length;

    // Get dependency names for usage description
    const callEdges = store.getEdgesForNode(node.id, 'CALLS', 'out');
    const dependencies: string[] = [];
    for (const edge of callEdges.slice(0, 5)) {
      const targetNode = store.getNode(edge.targetId);
      if (targetNode && targetNode.name !== node.name) {
        dependencies.push(targetNode.name);
      }
    }

    const docBlock = generateDocBlock(
      node.name,
      node.label,
      language,
      style,
      outgoingCalls,
      incomingCalls,
      dependencies,
    );

    docs.push({
      symbolName: node.name,
      filePath: node.filePath ?? '<unknown>',
      label: node.label,
      language,
      outgoingCalls,
      incomingCalls,
      dependencies,
      docBlock,
    });
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Doc block generation per style
// ---------------------------------------------------------------------------

function generateDocBlock(
  name: string,
  label: string,
  language: string,
  style: string,
  outgoingCalls: number,
  incomingCalls: number,
  dependencies: string[],
): string {
  if (style === 'godoc' || language === 'go') {
    return generateGoDoc(name, label, outgoingCalls, incomingCalls, dependencies);
  }
  if (style === 'docstring' || language === 'python') {
    return generatePythonDoc(name, label, outgoingCalls, incomingCalls, dependencies);
  }
  return generateJSDoc(name, label, outgoingCalls, incomingCalls, dependencies);
}

function generateJSDoc(
  name: string,
  label: string,
  outgoingCalls: number,
  incomingCalls: number,
  dependencies: string[],
): string {
  const lines: string[] = [];
  lines.push('/**');
  lines.push(` * ${label}: ${name}`);
  lines.push(' *');
  lines.push(' * TODO: Describe what this function/class does.');

  if (label === 'Function' || label === 'Method') {
    lines.push(' *');
    lines.push(' * @param {*} paramName — TODO: document parameter');
    lines.push(' * @returns {*} — TODO: document return value');
  }

  if (dependencies.length > 0) {
    lines.push(' *');
    lines.push(' * @usage');
    for (const dep of dependencies.slice(0, 3)) {
      lines.push(` * - Calls: \`${dep}\``);
    }
  }

  if (outgoingCalls > 0 || incomingCalls > 0) {
    lines.push(' *');
    lines.push(` * @graph {number} outgoingCalls — ${outgoingCalls}`);
    lines.push(` * @graph {number} incomingCalls — ${incomingCalls}`);
  }

  if (label === 'Class' || label === 'Component') {
    lines.push(' *');
    lines.push(' * @example');
    lines.push(' * ```');
    lines.push(` * const instance = new ${name}(/* TODO */);`);
    lines.push(' * ```');
  }

  lines.push(' */');
  return lines.join('\n');
}

function generatePythonDoc(
  name: string,
  label: string,
  outgoingCalls: number,
  incomingCalls: number,
  dependencies: string[],
): string {
  const lines: string[] = [];
  lines.push(`"""${label}: ${name}`);

  if (label === 'Function' || label === 'Method') {
    lines.push('');
    lines.push('Args:');
    lines.push('    param_name: TODO — describe parameter');
    lines.push('');
    lines.push('Returns:');
    lines.push('    TODO — describe return value');
  }

  if (dependencies.length > 0) {
    lines.push('');
    lines.push('Usage:');
    for (const dep of dependencies.slice(0, 3)) {
      lines.push(`    Calls: ${dep}`);
    }
  }

  if (outgoingCalls > 0 || incomingCalls > 0) {
    lines.push('');
    lines.push(`Graph: outgoing=${outgoingCalls}, incoming=${incomingCalls}`);
  }

  lines.push('"""');
  return lines.join('\n');
}

function generateGoDoc(
  name: string,
  label: string,
  outgoingCalls: number,
  incomingCalls: number,
  dependencies: string[],
): string {
  const lines: string[] = [];
  lines.push(`// ${name} is a ${label.toLowerCase()} that TODO: describe purpose.`);

  if (dependencies.length > 0) {
    lines.push(`//`);
    lines.push(`// It interacts with: ${dependencies.slice(0, 3).join(', ')}.`);
  }

  if (outgoingCalls > 0) {
    lines.push(`// Calls ${outgoingCalls} other function(s).`);
  }
  if (incomingCalls > 0) {
    lines.push(`// Called by ${incomingCalls} other function(s).`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

function formatDocs(docs: DocSkeleton[], projectId: string, style: string): string {
  if (docs.length === 0) {
    return `## Documentation Generation — ${projectId}\n\nNo documentable symbols found.\n`;
  }

  let report = `## Documentation Generation — ${projectId}\n\n`;
  report += `**Style**: ${style} | **Templates**: ${docs.length}\n\n`;
  report += `> Doc skeletons generated from knowledge graph metadata.\n`;
  report += `> TODO markers indicate where context-specific descriptions are needed.\n\n`;

  for (const doc of docs) {
    const callInfo = `out=${doc.outgoingCalls} calls, in=${doc.incomingCalls} calls`;
    report += `### \`${doc.symbolName}\` — ${doc.label} (${doc.language}, ${callInfo})\n\n`;
    report += `**File**: \`${doc.filePath}\`\n\n`;

    const lang = doc.language === 'typescript' ? 'typescript'
      : doc.language === 'python' ? 'python'
      : 'go';

    report += '```' + lang + '\n';
    report += doc.docBlock;
    report += '\n```\n\n';
  }

  return report;
}

export default docGenerationTool;
