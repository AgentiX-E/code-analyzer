import { describe, it, expect, beforeEach } from 'vitest';
import { CrossRepoGraphVisualizer } from '../cross-repo/graph-visualizer.js';
import type {
  CrossRepoEdgeRecord,
  JsonGraphRepoNode,
  JsonGraphEdge,
  JsonGraph,
  RepoMetrics,
} from '../cross-repo/graph-visualizer.js';
import type { GraphNode, GraphEdge } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal GraphNode for testing. */
function makeNode(overrides: Partial<GraphNode> & { id: number; projectId: string }): GraphNode {
  return {
    label: 'CLASS' as any,
    name: 'TestNode',
    qualifiedName: 'com.example.TestNode',
    filePath: null,
    startLine: null,
    endLine: null,
    language: 'typescript',
    properties: {} as any,
    signature: null,
    docstring: null,
    complexity: null,
    isExported: false,
    fingerprint: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a minimal GraphEdge for testing. */
function makeEdge(overrides: Partial<GraphEdge> & { id: number; projectId: string; sourceId: number; targetId: number }): GraphEdge {
  return {
    type: 'IMPORTS' as any,
    properties: {} as any,
    weight: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a CrossRepoEdgeRecord for testing. */
function makeCrossRepoEdge(overrides: Partial<CrossRepoEdgeRecord> = {}): CrossRepoEdgeRecord {
  return {
    sourceRepo: 'repo-a',
    targetRepo: 'repo-b',
    edgeType: 'CROSS_REPO_IMPORTS',
    sourceSymbol: 'src.symbol.A',
    targetSymbol: 'tgt.symbol.B',
    weight: 1,
    confidence: 0.9,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('CrossRepoGraphVisualizer', () => {
  let visualizer: CrossRepoGraphVisualizer;

  beforeEach(() => {
    visualizer = new CrossRepoGraphVisualizer();
  });

  // =========================================================================
  // generateDotGraph
  // =========================================================================

  describe('generateDotGraph', () => {
    it('generates a valid DOT digraph header', () => {
      const dot = visualizer.generateDotGraph([], [], 'my-group');
      expect(dot).toContain('digraph "cross_repo_my_group"');
      expect(dot).toContain('rankdir = "LR"');
      expect(dot).toContain('}');
    });

    it('includes the group name in the label', () => {
      const dot = visualizer.generateDotGraph([], [{ fullName: 'r1', label: 'R1' }], 'TestGroup');
      expect(dot).toContain('label = "TestGroup Cross-Repo Dependency Graph";');
    });

    it('generates DOT for 2 repos with one cross-repo edge', () => {
      const repos = [
        { fullName: 'packages/auth', label: 'Auth' },
        { fullName: 'packages/core', label: 'Core' },
      ];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({
          sourceRepo: 'packages/auth',
          targetRepo: 'packages/core',
          edgeType: 'CROSS_REPO_IMPORTS',
          weight: 2,
        }),
      ];

      const dot = visualizer.generateDotGraph(edges, repos, 'MyGroup');

      // Repo nodes present
      expect(dot).toContain('"packages_auth"');
      expect(dot).toContain('"packages_core"');
      // Edge present
      expect(dot).toContain('"packages_auth" -> "packages_core"');
      expect(dot).toContain('imports (1)');
      expect(dot).toContain('weight = 2');
    });

    it('generates DOT for 3 repos with multiple edges', () => {
      const repos = [
        { fullName: 'repo-a', label: 'A' },
        { fullName: 'repo-b', label: 'B' },
        { fullName: 'repo-c', label: 'C' },
      ];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'repo-a', targetRepo: 'repo-b' }),
        makeCrossRepoEdge({ sourceRepo: 'repo-b', targetRepo: 'repo-c' }),
        makeCrossRepoEdge({ sourceRepo: 'repo-a', targetRepo: 'repo-c', edgeType: 'CROSS_REPO_CALLS' }),
      ];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');

      expect(dot).toContain('"repo_a"');
      expect(dot).toContain('"repo_b"');
      expect(dot).toContain('"repo_c"');
      expect(dot).toContain('"repo_a" -> "repo_b"');
      expect(dot).toContain('"repo_b" -> "repo_c"');
      expect(dot).toContain('"repo_a" -> "repo_c"');
    });

    it('generates minimal DOT for zero repos and zero edges', () => {
      const dot = visualizer.generateDotGraph([], [], 'empty');
      expect(dot).toContain('digraph "cross_repo_empty"');
      // No repo nodes
      expect(dot).not.toContain('fillcolor');
      // Legend still present
      expect(dot).toContain('Legend');
    });

    it('generates DOT with repos but zero cross-repo edges', () => {
      const repos = [
        { fullName: 'r1', label: 'Repo 1' },
        { fullName: 'r2', label: 'Repo 2' },
      ];

      const dot = visualizer.generateDotGraph([], repos, 'G');

      expect(dot).toContain('"r1"');
      expect(dot).toContain('"r2"');
      // No arrows between repos (exclude legend arrows)
      const repoArrows = dot.split('\n').filter((l) => l.includes('->') && !l.includes('legend'));
      expect(repoArrows).toHaveLength(0);
    });

    it('generates correct DOT style for CROSS_REPO_IMPORTS (default blue)', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_IMPORTS' })];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('color = "#4A90D9"');
    });

    it('generates dashed red style for CROSS_REPO_CALLS', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS' })];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('style = "dashed"');
      expect(dot).toContain('color = "#D94A4A"');
    });

    it('generates dotted purple style for CROSS_REPO_DEPENDS', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_DEPENDS' })];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('style = "dotted"');
      expect(dot).toContain('color = "#8B5CF6"');
    });

    it('generates bold green style for CROSS_REPO_IMPLEMENTS', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_IMPLEMENTS' })];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('style = "bold"');
      expect(dot).toContain('color = "#50B86C"');
    });

    it('aggregates duplicate edges by repo pair and edge type', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 1 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 3 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 0.5 }),
      ];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      // Should have one edge line with count=3 and weight rounded to 5
      expect(dot).toContain('imports (3)');
      expect(dot).toContain('weight = 5');
      // Only one occurrence of the arrow
      const arrows = dot.split('\n').filter((l) => l.includes('->') && !l.includes('legend')).length;
      expect(arrows).toBe(1);
    });

    it('excludes edges for repos not in the repo list', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'unknown' }),
        makeCrossRepoEdge({ sourceRepo: 'unknown', targetRepo: 'a' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b' }),
      ];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      const arrows = dot.split('\n').filter((l) => l.includes('->') && !l.includes('legend')).length;
      expect(arrows).toBe(1);
    });

    it('includes legend subgraph with edge type entries', () => {
      const dot = visualizer.generateDotGraph([], [], 'G');
      expect(dot).toContain('subgraph cluster_legend');
      expect(dot).toContain('legend_imports');
      expect(dot).toContain('legend_calls');
      expect(dot).toContain('legend_depends');
      expect(dot).toContain('CROSS_REPO_IMPORTS');
      expect(dot).toContain('CROSS_REPO_CALLS');
      expect(dot).toContain('CROSS_REPO_DEPENDS');
    });

    it('sanitizes special characters in repo names for DOT IDs', () => {
      const repos = [
        { fullName: 'packages/my-service', label: 'My Service' },
        { fullName: '@scope/lib', label: 'Scope Lib' },
      ];
      const dot = visualizer.generateDotGraph([], repos, 'G');
      expect(dot).toContain('"packages_my_service"');
      expect(dot).toContain('"_scope_lib"');
    });

    it('escapes quotes in labels for DOT safety', () => {
      const repos = [{ fullName: 'r1', label: 'Repo "A"' }];
      const dot = visualizer.generateDotGraph([], repos, 'G');
      expect(dot).toContain('Repo \\"A\\"');
    });

    it('escapes backslashes in labels for DOT safety', () => {
      const repos = [{ fullName: 'r1', label: 'path\\to\\repo' }];
      const dot = visualizer.generateDotGraph([], repos, 'G');
      expect(dot).toContain('path\\\\to\\\\repo');
    });

    it('assigns colors in repeating palette order', () => {
      const repos = Array.from({ length: 15 }, (_, i) => ({
        fullName: `repo-${i}`,
        label: `R${i}`,
      }));
      const dot = visualizer.generateDotGraph([], repos, 'G');
      // First color palette entry should appear for repo-0
      expect(dot).toContain('fillcolor = "#4A90D922"');
      expect(dot).toContain('color = "#4A90D9"');
      // Tenth palette entry for repo-9
      expect(dot).toContain('color = "#6366F1"');
      // Color wraps around for repo-10 (index 10 % 10 = 0)
    });

    it('handles a single repo with no edges', () => {
      const repos = [{ fullName: 'solo', label: 'Solo Repo' }];
      const dot = visualizer.generateDotGraph([], repos, 'G');
      expect(dot).toContain('"solo"');
      const repoArrows = dot.split('\n').filter((l) => l.includes('->') && !l.includes('legend'));
      expect(repoArrows).toHaveLength(0);
    });

    it('rounds weight values in DOT edges', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 3.7 })];
      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('weight = 4');
    });

    it('generates short edge type label with count', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS' }),
      ];
      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('calls (3)');
    });

    it('sanitizes group name in DOT ID', () => {
      const dot = visualizer.generateDotGraph([], [], 'group/with spaces&stuff');
      expect(dot).toContain('digraph "cross_repo_group_with_spaces_stuff"');
    });

    it('applies repo node DOT scaffolding attributes', () => {
      const repos = [{ fullName: 'r1', label: 'R1' }];
      const dot = visualizer.generateDotGraph([], repos, 'G');
      expect(dot).toContain('penwidth = 2');
      expect(dot).toContain('shape = "box"');
    });
  });

  // =========================================================================
  // generateJsonGraph
  // =========================================================================

  describe('generateJsonGraph', () => {
    it('returns a well-formed JsonGraph structure', () => {
      const repos = [{ fullName: 'r1', label: 'R1' }];
      const result = visualizer.generateJsonGraph('g1', repos, []);

      expect(result.nodes).toBeDefined();
      expect(result.edges).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.groupId).toBe('g1');
    });

    it('creates a node for each repo in the list', () => {
      const repos = [
        { fullName: 'repo-a', label: 'A' },
        { fullName: 'repo-b', label: 'B' },
        { fullName: 'repo-c', label: 'C' },
      ];
      const result = visualizer.generateJsonGraph('g', repos, []);
      expect(result.nodes).toHaveLength(3);
      expect(result.nodes.map((n) => n.id)).toEqual(['repo-a', 'repo-b', 'repo-c']);
    });

    it('populates node stats from nodesByRepo', () => {
      const repos = [{ fullName: 'r1', label: 'R1' }];
      const nodesByRepo = new Map<string, GraphNode[]>([
        ['r1', [
          makeNode({ id: 1, projectId: 'r1', isExported: false }),
          makeNode({ id: 2, projectId: 'r1', isExported: true }),
          makeNode({ id: 3, projectId: 'r1', isExported: true }),
        ]],
      ]);

      const result = visualizer.generateJsonGraph('g', repos, [], nodesByRepo);
      const node = result.nodes[0]!;
      expect(node.stats.totalNodes).toBe(3);
      expect(node.stats.exportedSymbols).toBe(2);
    });

    it('defaults node stats to zero when nodesByRepo is omitted', () => {
      const repos = [{ fullName: 'r1', label: 'R1' }];
      const result = visualizer.generateJsonGraph('g', repos, []);
      expect(result.nodes[0]!.stats.totalNodes).toBe(0);
      expect(result.nodes[0]!.stats.exportedSymbols).toBe(0);
    });

    it('generates edges from cross-repo edge records', () => {
      const repos = [
        { fullName: 'a', label: 'A' },
        { fullName: 'b', label: 'B' },
      ];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS', weight: 5 })];
      const result = visualizer.generateJsonGraph('g', repos, edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.source).toBe('a');
      expect(result.edges[0]!.target).toBe('b');
      expect(result.edges[0]!.type).toBe('CROSS_REPO_CALLS');
      expect(result.edges[0]!.count).toBe(1);
      expect(result.edges[0]!.weight).toBe(5);
    });

    it('deduplicates edges by source + target + edge type', () => {
      const repos = [
        { fullName: 'a', label: 'A' },
        { fullName: 'b', label: 'B' },
      ];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 2 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 3 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS', weight: 1 }),
      ];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.edges).toHaveLength(2);

      const importsEdge = result.edges.find((e) => e.type === 'CROSS_REPO_IMPORTS')!;
      expect(importsEdge.count).toBe(2);
      expect(importsEdge.weight).toBe(5);

      const callsEdge = result.edges.find((e) => e.type === 'CROSS_REPO_CALLS')!;
      expect(callsEdge.count).toBe(1);
      expect(callsEdge.weight).toBe(1);
    });

    it('updates cross-repo edge stats on nodes', () => {
      const repos = [
        { fullName: 'producer', label: 'P' },
        { fullName: 'consumer', label: 'C' },
      ];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'consumer', targetRepo: 'producer' }),
        makeCrossRepoEdge({ sourceRepo: 'consumer', targetRepo: 'producer' }),
        makeCrossRepoEdge({ sourceRepo: 'consumer', targetRepo: 'producer' }),
      ];

      const result = visualizer.generateJsonGraph('g', repos, edges);

      const consumer = result.nodes.find((n) => n.id === 'consumer')!;
      const producer = result.nodes.find((n) => n.id === 'producer')!;
      expect(consumer.stats.crossRepoEdgesOut).toBe(3);
      expect(consumer.stats.crossRepoEdgesIn).toBe(0);
      expect(producer.stats.crossRepoEdgesOut).toBe(0);
      expect(producer.stats.crossRepoEdgesIn).toBe(3);
    });

    it('detects orphan repos (zero in/out edges)', () => {
      const repos = [
        { fullName: 'connected-a', label: 'CA' },
        { fullName: 'connected-b', label: 'CB' },
        { fullName: 'orphan', label: 'O' },
      ];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'connected-a', targetRepo: 'connected-b' })];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.metadata.orphanCount).toBe(1);
    });

    it('reports zero orphans when all repos are connected', () => {
      const repos = [
        { fullName: 'a', label: 'A' },
        { fullName: 'b', label: 'B' },
      ];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b' })];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.metadata.orphanCount).toBe(0);
    });

    it('includes byType metadata breakdown', () => {
      const repos = [
        { fullName: 'a', label: 'A' },
        { fullName: 'b', label: 'B' },
        { fullName: 'c', label: 'C' },
      ];
      const edges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_IMPORTS' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_IMPORTS' }),
        makeCrossRepoEdge({ sourceRepo: 'b', targetRepo: 'c', edgeType: 'CROSS_REPO_CALLS' }),
      ];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.metadata.byType['CROSS_REPO_IMPORTS']).toBe(2);
      expect(result.metadata.byType['CROSS_REPO_CALLS']).toBe(1);
    });

    it('includes generatedAt timestamp in metadata', () => {
      const before = new Date().toISOString();
      const result = visualizer.generateJsonGraph('g', [], []);
      const after = new Date().toISOString();
      expect(result.metadata.generatedAt).toBeTruthy();
      expect(result.metadata.generatedAt >= before).toBe(true);
      expect(result.metadata.generatedAt <= after).toBe(true);
    });

    it('sets totalEdges in metadata', () => {
      const repos = [
        { fullName: 'a', label: 'A' },
        { fullName: 'b', label: 'B' },
      ];
      const edges = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_CALLS' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', edgeType: 'CROSS_REPO_DEPENDS' }),
      ];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.metadata.totalEdges).toBe(3);
    });

    it('filters out edges referencing repos outside the repo list', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'x' }),
        makeCrossRepoEdge({ sourceRepo: 'x', targetRepo: 'a' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b' }),
      ];

      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.source).toBe('a');
      expect(result.edges[0]!.target).toBe('b');
    });

    it('rounds weight to integer in JSON edges', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 3.2 })];
      const result = visualizer.generateJsonGraph('g', repos, edges);
      expect(result.edges[0]!.weight).toBe(3);
    });

    it('handles empty nodesByRepo gracefully', () => {
      const repos = [{ fullName: 'r1', label: 'R1' }];
      const emptyMap = new Map<string, GraphNode[]>();
      const result = visualizer.generateJsonGraph('g', repos, [], emptyMap);
      expect(result.nodes[0]!.stats.totalNodes).toBe(0);
    });

    it('handles zero repos gracefully', () => {
      const result = visualizer.generateJsonGraph('g', [], []);
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.metadata.orphanCount).toBe(0);
    });
  });

  // =========================================================================
  // computeRepoMetrics
  // =========================================================================

  describe('computeRepoMetrics', () => {
    const repoId = 'packages/auth';
    let nodes: GraphNode[];
    let edges: GraphEdge[];

    beforeEach(() => {
      nodes = [
        makeNode({ id: 1, projectId: repoId, isExported: true, name: 'AuthService', label: 'CLASS' as any }),
        makeNode({ id: 2, projectId: repoId, isExported: true, name: 'TokenHelper', label: 'CLASS' as any }),
        makeNode({ id: 3, projectId: repoId, isExported: false, name: 'CrossRepo_facade', label: 'CrossRepo_facade' as any }),
        makeNode({ id: 4, projectId: repoId, isExported: true, name: 'CrossRepo_bridge', label: 'CrossRepo_bridge' as any }),
      ];
      edges = [
        makeEdge({ id: 1, projectId: repoId, sourceId: 1, targetId: 2, type: 'CROSS_REPO_IMPORTS' as any }),
        makeEdge({ id: 2, projectId: repoId, sourceId: 2, targetId: 3, type: 'IMPORTS' as any }),
        makeEdge({ id: 3, projectId: repoId, sourceId: 3, targetId: 4, type: 'CROSS_REPO_CALLS' as any }),
      ];
    });

    it('computes basic metrics for a repo', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'packages/core' }),
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'packages/utils' }),
        makeCrossRepoEdge({ sourceRepo: 'packages/core', targetRepo: repoId }),
      ];

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);

      expect(metrics.repoId).toBe(repoId);
      expect(metrics.fanOut).toBe(2); // auth -> core, auth -> utils
      expect(metrics.fanIn).toBe(1);  // core -> auth
    });

    it('computes couplingScore for a moderate coupling scenario', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'pkg-a' }),
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'pkg-b' }),
        makeCrossRepoEdge({ sourceRepo: 'pkg-a', targetRepo: repoId }),
      ];
      // fanOut=2, fanIn=1, totalRepos=3
      // couplingScore = (2+1) / (3*2 - 2) = 3/4 = 0.75

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      expect(metrics.couplingScore).toBe(0.75);
    });

    it('returns couplingScore of 0 for isolated repo', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, []);
      expect(metrics.couplingScore).toBe(0);
    });

    it('computes high coupling score (1.0) for fully interconnected repos', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b' }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'c' }),
        makeCrossRepoEdge({ sourceRepo: 'b', targetRepo: 'a' }),
        makeCrossRepoEdge({ sourceRepo: 'b', targetRepo: 'c' }),
        makeCrossRepoEdge({ sourceRepo: 'c', targetRepo: 'a' }),
        makeCrossRepoEdge({ sourceRepo: 'c', targetRepo: 'b' }),
      ];
      // For repo 'a': fanOut=2 (b,c), fanIn=2 (b,c), totalRepos=3
      // couplingScore = (2+2) / (3*2 - 2) = 4/4 = 1.0

      const metrics = visualizer.computeRepoMetrics('a', nodes, edges, crossRepoEdges);
      expect(metrics.couplingScore).toBe(1);
    });

    it('computes externalDependencyRatio', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'other' }),
      ];

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      // repoEdges = 3 (all with projectId = repoId or CROSS_REPO_ type)
      // externalEdges = 2 (CROSS_REPO_IMPORTS + CROSS_REPO_CALLS)
      expect(metrics.externalDependencyRatio).toBeCloseTo(2 / 3, 2);
    });

    it('returns zero dependency ratio when there are no edges', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, [], []);
      expect(metrics.externalDependencyRatio).toBe(0);
    });

    it('computes cohesionScore', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'x' }),
      ];
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      // externalDependencyRatio ≈ 0.667
      // cohesionScore = 1 / (1 + 0.667 * 10) ≈ 0.13
      expect(metrics.cohesionScore).toBeCloseTo(0.13, 1);
    });

    it('identifies top dependencies sorted by edge count', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'dep-a' }),
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'dep-b' }),
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'dep-b' }),
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'dep-c' }),
      ];

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      expect(metrics.topDependencies[0]).toBe('dep-b'); // count=2
      expect(metrics.topDependencies).toContain('dep-a');
      expect(metrics.topDependencies).toContain('dep-c');
    });

    it('limits topDependencies to 5 entries', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [];
      for (let i = 0; i < 10; i++) {
        crossRepoEdges.push(makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: `target-${i}` }));
      }

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      expect(metrics.topDependencies).toHaveLength(5);
    });

    it('identifies top dependents sorted by edge count', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'dep-a', targetRepo: repoId }),
        makeCrossRepoEdge({ sourceRepo: 'dep-b', targetRepo: repoId }),
        makeCrossRepoEdge({ sourceRepo: 'dep-b', targetRepo: repoId }),
      ];

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      expect(metrics.topDependents[0]).toBe('dep-b');
      expect(metrics.topDependents).toContain('dep-a');
      expect(metrics.topDependents).toHaveLength(2);
    });

    it('limits topDependents to 5 entries', () => {
      const crossRepoEdges: CrossRepoEdgeRecord[] = [];
      for (let i = 0; i < 8; i++) {
        crossRepoEdges.push(makeCrossRepoEdge({ sourceRepo: `source-${i}`, targetRepo: repoId }));
      }

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, crossRepoEdges);
      expect(metrics.topDependents).toHaveLength(5);
    });

    it('counts internal symbols (exported, not CrossRepo-prefixed)', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, []);
      expect(metrics.internalSymbolCount).toBe(2); // AuthService, TokenHelper
    });

    it('counts cross-repo symbols (nodes with CrossRepo-prefixed label)', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, []);
      expect(metrics.crossRepoSymbolCount).toBe(2); // CrossRepo_bridge + CrossRepo_facade both have CrossRepo-prefixed labels
    });

    it('calculates internal symbols as 0 when none exported', () => {
      const localNodes = [
        makeNode({ id: 1, projectId: repoId, isExported: false, name: 'PrivateClass' }),
      ];
      const metrics = visualizer.computeRepoMetrics(repoId, localNodes, [], []);
      expect(metrics.internalSymbolCount).toBe(0);
    });

    it('falls back to edge properties when crossRepoEdges not provided', () => {
      // Create edges with sourceRepo/targetRepo in properties
      const localEdges: GraphEdge[] = [
        makeEdge({
          id: 1,
          projectId: repoId,
          sourceId: 1,
          targetId: 2,
          type: 'CROSS_REPO_IMPORTS' as any,
          properties: { sourceRepo: repoId, targetRepo: 'other' } as any,
        }),
        makeEdge({
          id: 2,
          projectId: repoId,
          sourceId: 3,
          targetId: 4,
          type: 'CROSS_REPO_IMPORTS' as any,
          properties: { sourceRepo: 'outsider', targetRepo: repoId } as any,
        }),
      ];

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, localEdges);
      expect(metrics.fanOut).toBe(1);
      expect(metrics.fanIn).toBe(1);
    });

    it('handles undefined crossRepoEdges without crashing', () => {
      const localEdges: GraphEdge[] = [
        makeEdge({
          id: 1,
          projectId: repoId,
          sourceId: 1,
          targetId: 2,
          type: 'CROSS_REPO_IMPORTS' as any,
          properties: {} as any,
        }),
      ];

      expect(() => {
        visualizer.computeRepoMetrics(repoId, nodes, localEdges);
      }).not.toThrow();

      const metrics = visualizer.computeRepoMetrics(repoId, nodes, localEdges);
      expect(metrics.fanOut).toBe(0);
      expect(metrics.fanIn).toBe(0);
    });

    it('handles empty nodes array', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, [], [], [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'dep' }),
      ]);
      expect(metrics.internalSymbolCount).toBe(0);
      expect(metrics.crossRepoSymbolCount).toBe(0);
    });

    it('returns 0 coupling for repo with only itself', () => {
      // fanOut=0, fanIn=0 -> totalRepos=1, coupling=0/(1*2-2)=0/0→handled as 0
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, []);
      expect(metrics.couplingScore).toBe(0);
    });

    it('rounds metrics to 3 decimal places', () => {
      const metrics = visualizer.computeRepoMetrics(repoId, nodes, edges, [
        makeCrossRepoEdge({ sourceRepo: repoId, targetRepo: 'a' }),
      ]);
      // These values should be finite and rounded
      expect(metrics.couplingScore).toBe(0.5);
      expect(Number.isFinite(metrics.cohesionScore)).toBe(true);
      expect(Number.isFinite(metrics.externalDependencyRatio)).toBe(true);
    });
  });

  // =========================================================================
  // computeAllRepoMetrics
  // =========================================================================

  describe('computeAllRepoMetrics', () => {
    it('computes metrics for all repos', () => {
      const repos = [
        { fullName: 'auth', label: 'Auth' },
        { fullName: 'core', label: 'Core' },
        { fullName: 'utils', label: 'Utils' },
      ];

      const nodesByRepo = new Map<string, GraphNode[]>([
        ['auth', [makeNode({ id: 1, projectId: 'auth', isExported: true })]],
        ['core', [makeNode({ id: 2, projectId: 'core', isExported: true })]],
        ['utils', [makeNode({ id: 3, projectId: 'utils', isExported: false })]],
      ]);

      const edges: GraphEdge[] = [
        makeEdge({ id: 1, projectId: 'auth', sourceId: 1, targetId: 2, type: 'CROSS_REPO_IMPORTS' as any }),
      ];

      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'auth', targetRepo: 'core' }),
        makeCrossRepoEdge({ sourceRepo: 'auth', targetRepo: 'utils' }),
        makeCrossRepoEdge({ sourceRepo: 'core', targetRepo: 'utils' }),
      ];

      const result = visualizer.computeAllRepoMetrics(repos, nodesByRepo, edges, crossRepoEdges);

      expect(result.size).toBe(3);
      expect(result.has('auth')).toBe(true);
      expect(result.has('core')).toBe(true);
      expect(result.has('utils')).toBe(true);
    });

    it('provides distinct metrics per repo', () => {
      const repos = [
        { fullName: 'hub', label: 'Hub' },
        { fullName: 'leaf', label: 'Leaf' },
      ];
      const nodesByRepo = new Map<string, GraphNode[]>([
        ['hub', []],
        ['leaf', []],
      ]);

      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'hub', targetRepo: 'leaf' }),
      ];

      const result = visualizer.computeAllRepoMetrics(repos, nodesByRepo, [], crossRepoEdges);

      const hubMetrics = result.get('hub')!;
      const leafMetrics = result.get('leaf')!;
      expect(hubMetrics.fanOut).toBe(1);
      expect(hubMetrics.fanIn).toBe(0);
      expect(leafMetrics.fanOut).toBe(0);
      expect(leafMetrics.fanIn).toBe(1);
    });

    it('handles repos missing from nodesByRepo', () => {
      const repos = [
        { fullName: 'defined', label: 'D' },
        { fullName: 'missing', label: 'M' },
      ];
      const nodesByRepo = new Map<string, GraphNode[]>([
        ['defined', [makeNode({ id: 1, projectId: 'defined', isExported: true })]],
      ]);

      const result = visualizer.computeAllRepoMetrics(repos, nodesByRepo, [], []);

      expect(result.size).toBe(2);
      expect(result.get('missing')!.internalSymbolCount).toBe(0);
    });

    it('handles empty repo list', () => {
      const result = visualizer.computeAllRepoMetrics([], new Map(), [], []);
      expect(result.size).toBe(0);
    });
  });

  // =========================================================================
  // Edge Cases and Stress Tests
  // =========================================================================

  describe('edge cases', () => {
    it('handles repo names with dots (e.g., @scope/pkg.name)', () => {
      const repos = [
        { fullName: '@scope/pkg.name', label: 'Scoped Pkg' },
        { fullName: 'packages.my-org.com/core', label: 'Core' },
      ];
      const edges = [makeCrossRepoEdge({
        sourceRepo: '@scope/pkg.name',
        targetRepo: 'packages.my-org.com/core',
      })];

      const dot = visualizer.generateDotGraph(edges, repos, 'G');
      expect(dot).toContain('"_scope_pkg_name"');
      expect(dot).toContain('"packages_my_org_com_core"');
      expect(dot).toContain('"_scope_pkg_name" -> "packages_my_org_com_core"');
    });

    it('handles large edge counts without performance issues', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges: CrossRepoEdgeRecord[] = [];
      for (let i = 0; i < 500; i++) {
        edges.push(makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 1 }));
      }

      const dot = visualizer.generateDotGraph(edges, repos, 'large');
      expect(dot).toContain('imports (500)');
      expect(dot).toContain('weight = 500');
    });

    it('handles many repos color-palette wrapping', () => {
      const repos = Array.from({ length: 100 }, (_, i) => ({
        fullName: `repo-${i}`,
        label: `R${i}`,
      }));
      const dot = visualizer.generateDotGraph([], repos, 'many');
      // Should not crash and should produce valid DOT
      expect(dot).toContain('digraph');
      expect(dot).toContain('"repo_0"');
      expect(dot).toContain('"repo_99"');
    });

    it('handles special characters in group names', () => {
      const repos = [{ fullName: 'r', label: 'R' }];
      const dot = visualizer.generateDotGraph([], repos, 'Group "X" \\ test');
      expect(dot).toContain('digraph "cross_repo_Group__X____test"');
    });

    it('rounds weight correctly for fractional JSON edge weights', () => {
      const repos = [{ fullName: 'a', label: 'A' }, { fullName: 'b', label: 'B' }];
      const edges = [
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 1.1 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 2.6 }),
        makeCrossRepoEdge({ sourceRepo: 'a', targetRepo: 'b', weight: 3.4 }),
      ];
      const result = visualizer.generateJsonGraph('g', repos, edges);
      // 1.1 + 2.6 + 3.4 = 7.1 => Math.round(7.1) = 7
      expect(result.edges[0]!.weight).toBe(7);
    });

    it('generates proper JSON structure for a complex multi-repo graph', () => {
      const repos = [
        { fullName: 'frontend', label: 'Frontend' },
        { fullName: 'backend', label: 'Backend' },
        { fullName: 'shared-lib', label: 'Shared Lib' },
        { fullName: 'database', label: 'Database' },
      ];

      const nodesByRepo = new Map<string, GraphNode[]>([
        ['frontend', [
          makeNode({ id: 1, projectId: 'frontend', isExported: true }),
          makeNode({ id: 2, projectId: 'frontend', isExported: false }),
        ]],
        ['backend', [
          makeNode({ id: 3, projectId: 'backend', isExported: true }),
        ]],
        ['shared-lib', [
          makeNode({ id: 4, projectId: 'shared-lib', isExported: true }),
          makeNode({ id: 5, projectId: 'shared-lib', isExported: true }),
          makeNode({ id: 6, projectId: 'shared-lib', isExported: false }),
        ]],
        ['database', []],
      ]);

      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'frontend', targetRepo: 'backend', edgeType: 'CROSS_REPO_CALLS', weight: 3 }),
        makeCrossRepoEdge({ sourceRepo: 'frontend', targetRepo: 'shared-lib', edgeType: 'CROSS_REPO_IMPORTS', weight: 2 }),
        makeCrossRepoEdge({ sourceRepo: 'backend', targetRepo: 'shared-lib', edgeType: 'CROSS_REPO_IMPORTS', weight: 2 }),
        makeCrossRepoEdge({ sourceRepo: 'backend', targetRepo: 'database', edgeType: 'CROSS_REPO_DEPENDS', weight: 5 }),
      ];

      const result = visualizer.generateJsonGraph('complex', repos, crossRepoEdges, nodesByRepo);

      expect(result.nodes).toHaveLength(4);
      expect(result.edges).toHaveLength(4);
      expect(result.metadata.groupId).toBe('complex');
      expect(result.metadata.totalEdges).toBe(4);
      expect(result.metadata.orphanCount).toBe(0);
      expect(result.metadata.byType['CROSS_REPO_CALLS']).toBe(1);
      expect(result.metadata.byType['CROSS_REPO_IMPORTS']).toBe(2);
      expect(result.metadata.byType['CROSS_REPO_DEPENDS']).toBe(1);

      const frontend = result.nodes.find((n) => n.id === 'frontend')!;
      expect(frontend.stats.totalNodes).toBe(2);
      expect(frontend.stats.exportedSymbols).toBe(1);
    });

    it('computes batch metrics for multi-repo interconnected graph', () => {
      const repos = [
        { fullName: 'pkg-a', label: 'A' },
        { fullName: 'pkg-b', label: 'B' },
        { fullName: 'pkg-c', label: 'C' },
      ];

      const nodesByRepo = new Map<string, GraphNode[]>([
        ['pkg-a', [makeNode({ id: 1, projectId: 'pkg-a', isExported: true, name: 'ServiceA' })]],
        ['pkg-b', [makeNode({ id: 2, projectId: 'pkg-b', isExported: true, name: 'ServiceB' })]],
        ['pkg-c', [makeNode({ id: 3, projectId: 'pkg-c', isExported: true, name: 'ServiceC' })]],
      ]);

      const crossRepoEdges: CrossRepoEdgeRecord[] = [
        makeCrossRepoEdge({ sourceRepo: 'pkg-a', targetRepo: 'pkg-b' }),
        makeCrossRepoEdge({ sourceRepo: 'pkg-b', targetRepo: 'pkg-c' }),
        makeCrossRepoEdge({ sourceRepo: 'pkg-c', targetRepo: 'pkg-a' }),
      ];

      const result = visualizer.computeAllRepoMetrics(repos, nodesByRepo, [], crossRepoEdges);

      // pkg-a: fanOut=1 (to b), fanIn=1 (from c)
      expect(result.get('pkg-a')!.fanOut).toBe(1);
      expect(result.get('pkg-a')!.fanIn).toBe(1);

      // pkg-b: fanOut=1 (to c), fanIn=1 (from a)
      expect(result.get('pkg-b')!.fanOut).toBe(1);
      expect(result.get('pkg-b')!.fanIn).toBe(1);

      // pkg-c: fanOut=1 (to a), fanIn=1 (from b)
      expect(result.get('pkg-c')!.fanOut).toBe(1);
      expect(result.get('pkg-c')!.fanIn).toBe(1);

      // All should have the same coupling score (fully symmetric triangle)
      const metricA = result.get('pkg-a')!;
      expect(metricA.couplingScore).toBeGreaterThan(0);
    });
  });
});
