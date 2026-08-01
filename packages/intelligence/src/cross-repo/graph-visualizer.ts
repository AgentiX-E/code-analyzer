// @code-analyzer/intelligence — Cross-Repo Graph Visualizer
// Generates DOT/graphviz and JSON graph formats for cross-repo dependency
// visualization, plus repo-level metrics computation.

import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** A single cross-repo edge record used for visualization input. */
export interface CrossRepoEdgeRecord {
  sourceRepo: string;
  targetRepo: string;
  edgeType: string;
  sourceSymbol: string;
  targetSymbol: string;
  weight: number;
  confidence: number;
}

/** JSON-graph node representing a repository in the dependency graph. */
export interface JsonGraphRepoNode {
  id: string;
  label: string;
  type: 'repo';
  stats: {
    totalNodes: number;
    exportedSymbols: number;
    crossRepoEdgesOut: number;
    crossRepoEdgesIn: number;
  };
}

/** JSON-graph edge between two repos. */
export interface JsonGraphEdge {
  source: string;
  target: string;
  type: string;
  count: number;
  weight: number;
}

/** Serializable JSON dependency graph for web rendering. */
export interface JsonGraph {
  nodes: JsonGraphRepoNode[];
  edges: JsonGraphEdge[];
  metadata: {
    groupId: string;
    totalEdges: number;
    byType: Record<string, number>;
    orphanCount: number;
    generatedAt: string;
  };
}

/** Per-repository metrics computed from the dependency graph. */
export interface RepoMetrics {
  repoId: string;
  fanOut: number;
  fanIn: number;
  couplingScore: number;
  cohesionScore: number;
  externalDependencyRatio: number;
  topDependencies: string[];
  topDependents: string[];
  internalSymbolCount: number;
  crossRepoSymbolCount: number;
}

/** Internal repo info used during visualization. */
interface RepoInfo {
  fullName: string;
  label: string;
}

// ---------------------------------------------------------------------------
// CrossRepoGraphVisualizer
// ---------------------------------------------------------------------------

