// @code-analyzer/mcp — Dead Code Detection Tool
//
// **Story 10 of the product's user stories, and the one row of the feature table that was competitor-only.** Everything
// the answer needs already existed — a call graph measured at 96–98 % precision, a class chain, a route table — and no
// tool asked it, so a user who wanted to know what was dead had to install a competitor.
//
// **The question is asked as reachability, not as an edge count.** "Does anything call this" answers with nine tenths of
// a library: on `pallets/flask@3.0.3` it names 979 of 1 109 functions. What separates a finding from a false alarm is
// whether a path exists from something that can actually run, and which of the two surfaces — the executed one or the
// published one — would have reached it.

import { computeReachability } from '@code-analyzer/intelligence';

import { ToolContextImpl } from './tool-context.js';

import type { McpToolDefinition } from './registry.js';
import type { InMemoryGraphStore } from '@code-analyzer/infra';
import type { GraphEdge, GraphNode, KnowledgeGraph } from '@code-analyzer/shared';

/**
 * The store's contents in the shape the reachability pass reads.
 *
 * **The store is the graph for every other tool**, and the pass wants four fields: nodes, edges and the two indices that
 * answer "which node is this file" and "which node is this qualified name". Building them here rather than teaching the
 * pass about the store keeps the analysis a pure function of a graph, which is what makes it testable with a graph
 * literal — the twenty-three cases beside it construct nothing else.
 */
export function graphOf(store: InMemoryGraphStore, projectId: string): KnowledgeGraph {
  const nodes = new Map<number, GraphNode>();
  const edges = new Map<number, GraphEdge>();
  for (const node of store.nodes.values()) {
    if (node.projectId !== projectId) continue;
    nodes.set(node.id, node);
  }
  for (const edge of store.edges.values()) {
    if (edge.projectId !== projectId) continue;
    edges.set(edge.id, edge);
  }
  return { projectId, nodes, edges, qnameIndex: store.qnameIndex, fileIndex: store.fileIndex };
}

export interface DeadCodeArguments {
  readonly projectId?: unknown;
  readonly includePublished?: unknown;
  readonly includeTests?: unknown;
  readonly entryPoints?: unknown;
  readonly ignoreNames?: unknown;
  readonly filePattern?: unknown;
  readonly maxResults?: unknown;
}

const MAX_DEFAULT = 50;

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** The report as a reader reads it: what is dead, what is only public, and the rule behind each line. */
export function formatDeadCodeReport(graph: KnowledgeGraph, args: DeadCodeArguments): string {
  const maxResults = typeof args.maxResults === 'number' ? args.maxResults : MAX_DEFAULT;
  const report = computeReachability(graph, {
    entryPoints: stringsOf(args.entryPoints),
    ignoreNames: stringsOf(args.ignoreNames),
    ...(args.includeTests === true ? {} : { includeTests: false }),
  });

  if (report.callEdges === 0 && report.roots.length === 0) {
    return [
      'No use edges in this graph, so the question cannot be answered.',
      '',
      'A dead-code report over a graph without calls or references would name every symbol, which is a statement',
      'about the index rather than about the code. Re-index the project and ask again.',
    ].join('\n');
  }

  const pattern =
    typeof args.filePattern === 'string' && args.filePattern.length > 0 ? args.filePattern : null;
  const matches = (filePath: string): boolean =>
    pattern === null ? true : filePath.includes(pattern);

  const dead = report.dead.filter((symbol) => matches(symbol.filePath));
  const published = report.published.filter((symbol) => matches(symbol.filePath));

  const lines: string[] = [];
  lines.push(
    `**${String(dead.length)} symbol${dead.length === 1 ? '' : 's'} unreachable** — no path from an entry point, a ` +
      `test, a route, a decorator registration or a published name.`,
  );
  lines.push(
    `Asked of ${String(report.considered)} symbols over ${String(report.callEdges)} call edges; ` +
      `${String(report.roots.length)} roots reach ${String(report.reachableFromEntry)} by execution and ` +
      `${String(report.reachableFromPublished)} by publication.`,
  );
  lines.push('');

  if (dead.length > 0) {
    lines.push('### Unreachable');
    for (const symbol of dead.slice(0, maxResults)) {
      lines.push(
        `- \`${symbol.name}\` — ${symbol.filePath}:${String(symbol.startLine ?? 0)} (${symbol.label})`,
      );
      lines.push(`  ${symbol.because}`);
    }
    if (dead.length > maxResults) lines.push(`- … and ${String(dead.length - maxResults)} more`);
    lines.push('');
  }

  if (published.length > 0 && args.includePublished !== false) {
    lines.push('### Not called here, but published');
    lines.push(
      'These are the API of this repository: nothing inside it calls them and something outside it may.',
    );
    for (const symbol of published.slice(0, maxResults)) {
      lines.push(`- \`${symbol.name}\` — ${symbol.filePath}:${String(symbol.startLine ?? 0)}`);
      lines.push(`  ${symbol.because}`);
    }
    if (published.length > maxResults)
      lines.push(`- … and ${String(published.length - maxResults)} more`);
    lines.push('');
  }

  if (report.ignored > 0) {
    lines.push(
      `${String(report.ignored)} symbol${report.ignored === 1 ? '' : 's'} ignored by name, as the caller asked.`,
    );
  }

  return lines.join('\n').trimEnd();
}

