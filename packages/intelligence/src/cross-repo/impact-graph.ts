// @code-analyzer/intelligence — Cross-Repo Impact Graph
// Builds a directed dependency graph across repositories.
// Calculates blast radius, transitive dependencies, and impact severity ranking.

import type { CrossRepoIndexer } from './cross-repo-indexer.js';

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

export interface ImpactNode {
  repo: string;
  symbols: string[];
  directDependents: string[];
  transitiveDependents: string[];
}

export interface ImpactEdge {
  from: string;
  to: string;
  symbols: string[];
  weight: number;
}

export interface ImpactGraph {
  nodes: Map<string, ImpactNode>;
  edges: ImpactEdge[];
}

export interface BlastRadiusResult {
  sourceRepo: string;
  directImpact: string[];
  transitiveImpact: string[];
  totalAffected: number;
  criticalPaths: string[][];
  severityRankings: Map<string, 'critical' | 'high' | 'medium' | 'low'>;
}

export interface DependencyChain {
  repos: string[];
  symbols: string[];
  depth: number;
  criticality: 'critical' | 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// ImpactGraphBuilder
// ---------------------------------------------------------------------------

export class ImpactGraphBuilder {
  private graph: ImpactGraph = {
    nodes: new Map(),
    edges: [],
  };

  constructor(private indexer: CrossRepoIndexer) {}

  /**
   * Build the cross-repo impact graph for a group.
   */
  async build(groupId: string): Promise<ImpactGraph> {
    this.graph = { nodes: new Map(), edges: [] };

    try {
      const impact = await this.indexer.analyzeCrossRepoImpact(groupId, '');
      const allRepos = new Set(impact.affectedRepos);

      // Add nodes
      for (const repo of allRepos) {
        const nodes = this.indexer.getRepoNodes(repo);
        const symbols = nodes.map((n) => n.name).filter(Boolean) as string[];
        this.graph.nodes.set(repo, {
          repo,
          symbols,
          directDependents: [],
          transitiveDependents: [],
        });
      }

      // Add edges from analysis
      for (const entry of impact.analysis) {
        this.graph.edges.push({
          from: impact.changedRepo,
          to: entry.repo,
          symbols: entry.affectedSymbols,
          weight: this.impactLevelToWeight(entry.impactLevel),
        });

        // Update node dependents
        const sourceNode = this.graph.nodes.get(impact.changedRepo);
        if (sourceNode && !sourceNode.directDependents.includes(entry.repo)) {
          sourceNode.directDependents.push(entry.repo);
        }
      }
    } catch {
      // Return empty graph on failure
    }

    return this.graph;
  }

  /**
   * Calculate the blast radius of changes from a source repo.
   * Returns direct, transitive, and critical path impact.
   */
  calculateBlastRadius(
    sourceRepo: string,
    graph?: ImpactGraph,
  ): BlastRadiusResult {
    const g = graph ?? this.graph;
    const visited = new Set<string>();
    const directImpact: string[] = [];
    const transitiveImpact: string[] = [];
    const severityRankings = new Map<string, 'critical' | 'high' | 'medium' | 'low'>();

    // BFS to find all affected repos
    // Seed with direct dependents first
    const queue: string[] = [];
    visited.add(sourceRepo);

    // Enqueue all direct dependents
    const directEdges = g.edges.filter((e) => e.from === sourceRepo);
    for (const edge of directEdges) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
        directImpact.push(edge.to);
      }
    }

    let depth = 1; // Direct dependents are at depth 1
    while (queue.length > 0) {
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;

        if (depth > 1) {
          transitiveImpact.push(current);
        }

        // Find further dependents
        const edges = g.edges.filter((e) => e.from === current);
        for (const edge of edges) {
          if (!visited.has(edge.to)) {
            visited.add(edge.to);
            queue.push(edge.to);
          }
        }
      }
      depth++;
    }

    // Calculate severity rankings
    for (const repo of visited) {
      if (repo === sourceRepo) continue;
      const edges = g.edges.filter((e) => e.to === repo);
      const maxWeight = Math.max(...edges.map((e) => e.weight), 0);
      severityRankings.set(repo, this.weightToSeverity(maxWeight));
    }

    // Find critical paths (paths with high severity)
    const criticalPaths = this.findCriticalPaths(sourceRepo, g);

    return {
      sourceRepo,
      directImpact,
      transitiveImpact,
      totalAffected: visited.size - 1, // Exclude source
      criticalPaths,
      severityRankings,
    };
  }

  /**
   * Find all dependency chains from a source repo.
   */
  findDependencyChains(
    sourceRepo: string,
    graph?: ImpactGraph,
  ): DependencyChain[] {
    const g = graph ?? this.graph;
    const chains: DependencyChain[] = [];

    const dfs = (
      current: string,
      path: string[],
      symbols: string[],
      depth: number,
    ) => {
      const edges = g.edges.filter((e) => e.from === current);
      if (edges.length === 0 && path.length > 1) {
        // Leaf node — record chain
        const maxWeight = Math.max(
          ...g.edges
            .filter((e) => path.includes(e.from) || path.includes(e.to))
            .map((e) => e.weight),
          0,
        );
        chains.push({
          repos: [...path],
          symbols: [...symbols],
          depth,
          criticality: this.weightToSeverity(maxWeight),
        });
        return;
      }

      for (const edge of edges) {
        if (!path.includes(edge.to)) {
          dfs(edge.to, [...path, edge.to], [...symbols, ...edge.symbols], depth + 1);
        }
      }
    };

    dfs(sourceRepo, [sourceRepo], [], 0);
    return chains;
  }

  /**
   * Calculate transitive dependents for all nodes.
   */
  computeTransitiveDependents(graph?: ImpactGraph): void {
    const g = graph ?? this.graph;

    for (const [repo, node] of g.nodes) {
      const visited = new Set<string>();
      const queue = [...node.directDependents];
      const transitive: string[] = [];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        const currentNode = g.nodes.get(current);
        if (currentNode) {
          for (const dep of currentNode.directDependents) {
            if (!visited.has(dep) && dep !== repo) {
              transitive.push(dep);
              queue.push(dep);
            }
          }
        }
      }

      node.transitiveDependents = [...new Set(transitive)];
    }
  }

  /**
   * Get the current graph.
   */
  getGraph(): ImpactGraph {
    return this.graph;
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private impactLevelToWeight(level: string): number {
    switch (level) {
      case 'critical': return 10;
      case 'high': return 7;
      case 'medium': return 4;
      case 'low': return 1;
      default: return 1;
    }
  }

  private weightToSeverity(weight: number): 'critical' | 'high' | 'medium' | 'low' {
    if (weight >= 10) return 'critical';
    if (weight >= 7) return 'high';
    if (weight >= 4) return 'medium';
    return 'low';
  }

  private findCriticalPaths(sourceRepo: string, graph: ImpactGraph): string[][] {
    const paths: string[][] = [];
    const criticalEdges = graph.edges.filter((e) => e.weight >= 7);

    // For each critical edge, find a path from source to target
    for (const edge of criticalEdges) {
      if (edge.from === sourceRepo) {
        paths.push([sourceRepo, edge.to]);
      }
    }

    return paths;
  }
}