export class CrossRepoGraphVisualizer {
  // ---------------------------------------------------------------------------
  // DOT / Graphviz Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a DOT-format graph description for rendering with Graphviz.
   *
   * The output clusters repos into subgraphs, draws directed edges between
   * them, and includes a colour legend.
   */
  generateDotGraph(
    crossRepoEdges: CrossRepoEdgeRecord[],
    repos: RepoInfo[],
    groupName: string,
  ): string {
    const lines: string[] = [];
    const repoSet = new Set(repos.map((r) => r.fullName));

    lines.push(`digraph "cross_repo_${this.sanitizeDotId(groupName)}" {`);
    lines.push(`  label = "${this.escapeDot(groupName)} Cross-Repo Dependency Graph";`);
    lines.push('  labelloc = "t";');
    lines.push('  fontsize = 24;');
    lines.push('  rankdir = "LR";');
    lines.push('  compound = true;');
    lines.push('  node [shape = "box", style = "filled", fontname = "Helvetica"];');
    lines.push('  edge [fontname = "Helvetica", fontsize = 10];');
    lines.push('');

    // Define repo nodes with colour
    const colorPalette = [
      '#4A90D9', '#50B86C', '#E8A838', '#D94A4A', '#8B5CF6',
      '#06B6D4', '#F59E0B', '#EC4899', '#14B8A6', '#6366F1',
    ];

    const repoColors = new Map<string, string>();
    repos.forEach((repo, i) => {
      repoColors.set(repo.fullName, colorPalette[i % colorPalette.length]!);
    });

    for (const repo of repos) {
      const color = repoColors.get(repo.fullName)!;
      lines.push(`  "${this.sanitizeDotId(repo.fullName)}" [`);
      lines.push(`    label = "${this.escapeDot(repo.label)}",`);
      lines.push(`    fillcolor = "${color}22",`);
      lines.push(`    color = "${color}",`);
      lines.push('    penwidth = 2');
      lines.push('  ];');
    }
    lines.push('');

    // Draw edges, collapsing duplicates by repo pair + edge type
    const edgeAggregator = new Map<string, { count: number; weight: number }>();
    for (const e of crossRepoEdges) {
      if (!repoSet.has(e.sourceRepo) || !repoSet.has(e.targetRepo)) continue;
      const key = `${e.sourceRepo}::${e.targetRepo}::${e.edgeType}`;
      const existing = edgeAggregator.get(key);
      if (existing) {
        existing.count++;
        existing.weight += e.weight;
      } else {
        edgeAggregator.set(key, { count: 1, weight: e.weight });
      }
    }

    for (const [key, agg] of edgeAggregator) {
      const [source, target, edgeType] = key.split('::') as [string, string, string];
      const style = this.dotEdgeStyle(edgeType);
      const label = this.dotEdgeLabel(edgeType, agg.count);
      lines.push(
        `  "${this.sanitizeDotId(source)}" -> "${this.sanitizeDotId(target)}" [${style} label = "${label}" weight = ${Math.round(agg.weight)}];`,
      );
    }

    lines.push('');
    lines.push('  // Legend');
    lines.push('  subgraph cluster_legend {');
    lines.push('    label = "Legend";');
    lines.push('    fontsize = 12;');
    lines.push('    style = "dashed";');
    lines.push('    color = "#888888";');
    lines.push('    bgcolor = "#F8F8F8";');
    lines.push('');
    lines.push('    legend_imports [label = "CROSS_REPO_IMPORTS", shape = "plaintext", fontsize = 10];');
    lines.push('    legend_calls   [label = "CROSS_REPO_CALLS",   shape = "plaintext", fontsize = 10];');
    lines.push('    legend_depends [label = "CROSS_REPO_DEPENDS", shape = "plaintext", fontsize = 10];');
    lines.push('');
    lines.push('    legend_imports -> legend_calls -> legend_depends [style = "invis"];');
    lines.push('  }');

    lines.push('}');
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------------------
  // JSON Graph Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a JSON-serializable dependency graph for use in web dashboards.
   *
   * The output is directly consumable by force-directed graph renderers.
   */
  generateJsonGraph(
    groupId: string,
    repos: RepoInfo[],
    crossRepoEdges: CrossRepoEdgeRecord[],
    nodesByRepo?: Map<string, GraphNode[]>,
  ): JsonGraph {
    const repoSet = new Set(repos.map((r) => r.fullName));
    const jsonNodes: JsonGraphRepoNode[] = [];
    const jsonEdges: JsonGraphEdge[] = [];

    // Build nodes
    for (const repo of repos) {
      const repoNodes = nodesByRepo?.get(repo.fullName) ?? [];
      const exported = repoNodes.filter((n) => n.isExported);

      jsonNodes.push({
        id: repo.fullName,
        label: repo.label,
        type: 'repo',
        stats: {
          totalNodes: repoNodes.length,
          exportedSymbols: exported.length,
          crossRepoEdgesOut: 0, // Filled below
          crossRepoEdgesIn: 0,  // Filled below
        },
      });
    }

    // Build edges — collapse duplicates
    const edgeMap = new Map<string, { count: number; weight: number }>();
    for (const e of crossRepoEdges) {
      if (!repoSet.has(e.sourceRepo) || !repoSet.has(e.targetRepo)) continue;
      const key = `${e.sourceRepo}::${e.targetRepo}::${e.edgeType}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
        existing.weight += e.weight;
      } else {
        edgeMap.set(key, { count: 1, weight: e.weight });
      }
    }

    // Update node stats from edge data
    const fanOut = new Map<string, number>();
    const fanIn = new Map<string, number>();

    for (const [key, agg] of edgeMap) {
      const [source, target, edgeType] = key.split('::') as [string, string, string];
      jsonEdges.push({
        source,
        target,
        type: edgeType,
        count: agg.count,
        weight: Math.round(agg.weight),
      });

      fanOut.set(source, (fanOut.get(source) ?? 0) + agg.count);
      fanIn.set(target, (fanIn.get(target) ?? 0) + agg.count);
    }

    for (const node of jsonNodes) {
      node.stats.crossRepoEdgesOut = fanOut.get(node.id) ?? 0;
      node.stats.crossRepoEdgesIn = fanIn.get(node.id) ?? 0;
    }

    // Compute by-type breakdown
    const byType: Record<string, number> = {};
    for (const [key, agg] of edgeMap) {
      const edgeType = key.split('::')[2]!;
      byType[edgeType] = (byType[edgeType] ?? 0) + agg.count;
    }

    // Compute orphans — repos with zero cross-repo edges
    const orphanCount = jsonNodes.filter(
      (n) => n.stats.crossRepoEdgesOut === 0 && n.stats.crossRepoEdgesIn === 0,
    ).length;

    return {
      nodes: jsonNodes,
      edges: jsonEdges,
      metadata: {
        groupId,
        totalEdges: jsonEdges.length,
        byType,
        orphanCount,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Repo Metrics Computation
  // ---------------------------------------------------------------------------

  /**
   * Compute dependency metrics for a single repository.
   *
   * - **fanOut**: number of repos this repo depends on
   * - **fanIn**: number of repos that depend on this repo
   * - **couplingScore**: normalized 0–1, higher = more tightly coupled
   * - **cohesionScore**: 1 / (1 + externalDeps), higher = more self-contained
   * - **externalDependencyRatio**: cross-repo edges / total edges
   */
  computeRepoMetrics(
    repoId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    crossRepoEdges?: CrossRepoEdgeRecord[],
  ): RepoMetrics {
    const repoEdges = edges.filter(
      (e) => e.projectId === repoId || e.type.startsWith('CROSS_REPO_'),
    );

    const externalEdges = repoEdges.filter((e) => e.type.startsWith('CROSS_REPO_'));

    const fanOutSet = new Set<string>();
    const fanInSet = new Set<string>();

    if (crossRepoEdges) {
      for (const ce of crossRepoEdges) {
        if (ce.sourceRepo === repoId) fanOutSet.add(ce.targetRepo);
        if (ce.targetRepo === repoId) fanInSet.add(ce.sourceRepo);
      }
    } else {
      // Fallback: derive from CROSS_REPO_ edges
      for (const edge of externalEdges) {
        const props = edge.properties as Record<string, unknown>;
        const srcRepo = props['sourceRepo'] as string | undefined;
        const tgtRepo = props['targetRepo'] as string | undefined;
        if (srcRepo === repoId && tgtRepo) fanOutSet.add(tgtRepo);
        if (tgtRepo === repoId && srcRepo) fanInSet.add(srcRepo);
      }
    }

    const fanOut = fanOutSet.size;
    const fanIn = fanInSet.size;
    const totalRepos = new Set([
      ...fanOutSet,
      ...fanInSet,
      repoId,
    ]).size;
    const couplingScore = totalRepos > 1 ? (fanOut + fanIn) / (totalRepos * 2 - 2) : 0;
    const externalDependencyRatio = repoEdges.length > 0
      ? externalEdges.length / repoEdges.length
      : 0;
    const cohesionScore = 1 / (1 + externalDependencyRatio * 10);

    // Sort dependencies by edge count
    const depCounts = new Map<string, number>();
    if (crossRepoEdges) {
      for (const ce of crossRepoEdges) {
        if (ce.sourceRepo === repoId) {
          depCounts.set(ce.targetRepo, (depCounts.get(ce.targetRepo) ?? 0) + 1);
        }
      }
    }
    const sortedDeps = [...depCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([repo]) => repo);

    const depOnCounts = new Map<string, number>();
    if (crossRepoEdges) {
      for (const ce of crossRepoEdges) {
        if (ce.targetRepo === repoId) {
          depOnCounts.set(ce.sourceRepo, (depOnCounts.get(ce.sourceRepo) ?? 0) + 1);
        }
      }
    }
    const sortedDependents = [...depOnCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([repo]) => repo);

    const internalSymbols = nodes.filter(
      (n) => n.isExported && !n.label.startsWith('CrossRepo'),
    ).length;
    const crossRepoSymbols = nodes.filter(
      (n) => n.label.startsWith('CrossRepo'),
    ).length;

    return {
      repoId,
      fanOut,
      fanIn,
      couplingScore: Math.round(couplingScore * 1000) / 1000,
      cohesionScore: Math.round(cohesionScore * 1000) / 1000,
      externalDependencyRatio: Math.round(externalDependencyRatio * 1000) / 1000,
      topDependencies: sortedDeps,
      topDependents: sortedDependents,
      internalSymbolCount: internalSymbols,
      crossRepoSymbolCount: crossRepoSymbols,
    };
  }

  /**
   * Compute batch metrics for all repos in a group.
   */
  computeAllRepoMetrics(
    repos: RepoInfo[],
    nodesByRepo: Map<string, GraphNode[]>,
    edges: GraphEdge[],
    crossRepoEdges: CrossRepoEdgeRecord[],
  ): Map<string, RepoMetrics> {
    const result = new Map<string, RepoMetrics>();
    for (const repo of repos) {
      const nodes = nodesByRepo.get(repo.fullName) ?? [];
      result.set(
        repo.fullName,
        this.computeRepoMetrics(repo.fullName, nodes, edges, crossRepoEdges),
      );
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private sanitizeDotId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  private escapeDot(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private dotEdgeStyle(edgeType: string): string {
    if (edgeType === 'CROSS_REPO_CALLS') return 'style = "dashed" color = "#D94A4A" ';
    if (edgeType === 'CROSS_REPO_IMPLEMENTS') return 'style = "bold" color = "#50B86C" ';
    if (edgeType === 'CROSS_REPO_DEPENDS') return 'style = "dotted" color = "#8B5CF6" ';
    return 'color = "#4A90D9" '; // CROSS_REPO_IMPORTS (default)
  }

  private dotEdgeLabel(edgeType: string, count: number): string {
    const short = edgeType.replace('CROSS_REPO_', '').toLowerCase();
    return `${short} (${count})`;
  }
}