export const deadCodeDetectionTool: McpToolDefinition = {
  name: 'find_dead_code',
  description:
    'Find symbols that can never run: code with no path from an entry point, a test, a route, a decorator registration or a published name. Reports what is unreachable and, separately, what is public but never called from inside the repository.',
  inputSchema: {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'The project ID to analyse.' },
      includePublished: {
        type: 'boolean',
        description: 'List the symbols kept alive only by the published surface (default: true).',
        default: true,
      },
      includeTests: {
        type: 'boolean',
        description:
          'Count test helpers as roots. Off by default, because a test file is full of code nothing calls.',
        default: false,
      },
      entryPoints: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Qualified names or names this analysis cannot see being invoked — a handler, a main, a hook.',
      },
      ignoreNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'Names never reported, for the dynamic escapes the analysis does not model.',
      },
      filePattern: {
        type: 'string',
        description: 'Only report symbols whose path contains this substring.',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum findings per section (default: 50).',
        default: 50,
      },
    },
    required: ['projectId'],
  },
  handler: async (args: Record<string, unknown>, storeOrContext?: unknown) => {
    const store = ToolContextImpl.getStore(storeOrContext);
    // **`typeof`, not `String(...)`**: a client that sends an object where a project id belongs gets "no graph for
    // that id" rather than the string `[object Object]`, which would be a report about the wrong thing.
    const requested = args['projectId'];
    const projectId = typeof requested === 'string' ? requested : '';
    if (store === null || store === undefined) {
      return {
        content: [{ type: 'text', text: 'No graph store available. Index a project first.' }],
        isError: true,
        metadata: { projectId },
      };
    }

    const graph = graphOf(store, projectId);
    if (graph.nodes.size === 0) {
      return {
        content: [
          { type: 'text', text: `No graph found for project "${projectId}". Index it first.` },
        ],
        isError: true,
        metadata: { projectId },
      };
    }

    const text = formatDeadCodeReport(graph, args);
    const report = computeReachability(graph, {
      entryPoints: stringsOf(args['entryPoints']),
      ignoreNames: stringsOf(args['ignoreNames']),
      ...(args['includeTests'] === true ? {} : { includeTests: false }),
    });

    return {
      content: [{ type: 'text', text }],
      metadata: {
        projectId,
        unreachable: report.dead.length,
        publishedOnly: report.published.length,
        considered: report.considered,
        roots: report.roots.length,
        callEdges: report.callEdges,
      },
    };
  },
};

export default deadCodeDetectionTool;
